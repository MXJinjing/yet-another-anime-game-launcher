import ArgumentParser
import Dispatch
import Foundation
import HYPAPIClient
import SophonClientv3

#if canImport(Darwin)
  import Darwin
#elseif canImport(Glibc)
  import Glibc
#elseif os(Windows)
  import WinSDK
#endif

struct InstallCLI: AsyncParsableCommand, Sendable {
  static let configuration = CommandConfiguration(
    commandName: "install",
    abstract: "Verify an installation and download missing or damaged chunks."
  )

  @Argument(help: "Game ID or game biz.", completion: .list(AVAILABLE_GAME_BIZS))
  var gameIDOrBiz: String

  @Argument(help: "Destination game directory; may not exist yet.", completion: .directory)
  var directory: String

  @Flag(help: "Use the CN endpoints and launcher ID instead of OS defaults.")
  var cn = false

  @Option(help: "Override the regional HYP API base URL.")
  var baseURL: String?

  @Option(help: "Override the regional Sophon API base URL.")
  var sophonBaseURL: String?

  @Option(help: "Override the regional launcher ID.")
  var launcherID: String?

  @Option(
    help: "Manifest cache directory; defaults to the user cache directory.", completion: .directory)
  var manifestCacheDir: String?

  @Option(help: "Installation mode: full or base.", completion: .list(["full", "base"]))
  var mode = "full"

  @Option(
    name: .customLong("voice-pack"),
    help: "Audio matching field; repeat for multiple packs. Installed packs are auto-detected.")
  var voicePacks: [String] = []

  @Flag(help: "Install the predownload branch into the destination; NOT download-only caching.")
  var predownload = false

  @Option(help: "Additional download attempts after the initial attempt.")
  var maxRetries = 10

  @Option(help: "Seconds between retries; zero is allowed.")
  var retryInterval = 5

  @Option(help: "Maximum concurrent file checks.")
  var maxConcurrentChecks = 8

  @Option(help: "Maximum concurrent chunk downloads.")
  var maxConcurrentDownloads = 8

  @Option(help: "Maximum concurrent chunk post-processors.")
  var maxConcurrentPostProcessors = 4

  @Option(help: "Maximum concurrent disk writers.")
  var maxConcurrentWrites = 4

  @OptionGroup var transfer: TransferCLIOptions

  @Option(
    help: "Optional library log file. Normal library stdout logging is always disabled.",
    completion: .file())
  var logFile: String?

  @Flag(help: "Print append-only summaries instead of updating a terminal dashboard.")
  var plain = false

  @Option(
    help: "Dashboard refresh interval in seconds; plain output is limited to once per second.")
  var refreshInterval = 0.25

  private var cacheURL: URL {
    if let manifestCacheDir { return URL(fileURLWithPath: manifestCacheDir).standardizedFileURL }
    let root =
      FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
      ?? FileManager.default.temporaryDirectory
    return root.appendingPathComponent("SophonClientv3/manifests", isDirectory: true)
  }

