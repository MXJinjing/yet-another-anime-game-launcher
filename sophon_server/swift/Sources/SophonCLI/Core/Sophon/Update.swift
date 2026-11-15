import ArgumentParser
import Foundation
import HYPAPIClient
import Logging
import SophonClientv3

extension StorageIOPolicy: ExpressibleByArgument {}
extension UpdateWriteMode: ExpressibleByArgument {}

struct TransferCLIOptions: ParsableArguments, Sendable {
  @Option(help: "Fast local working cache for downloads and original snapshots.")
  var cacheDirectory: String?
  @Option(help: "Operation state directory; defaults to a directory within the cache.")
  var stateDirectory: String?
  @Option(name: .customLong("memory-cache-mib"), help: "Shared working RAM cache limit in MiB.")
  var memoryCacheMiB = 1024
  @Option(name: .customLong("disk-cache-gib"), help: "Maximum disk spill in GiB for this run.")
  var diskCacheGiB = 10
  @Flag(help: "Keep live working data in RAM; explicit --cache-at downloads still use disk.")
  var noDiskCache = false
  @Option(help: "Maximum queued cache entries.")
  var cacheEntryLimit = 500
  @Option(help: "Target I/O: parallel (default) or serialized.")
  var ioPolicy: StorageIOPolicy = .parallel
  @Option(help: "Update output mode: temporary replacement or in-place overwrite.")
  var writeMode: UpdateWriteMode = .temporaryReplacement
  @Flag(
    help: "Rebuild update progress from target files instead of using saved checkpoints."
  )
  var stateless = false

  mutating func validate() throws {
    guard memoryCacheMiB >= 0, memoryCacheMiB <= Int.max / (1024 * 1024),
      diskCacheGiB > 0, diskCacheGiB <= Int.max / (1024 * 1024 * 1024), cacheEntryLimit > 0
    else {
      throw ValidationError("Cache limits must fit the platform and disk capacity must be positive")
    }
  }

  var settings: TransferSettings {
    var settings = TransferSettings()
    settings.cacheDirectory = cacheDirectory
    settings.stateDirectory = stateDirectory
    settings.memoryLimit = UInt64(memoryCacheMiB) * 1024 * 1024
    settings.diskLimit = UInt64(diskCacheGiB) * 1024 * 1024 * 1024
    settings.diskCacheEnabled = !noDiskCache
    settings.entryLimit = cacheEntryLimit
    settings.ioPolicy = ioPolicy
    settings.writeMode = writeMode
    settings.preserveState = !stateless
    return settings
  }
}

struct UpdateCLI: AsyncParsableCommand, Sendable {
  static let configuration = CommandConfiguration(
    commandName: "update", abstract: "Apply an incremental game update.")
  @Argument(help: "Game ID or game biz.") var game: String
  @Argument(help: "Game directory.") var directory: String
  @Option(
    name: .customLong("from"),
    help: "Source version override; defaults to the saved operation or executable hash detection.")
  var sourceVersion: String?
  @Flag(help: "Use CN endpoints.") var cn = false
  @Flag(help: "Select the future branch instead of the live branch.") var predownload = false
  @Option(help: "Download diff bundles to this directory without modifying game files.")
  var cacheAt: String?
  @Option(help: "Installation category scenario: full or base.") var mode = "full"
  @Option(help: "Maximum parallel HTTP range downloads.") var maxConcurrentDownloads = 8
  @Option(help: "Maximum file patch workers in parallel I/O mode.")
  var maxConcurrentWrites = 4
  @Flag(help: "Print the selected update plan without applying it.") var plan = false
  @Flag(help: "Print append-only summaries instead of updating a terminal dashboard.")
  var plain = false
  @Option(
    help: "Dashboard refresh interval in seconds; plain output is limited to once per second.")
  var refreshInterval = 0.25
  @OptionGroup var transfer: TransferCLIOptions

  mutating func validate() throws {
    guard ["full", "base"].contains(mode), sourceVersion?.isEmpty != true, cacheAt?.isEmpty != true,
      maxConcurrentDownloads > 0, maxConcurrentWrites > 0
    else { throw ValidationError("Invalid update scenario, source version, or worker count") }
    guard refreshInterval.isFinite, refreshInterval > 0, refreshInterval <= Double(Int32.max) else {
      throw ValidationError("--refresh-interval must be positive and at most \(Int32.max) seconds")
    }
  }

  mutating func run() async throws {
    var settings = transfer.settings
    settings.predownloadDirectory = cacheAt
    if plan {
      let client = try await makeOperationClient(
        game: game, directory: directory, cn: cn, transfer: settings,
        downloads: maxConcurrentDownloads, writes: maxConcurrentWrites)
      let plan = try await client.planUpdate(
        sourceVersion: sourceVersion, mode: mode == "base" ? .base : .full,
        predownload: predownload)
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
      print(String(decoding: try encoder.encode(plan), as: UTF8.self))
      return
    }
    let command = self
    let terminal = InstallTerminal(plain: plain)
    let frames = AsyncStream<InstallFrame>.makeStream(bufferingPolicy: .bufferingNewest(1))
    let dashboard = UpdateDashboard(
      title: "\(game) [\(mode)\(predownload ? ", predownload branch" : "")]",
      directory: URL(fileURLWithPath: directory).standardizedFileURL.path,
      cacheAt: cacheAt.map { URL(fileURLWithPath: $0).standardizedFileURL.path },
      writeMode: settings.writeMode, ioPolicy: settings.ioPolicy,
      plain: !terminal.interactive, frames: frames.continuation)
    await dashboard.refresh(force: true)
    let operation = Task { [settings] in await command.update(settings, dashboard: dashboard) }
    let interrupts = InstallInterrupts {
      operation.cancel()
      Task { await dashboard.requestCancellation() }
    }
    let rendering = Task {
      do {
        for await frame in frames.stream { try await terminal.write(frame) }
        return nil as String?
      } catch {
        operation.cancel()
        return error.localizedDescription
      }
    }
    let ticker = Task {
      while !Task.isCancelled {
        do { try await Task.sleep(for: .seconds(command.refreshInterval)) } catch { return }
        await dashboard.refresh()
      }
    }
    let outcome = await withTaskCancellationHandler {
      await operation.value
    } onCancel: {
      operation.cancel()
    }
    ticker.cancel()
    await ticker.value
    await dashboard.complete(outcome)
    frames.continuation.finish()
    let outputError = await rendering.value
    withExtendedLifetime(interrupts) {}
    if let outputError { throw ValidationError("Could not write update progress: \(outputError)") }
    switch outcome {
    case .completed: return
    case .cancelled: throw ExitCode(130)
    case .failed: throw ExitCode.failure
    }
  }

  private func update(_ settings: TransferSettings, dashboard: UpdateDashboard) async
    -> UpdateOutcome
  {
    do {
      try Task.checkCancellation()
      let client = try await makeOperationClient(
        game: game, directory: directory, cn: cn, transfer: settings,
        downloads: maxConcurrentDownloads, writes: maxConcurrentWrites)
      try Task.checkCancellation()
      let reporter = client.makeUpdateReporter()
      await dashboard.attach(reporter)
      let subscription = await reporter.subscribe()
      let progress = Task {
        for await event in subscription.events { await dashboard.record(event) }
      }
      let outcome: UpdateOutcome
      do {
        try await client.update(
          sourceVersion: sourceVersion, mode: mode == "base" ? .base : .full,
          predownload: predownload, cacheOnly: cacheAt != nil, reporter: reporter)
        outcome = .completed
      } catch {
        outcome =
          error is CancellationError || Task.isCancelled
          ? .cancelled : .failed(reason: error.localizedDescription)
      }
      await reporter.unsubscribe(subscription.id)
      await progress.value
      await client.flushLogs()
      return outcome
    } catch {
      return error is CancellationError || Task.isCancelled
        ? .cancelled : .failed(reason: error.localizedDescription)
    }
  }
}

struct NextActionCLI: AsyncParsableCommand {
  static let configuration = CommandConfiguration(
    commandName: "next-action", abstract: "Return the next appropriate action without executing it."
  )
  @Argument var game: String
  @Argument var directory: String
  @Flag var cn = false
  @OptionGroup var transfer: TransferCLIOptions

  mutating func run() async throws {
    let client = try await makeOperationClient(
      game: game, directory: directory, cn: cn, transfer: transfer.settings)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    print(String(decoding: try encoder.encode(await client.nextAction()), as: UTF8.self))
  }
}

struct UpdateStateCLI: AsyncParsableCommand {
  static let configuration = CommandConfiguration(
    commandName: "state", abstract: "Inspect saved updater state.")
  @Argument var directory: String
  @Option(help: "Operation to inspect: update or install.") var operation = "update"
  @OptionGroup var transfer: TransferCLIOptions

  mutating func validate() throws {
    guard ["update", "install"].contains(operation) else {
      throw ValidationError("Unknown operation")
    }
  }

  mutating func run() async throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    let data: Data
    if operation == "install" {
      data = try encoder.encode(
        await SophonClientv3.savedInstallationState(
          at: URL(fileURLWithPath: directory), settings: transfer.settings))
    } else {
      data = try encoder.encode(
        await SophonClientv3.savedUpdateState(
          at: URL(fileURLWithPath: directory), settings: transfer.settings))
    }
    print(String(decoding: data, as: UTF8.self))
  }
}