  mutating func validate() throws {
    mode = mode.lowercased()
    guard mode == "full" || mode == "base" else {
      throw ValidationError("--mode must be full or base")
    }
    guard maxRetries >= 0, retryInterval >= 0 else {
      throw ValidationError("Retry counts and intervals must be nonnegative")
    }
    guard
      [
        maxConcurrentChecks, maxConcurrentDownloads, maxConcurrentPostProcessors,
        maxConcurrentWrites,
      ]
      .allSatisfy({ $0 > 0 })
    else {
      throw ValidationError("Concurrency limits must be positive")
    }
    guard refreshInterval.isFinite, refreshInterval > 0, refreshInterval <= Double(Int32.max) else {
      throw ValidationError("--refresh-interval must be positive and at most \(Int32.max) seconds")
    }
    for value in [gameIDOrBiz, directory]
      + [launcherID, manifestCacheDir, logFile].compactMap({ $0 })
      + voicePacks
    {
      guard !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        throw ValidationError("Identifiers and paths cannot be empty")
      }
    }
    for value in [baseURL, sophonBaseURL].compactMap({ $0 }) {
      guard let url = URL(string: value), let scheme = url.scheme?.lowercased(),
        ["https", "http"].contains(scheme), let host = url.host, !host.isEmpty
      else {
        throw ValidationError("API URLs must be absolute HTTP(S) URLs")
      }
    }
    var isDirectory: ObjCBool = false
    if FileManager.default.fileExists(atPath: directory, isDirectory: &isDirectory),
      !isDirectory.boolValue
    {
      throw ValidationError("The installation destination is not a directory")
    }
  }

  mutating func run() async throws {
    let command = self
    let terminal = InstallTerminal(plain: plain)
    let frames = AsyncStream<InstallFrame>.makeStream(bufferingPolicy: .bufferingNewest(1))
    let dashboard = InstallDashboard(
      title: "\(gameIDOrBiz) [\(mode)\(predownload ? ", predownload branch" : "")]",
      directory: URL(fileURLWithPath: directory).standardizedFileURL.path,
      cache: cacheURL.path, plain: !terminal.interactive, frames: frames.continuation)

    await dashboard.refresh(force: true)
    let operation = Task { await command.install(dashboard: dashboard) }
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
    if let outputError {
      throw ValidationError("Could not write installation progress: \(outputError)")
    }
    switch outcome {
    case .completed: return
    case .cancelled: throw ExitCode(130)
    case .failed: throw ExitCode.failure
    }
  }

  private func install(dashboard: InstallDashboard) async -> InstallationOutcome {
    do {
      try Task.checkCancellation()
      let apiClient = try HYPAPIClient(
        baseURL: baseURL ?? (cn ? HYPAPI_CN_BASE_URL : HYPAPI_OS_BASE_URL),
        sophonBaseURL: sophonBaseURL ?? (cn ? SOPHON_API_CN_BASE_URL : SOPHON_API_OS_BASE_URL),
        launcherID: launcherID ?? (cn ? HYPAPI_CN_LAUNCHER_ID : HYPAPI_OS_LAUNCHER_ID),
        maxRetries: maxRetries, retryInterval: retryInterval)
      let configs = try await apiClient.getGameConfigs()
      try Task.checkCancellation()
      guard let config = configs.findBy(id: gameIDOrBiz) ?? configs.findBy(biz: gameIDOrBiz) else {
        return .failed(
          reason: "No game matches ID or biz '\(gameIDOrBiz)' for the selected launcher.")
      }
      let settings = SophonClientSettings(
        baseURL: baseURL ?? (cn ? HYPAPI_CN_BASE_URL : HYPAPI_OS_BASE_URL),
        sophonBaseURL: sophonBaseURL ?? (cn ? SOPHON_API_CN_BASE_URL : SOPHON_API_OS_BASE_URL),
        maxRetries: maxRetries, retryInterval: retryInterval,
        launcherID: launcherID ?? (cn ? HYPAPI_CN_LAUNCHER_ID : HYPAPI_OS_LAUNCHER_ID),
        gameID: config.game.id, manifestCacheDir: cacheURL.path, logStdout: false, logFile: logFile,
        maxCocurrentChecks: maxConcurrentChecks, maxCocurrentDownloads: maxConcurrentDownloads,
        maxCocurrentPostProcessors: maxConcurrentPostProcessors,
        maxCocurrentWrites: maxConcurrentWrites, transfer: transfer.settings)
      let client = try await SophonClientv3(settings, baseGameDir: URL(fileURLWithPath: directory))
      try Task.checkCancellation()
      let reporter = client.makeInstallationReporter()
      await dashboard.attach(reporter)
      let subscription = await reporter.subscribe()
      // Own this consumer explicitly so cancelling installation does not discard its final events.
      let consumer = Task {
        for await event in subscription.events { await dashboard.record(event) }
      }
      let outcome: InstallationOutcome
      do {
        try await client.install(
          mode: mode == "full" ? .full : .base,
          additionalVoicePackMatchingFields: Set(voicePacks), predownload: predownload,
          reporter: reporter)
        outcome = .completed
      } catch {
        outcome =
          error is CancellationError || Task.isCancelled
          ? .cancelled : .failed(reason: error.localizedDescription)
      }
      // Finishing preserves buffered events, including the terminal event, for the consumer to drain.
      await reporter.unsubscribe(subscription.id)
      await consumer.value
      await client.flushLogs()
      return outcome
    } catch {
      return error is CancellationError || Task.isCancelled
        ? .cancelled : .failed(reason: error.localizedDescription)
    }
  }
}