func makeOperationClient(
  game: String, directory: String, cn: Bool, transfer: TransferSettings,
  downloads: Int = 8, writes: Int = 4, checks: Int = 8, postProcessors: Int = 4,
  maxRetries: Int = 10, retryInterval: Int = 5, maxCachedFileHandles: Int = 512,
  manifestCacheDir: String? = nil, logger: Logger? = nil, control: TransferControl? = nil,
  launcherID: String? = nil, proxy: DownloadProxy? = nil
) async throws -> SophonClientv3 {
  let session = proxy?.makeMetadataSession() ?? .shared
  let api = try HYPAPIClient(
    baseURL: cn ? HYPAPI_CN_BASE_URL : HYPAPI_OS_BASE_URL,
    sophonBaseURL: cn ? SOPHON_API_CN_BASE_URL : SOPHON_API_OS_BASE_URL,
    launcherID: launcherID ?? (cn ? HYPAPI_CN_LAUNCHER_ID : HYPAPI_OS_LAUNCHER_ID),
    maxRetries: maxRetries, retryInterval: retryInterval, session: session)
  let config = try resolveHYPGame(game, in: await api.getGameConfigs())
  let manifests =
    FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
    ?? FileManager.default.temporaryDirectory
  let settings = SophonClientSettings(
    baseURL: cn ? HYPAPI_CN_BASE_URL : HYPAPI_OS_BASE_URL,
    sophonBaseURL: cn ? SOPHON_API_CN_BASE_URL : SOPHON_API_OS_BASE_URL,
    maxRetries: maxRetries, retryInterval: retryInterval,
    launcherID: launcherID ?? (cn ? HYPAPI_CN_LAUNCHER_ID : HYPAPI_OS_LAUNCHER_ID),
    gameID: config.game.id,
    manifestCacheDir: manifestCacheDir
      ?? manifests.appendingPathComponent("SophonClientv3/manifests").path,
    logStdout: false, maxCocurrentChecks: checks, maxCocurrentDownloads: downloads,
    maxCocurrentPostProcessors: postProcessors, maxCocurrentWrites: writes,
    maxCachedFileHandles: maxCachedFileHandles,
    transfer: transfer)
  return try await SophonClientv3(
    settings, baseGameDir: URL(fileURLWithPath: directory), logger: logger, control: control,
    proxy: proxy, metadataSession: session)
}