struct InstallFrame: Sendable {
  let lines: [String]
  let force: Bool
}

private actor InstallDashboard {
  private let title: String
  private let directory: String
  private let cache: String
  private let plain: Bool
  private let frames: AsyncStream<InstallFrame>.Continuation
  private let origin = ContinuousClock.now
  private var reporter: InstallationReporter?
  private var progress = InstallationProgress()
  private var result: InstallationOutcome?
  private var cancelling = false
  private var lastFrame: Double = -.infinity
  private var latest = "Loading game configuration and branches"
  private var notice: String?

  init(
    title: String, directory: String, cache: String, plain: Bool,
    frames: AsyncStream<InstallFrame>.Continuation
  ) {
    self.title = title
    self.directory = directory
    self.cache = cache
    self.plain = plain
    self.frames = frames
  }

  func attach(_ reporter: InstallationReporter) { self.reporter = reporter }

  func record(_ event: InstallationEvent) async {
    switch event {
    case .manifestPulled(let field, _): latest = "Loaded manifest \(field)"
    case .fileMissing(let path, _, _): latest = "Missing: \(path.path)"
    case .fileChunkScanned(let path, _, let broken, _, _, _):
      latest = "\(broken ? "Damaged chunk" : "Checked"): \(path.path)"
    case .fileScanned(let path, _, _): latest = "Scanned: \(path.path)"
    case .fileTrimmed(let path): latest = "Trimmed: \(path.path)"
    case .chunkDownloaded(let id, _): latest = "Downloaded: \(id)"
    case .chunkPostProcessed(let id, _, _): latest = "Processed: \(id)"
    case .chunkWritten(let path, _, _, _): latest = "Wrote: \(path.path)"
    case .fileCompleted(let path): latest = "Completed: \(path.path)"
    case .retryScheduled(let id, let attempt, let reason):
      notice = "Retry \(attempt) for \(id): \(reason)"
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

  func complete(_ outcome: InstallationOutcome) async {
    if let reporter { progress = await reporter.snapshot() }
    result = outcome
    frames.yield(InstallFrame(lines: lines(at: installClockSeconds(origin)), force: true))
  }

  private func lines(at time: Double) -> [String] {
    let metrics = progress.metrics
    let common = metrics.common
    let status = installStatus(
      result ?? progress.outcome, phase: installPhaseName(progress.phase), cancelling: cancelling)
    var lines = [
      "  SOPHON / INSTALL", "  \(installText(title, limit: 70))",
      "  Target  \(installText(directory, limit: 65))", "", "  \(status)",
      "  Stage \(installDuration(common.timing.stageElapsedSeconds))   Total \(installDuration(common.timing.elapsedSeconds))   ETA \(installDuration(common.timing.etaSeconds))",
      "",
    ]
    switch progress.phase {
    case .metadata:
      lines += [
        installMetricRow("Manifests", common.metadata.manifests, at: time, plain: plain),
        "  Loaded  \(common.metadata.manifests.completed) / \(common.metadata.manifests.total.map(String.init) ?? "—") manifests",
        installMetricRow("Planning", common.metadata.planning, at: time, plain: plain),
        "  Cache   \(installText(cache, limit: 65))",
      ]
    case .scanning:
      let scan = metrics.verification
      lines += [
        installMetricRow("Verify", scan.bytes, at: time, plain: plain),
        "  Assessed  \(installMetricBytes(scan.bytes))", "",
        "  Chunks  \(scan.chunks.completed) / \(scan.chunks.total.map(String.init) ?? "—")   Files  \(scan.files.completed) / \(scan.files.total.map(String.init) ?? "—")",
        "  Missing \(scan.missingFiles)   Needing repair \(scan.brokenFiles)",
      ]
    case .trimming:
      lines += [
        installMetricRow("Trim", metrics.trimming, at: time, plain: plain),
        "  Trimmed  \(metrics.trimming.completed) / \(metrics.trimming.total.map(String.init) ?? "—") files",
      ]
    case .running:
      lines += installByteRows(
        "Download", metrics.download, at: time, plain: plain, rate: common.network.rate)
      lines += [
        "", installMetricRow("Process", metrics.processing.chunks, at: time, plain: plain),
        "  \(metrics.processing.chunks.completed) / \(metrics.processing.chunks.total.map(String.init) ?? "—") chunks   \(installBytes(Double(metrics.processing.bytes)))",
        "  Elapsed \(installDuration(metrics.processing.chunks.elapsedSeconds))   ETA \(installDuration(metrics.processing.chunks.etaSeconds))",
        "",
      ]
      lines += installByteRows(
        "Write", common.write, at: time, plain: plain, rate: common.write.rate)
    }
    lines += [
      "",
      "  Read  \(installColumn(installBytes(Double(common.read.completed)), width: 20))\(installSpeed(common.read.rate))\(common.read.isFinished ? "  (last rate)" : "")",
    ]
    if progress.phase == .running {
      lines.append(
        "  Files \(common.files.completed) / \(common.files.total.map(String.init) ?? "—")   Downloaded chunks \(metrics.downloadedChunks)   Retries \(metrics.retries)"
      )
    }
    lines += installResourceRows(common.resources)
    if let outcome = result ?? progress.outcome {
      if case .failed(let reason) = outcome {
        lines.append("  Error  \(installText(reason, limit: 500))")
      }
      lines.append(
        "  Assessed \(installBytes(Double(metrics.verification.bytes.completed))) (\(metrics.verification.chunks.completed) chunks)   Downloaded \(installBytes(Double(metrics.download.completed)))   Written \(installBytes(Double(common.write.completed)))"
      )
      lines.append(
        "  "
          + [InstallationPhase.metadata, .scanning, .trimming, .running].compactMap { phase in
            common.timing.phaseDurations[phase.rawValue].map {
              "\(installPhaseName(phase)) \(installDuration($0))"
            }
          }.joined(separator: " | "))
    } else {
      lines.append("  Latest  \(installText(latest, limit: 65))")
      if let notice { lines.append("  \(installText(notice, limit: 72))") }
    }
    return lines
  }
}

func installClockSeconds(_ origin: ContinuousClock.Instant) -> Double {
  let value = origin.duration(to: .now).components
  return Double(value.seconds) + Double(value.attoseconds) / 1e18
}

func installStatus(_ outcome: InstallationOutcome?, phase: String, cancelling: Bool) -> String {
  switch outcome {
  case .completed?: return "COMPLETED"
  case .cancelled?: return "CANCELLED"
  case .failed?: return "FAILED"
  case nil: return cancelling ? "CANCELLING..." : phase.uppercased()
  }
}

func installMetricRow(_ label: String, _ metric: SophonMetric, at time: Double, plain: Bool)
  -> String
{
  "  \(installColumn(label, width: 12))\(installBar(metric.percentage, at: time, unicode: !plain))  \(metric.percentage.map { String(format: "%.1f%%", locale: Locale(identifier: "en_US_POSIX"), $0) } ?? "—")"
}

func installMetricBytes(_ metric: SophonMetric) -> String {
  "\(installBytes(Double(metric.completed))) / \(metric.total.map { installBytes(Double($0)) } ?? "—")"
}

func installByteRows(
  _ label: String, _ metric: SophonMetric, at time: Double, plain: Bool, rate: Double?,
  average: Bool = false
) -> [String] {
  [
    installMetricRow(label, metric, at: time, plain: plain),
    "  \(installColumn(installMetricBytes(metric)))\(average ? "Avg " : "")\(installSpeed(rate))",
    "  Elapsed \(installDuration(metric.elapsedSeconds))   ETA \(installDuration(metric.etaSeconds))",
  ]
}

func installResourceRows(_ resources: SophonResourceMetrics?) -> [String] {
  guard let resources else { return [] }
  var lines = [
    "  RAM cache \(installBytes(Double(resources.memoryBytes))) / \(installBytes(Double(resources.memoryLimit)))   Spill reserved \(installBytes(Double(resources.diskReservedBytes))) / \(installBytes(Double(resources.diskLimit)))"
  ]
  for device in resources.devices {
    lines.append(
      "  Storage \(installText(device.location, limit: 25)) [\(device.roles.joined(separator: "+"))]   Cache \(installBytes(Double(device.cacheBytes)))"
    )
    lines.append(
      "  Read \(installBytes(Double(device.read.completed))) \(installSpeed(device.read.rate))   Write \(installBytes(Double(device.write.completed))) \(installSpeed(device.write.rate))"
    )
  }
  return lines
}

func installColumn(_ text: String, width: Int = 38) -> String {
  text + String(repeating: " ", count: max(2, width - text.count))
}

func installBar(_ percentage: Double?, at time: Double, unicode: Bool) -> String {
  let width = 28
  let fill = unicode ? "█" : "="
  let empty = unicode ? "░" : "-"
  if let percentage {
    let fraction = min(1, percentage / 100)
    let filled = Int(fraction * Double(width))
    return "[" + String(repeating: fill, count: filled)
      + String(repeating: empty, count: width - filled) + "]"
  }
  let step = Int(time.truncatingRemainder(dividingBy: 12) * 4) % 48
  let position = step <= 24 ? step : 48 - step
  return "[" + String(repeating: empty, count: position) + String(repeating: fill, count: 4)
    + String(repeating: empty, count: width - position - 4) + "]"
}

private func installPhaseName(_ phase: InstallationPhase) -> String {
  switch phase {
  case .metadata: return "Metadata"
  case .scanning: return "Verification"
  case .trimming: return "Trimming"
  case .running: return "Running"
  }
}

func installBytes(_ bytes: Double) -> String {
  let units = ["B", "kB", "MB", "GB", "TB", "PB", "EB"]
  var value = max(0, bytes)
  var unit = 0
  while value >= 1000 && unit < units.count - 1 {
    value /= 1000
    unit += 1
  }
  return String(
    format: unit == 0 ? "%.0f %@" : "%.3f %@",
    locale: Locale(identifier: "en_US_POSIX"), value, units[unit])
}

func installSpeed(_ rate: Double?) -> String {
  guard let rate, rate.isFinite else { return "—" }
  return installBytes(rate) + "/s"
}

func installDuration(_ value: Double?) -> String {
  guard let value, value.isFinite, value >= 0 else { return "—" }
  if value > 86400 { return String(format: "%.1f d", value / 86400) }
  let seconds = Int(value.rounded(.up))
  return String(format: "%02d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60)
}

func installText(_ value: String, limit: Int = 140) -> String {
  let safe = String(
    String.UnicodeScalarView(
      value.unicodeScalars.map {
        CharacterSet.controlCharacters.contains($0) ? UnicodeScalar(32)! : $0
      }))
  return safe.count > limit ? String(safe.prefix(limit)) + "..." : safe
}

// Mutable terminal state and potentially blocking writes are confined to this serial queue.
final class InstallTerminal: @unchecked Sendable {
  let interactive: Bool
  private let colors: Bool
  private let queue = DispatchQueue(label: "sophon.cli.output")
  private var previousLines = 0
  private var previousWidth = 0
  private var lastPlain: ContinuousClock.Instant?

  init(plain: Bool) {
    #if os(Windows)
      // Plain output works without assuming the console supports ANSI processing.
      interactive = false
    #else
      interactive =
        !plain && isatty(STDERR_FILENO) == 1
        && ProcessInfo.processInfo.environment["TERM"] != "dumb"
    #endif
    colors = interactive && ProcessInfo.processInfo.environment["NO_COLOR"] == nil
  }

  func write(_ frame: InstallFrame) async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      queue.async { [self] in
        continuation.resume(
          with: Result {
            var width = 80
            var height = 24
            #if !os(Windows)
              var size = winsize()
              if ioctl(STDERR_FILENO, UInt(TIOCGWINSZ), &size) == 0 {
                if size.ws_col > 0 { width = Int(size.ws_col) }
                if size.ws_row > 0 { height = Int(size.ws_row) }
              }
            #endif
            // Our bar glyphs are one cell; conservatively budget other Unicode by UTF-8 length.
            let lines = frame.lines.flatMap { line -> [String] in
              var result: [String] = []
              var current = ""
              var bytes = 0
              for character in line {
                let count = character == "█" || character == "░" ? 1 : String(character).utf8.count
                if bytes + count > max(1, width - 1) && !current.isEmpty {
                  result.append(current)
                  current = ""
                  bytes = 0
                }
                current.append(character)
                bytes += count
              }
              result.append(current)
              return result
            }
            let redraw = interactive && width >= 40 && lines.count < height
            let time = ContinuousClock.now
            if !redraw && !frame.force, let lastPlain,
              lastPlain.duration(to: time) < .seconds(1)
            {
              return
            }
            if width != previousWidth { previousLines = 0 }
            var output = ""
            if redraw {
              if previousLines > 0 { output += "\u{1B}[\(previousLines)F" }
              let count = max(previousLines, lines.count)
              for index in 0..<count {
                output += "\u{1B}[2K" + (index < lines.count ? styled(lines[index]) : "") + "\n"
              }
              if count > lines.count { output += "\u{1B}[\(count - lines.count)F" }
              previousLines = lines.count
            } else {
              output = lines.joined(separator: "\n") + "\n\n"
              previousLines = 0
              lastPlain = time
            }
            previousWidth = width
            try FileHandle.standardError.write(contentsOf: Data(output.utf8))
          })
      }
    }
  }

  private func styled(_ line: String) -> String {
    guard colors else { return line }
    let style: String?
    if line.hasPrefix("  SOPHON") {
      style = "1;36"
    } else if line == "  COMPLETED" {
      style = "1;32"
    } else if line == "  FAILED" || line.hasPrefix("  Error") {
      style = "1;31"
    } else if line.hasPrefix("  CANCEL") || line.hasPrefix("  Retry") {
      style = "1;33"
    } else if [
      "  METADATA", "  VERIFICATION", "  TRIMMING", "  RUNNING", "  CACHING", "  REPAIRING",
      "  DELETING",
    ].contains(line)
      || line.hasPrefix("  Read")
    {
      style = "1"
    } else if line.hasPrefix("  Target") || line.hasPrefix("  Stage")
      || line.hasPrefix("  Elapsed") || line.hasPrefix("  Latest")
    {
      style = "90"
    } else {
      style = nil
    }
    if let style { return "\u{1B}[\(style)m" + line + "\u{1B}[0m" }
    var output = ""
    var activeStyle = ""
    for character in line {
      let nextStyle = character == "█" ? "36" : (character == "░" ? "90" : "")
      if nextStyle != activeStyle {
        output += "\u{1B}[0m" + (nextStyle.isEmpty ? "" : "\u{1B}[\(nextStyle)m")
        activeStyle = nextStyle
      }
      output.append(character)
    }
    if !activeStyle.isEmpty { output += "\u{1B}[0m" }
    return output
  }
}

final class InstallInterrupts {
  #if os(Windows)
    private static let lock = NSLock()
    nonisolated(unsafe) private static var cancel: (@Sendable () -> Void)?
    private static let handler: @convention(c) (UInt32) -> WindowsBool = { event in
      guard event == UInt32(CTRL_C_EVENT) || event == UInt32(CTRL_BREAK_EVENT) else { return false }
      let action = InstallInterrupts.lock.withLock { InstallInterrupts.cancel }
      action?()
      return true
    }

    init(_ action: @escaping @Sendable () -> Void) {
      Self.lock.withLock { Self.cancel = action }
      SetConsoleCtrlHandler(Self.handler, true)
    }

    deinit {
      SetConsoleCtrlHandler(Self.handler, false)
      Self.lock.withLock { Self.cancel = nil }
    }
  #else
    private let source: DispatchSourceSignal
    private let termSource: DispatchSourceSignal
    private let previous: (@convention(c) (Int32) -> Void)?
    private let previousTerm: (@convention(c) (Int32) -> Void)?
    private let previousPipe: (@convention(c) (Int32) -> Void)?

    init(_ action: @escaping @Sendable () -> Void) {
      previous = signal(SIGINT, SIG_IGN)
      previousTerm = signal(SIGTERM, SIG_IGN)
      previousPipe = signal(SIGPIPE, SIG_IGN)
      source = DispatchSource.makeSignalSource(signal: SIGINT, queue: .global())
      termSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .global())
      source.setEventHandler(handler: action)
      termSource.setEventHandler(handler: action)
      source.activate()
      termSource.activate()
    }

    deinit {
      source.cancel()
      termSource.cancel()
      signal(SIGINT, previous)
      signal(SIGTERM, previousTerm)
      signal(SIGPIPE, previousPipe)
    }
  #endif
}