private actor UpdateDashboard {
  private let title: String
  private let directory: String
  private let cacheAt: String?
  private let writeMode: UpdateWriteMode
  private let ioPolicy: StorageIOPolicy
  private let plain: Bool
  private let frames: AsyncStream<InstallFrame>.Continuation
  private let origin = ContinuousClock.now
  private var reporter: UpdateReporter?
  private var progress = UpdateProgress()
  private var result: UpdateOutcome?
  private var cancelling = false
  private var lastFrame: Double = -.infinity
  private var latest = "Loading game configuration and branches"
  private var currentFile: String?

  init(
    title: String, directory: String, cacheAt: String?, writeMode: UpdateWriteMode,
    ioPolicy: StorageIOPolicy, plain: Bool, frames: AsyncStream<InstallFrame>.Continuation
  ) {
    self.title = title
    self.directory = directory
    self.cacheAt = cacheAt
    self.writeMode = writeMode
    self.ioPolicy = ioPolicy
    self.plain = plain
    self.frames = frames
  }

  func attach(_ reporter: UpdateReporter) { self.reporter = reporter }

  func record(_ event: UpdateEvent) async {
    switch event {
    case .fileStarted(let path): currentFile = fileName(path)
    case .fileCompleted(let path, _, let skipped):
      currentFile = nil
      latest = "\(skipped ? "Already updated" : "Verified"): \(fileName(path))"
    case .fileNeedsRepair(let path):
      currentFile = nil
      latest = "Queued for repair: \(fileName(path))"
    case .fileCached(let path): latest = "Cached patch: \(fileName(path))"
    case .fileDeleted(let path, _): latest = "Delete entry complete: \(fileName(path))"
    case .bundleDownloaded(let id, _): latest = "Bundle ready: \(id)"
    case .manifestPulled(let kind, let field): latest = "Loaded \(kind) manifest \(field)"
    case .phaseChanged: await refresh(force: true)
    default: break
    }
  }

  func requestCancellation() async {
    cancelling = true
    await refresh(force: true)
  }

  func refresh(force: Bool = false) async {
    guard result == nil else { return }
    if let reporter { progress = await reporter.snapshot() }
    let time = installClockSeconds(origin)
    guard force || !plain || time - lastFrame >= 1 else { return }
    lastFrame = time
    frames.yield(InstallFrame(lines: lines(at: time), force: force))
  }

  func complete(_ outcome: UpdateOutcome) async {
    if let reporter { progress = await reporter.snapshot() }
    result = outcome
    frames.yield(InstallFrame(lines: lines(at: installClockSeconds(origin)), force: true))
  }

  private func lines(at time: Double) -> [String] {
    let m = progress.metrics
    let common = m.common
    let status: String
    switch result ?? progress.outcome {
    case .completed?: status = "COMPLETED"
    case .cancelled?: status = "CANCELLED"
    case .failed?: status = "FAILED"
    case nil: status = cancelling ? "CANCELLING..." : progress.phase.rawValue.uppercased()
    }
    let version =
      progress.sourceVersion.flatMap { source in progress.targetVersion.map { "\(source) -> \($0)" }
      } ?? "Resolving source and target versions"
    var lines = [
      "  SOPHON / UPDATE", "  \(installText(title, limit: 70))",
      "  Target  \(installText(directory, limit: 65))",
      cacheAt.map { "  Cache at  \(installText($0, limit: 63))" }
        ?? "  Output  \(writeMode == .inPlace ? "In-place" : "Temporary replacement") | \(ioPolicy == .serialized ? "Sequential" : "Parallel") I/O",
      "  Version  \(installText(version, limit: 65))", "  \(status)",
      "  Stage \(installDuration(common.timing.stageElapsedSeconds))   Total \(installDuration(common.timing.elapsedSeconds))   ETA \(installDuration(common.timing.etaSeconds))",
    ]
    if progress.phase == .metadata {
      lines += [
        installMetricRow("Manifests", common.metadata.manifests, at: time, plain: plain),
        "  Install \(common.metadata.installationManifests.completed) / \(common.metadata.installationManifests.total.map(String.init) ?? "—")   Diff \(common.metadata.diffManifests.completed) / \(common.metadata.diffManifests.total.map(String.init) ?? "—")",
        installMetricRow("Planning", common.metadata.planning, at: time, plain: plain),
      ]
    }
    if progress.phase == .repairing || m.repair.download.total != nil {
      lines.append(
        "  Patch data verified  \(installBytes(Double(m.patch.verifiedBytes))) (\(m.patch.bundlesReady) bundles)"
      )
      lines += installByteRows(
        "Repair data", m.repair.download, at: time, plain: plain,
        rate: m.repair.download.averageRate, average: true)
      lines += installByteRows(
        "Repair write", m.repair.write, at: time, plain: plain, rate: m.repair.write.averageRate,
        average: true)
    } else {
      lines += [
        installMetricRow("Patch data", m.patch.data, at: time, plain: plain),
        "  \(installMetricBytes(m.patch.data)) received   Net \(installSpeed(m.patch.network.rate))",
        "  Remaining \(installBytes(Double(m.patch.data.remaining ?? 0)))   Retained \(installBytes(Double(m.patch.retainedBytes)))",
        "  Verified \(installBytes(Double(m.patch.verifiedBytes)))   Bundles ready \(m.patch.bundlesReady)",
      ]
    }
    lines += [
      installMetricRow(
        cacheAt == nil ? "Files" : "Cached files", common.files, at: time, plain: plain),
      "  \(common.files.completed) / \(common.files.total.map(String.init) ?? "—") files   Skipped \(m.skippedFiles)   Repair \(m.repair.files)",
    ]
    if cacheAt == nil {
      lines += installByteRows(
        "Output", common.write, at: time, plain: plain, rate: common.write.averageRate,
        average: true)
      lines.append(
        "  Delete entries  \(m.deletion.files.completed) / \(m.deletion.files.total.map(String.init) ?? "—")   Planned \(installBytes(Double(m.deletion.bytes.total ?? 0)))   Removed \(installBytes(Double(m.deletion.bytes.completed)))"
      )
    }
    lines.append(
      "  Network \(installBytes(Double(common.network.completed))) new bytes   \(installSpeed(common.network.rate))"
    )
    lines += installResourceRows(common.resources)
    lines.append(
      "  \(currentFile == nil ? "Latest" : "File")  \(installText(currentFile ?? latest, limit: 65))"
    )
    if case .failed(let reason)? = result ?? progress.outcome {
      lines.append("  Error  \(installText(reason, limit: 500))")
    }
    return lines
  }

  private func fileName(_ file: URL) -> String {
    let prefix = directory.hasSuffix("/") ? directory : directory + "/"
    return file.path.hasPrefix(prefix) ? String(file.path.dropFirst(prefix.count)) : file.path
  }
}
