import AsyncAlgorithms
import Foundation
import HPatch
import HYPAPIClient

extension Updater {
  func execute(
    _ plan: UpdatePlan, settings: TransferSettings, downloadCache: DownloadCache,
    installer: Installer, reporter: UpdateReporter, cacheOnly: Bool = false,
    gameID: String = "", mode: GameBranchCategoryScenario = .full, predownload: Bool = false,
    ignoredFiles: Set<String> = [],
    finalize: @escaping @Sendable () throws -> Void = {}
  ) async throws {
    let execution = try await UpdateExecution(
      plan: plan, gameDirectory: baseGameDir, settings: settings, downloadCache: downloadCache,
      installer: installer, downloadWorkers: maxCocurrentDownloads,
      writeWorkers: maxCocurrentWrites, reporter: reporter, cacheOnly: cacheOnly,
      gameID: gameID, mode: mode, predownload: predownload, ignoredFiles: ignoredFiles,
      finalize: finalize)
    await reporter.useResources(execution.workspace.telemetry)
    try await execution.run()
  }

}

extension PlannedPatchBundle {
  func downloadRequest() throws -> DownloadRequest {
    guard !downloadInfo.encryption, downloadInfo.password.isEmpty else {
      throw SophonClientError.UnsupportedManifestConfiguration(
        "Encrypted patch bundles are not supported")
    }
    return DownloadRequest(
      chunkID: patchID, url: try downloadInfo.buildDownloadURL(patchID), md5: patchHash,
      size: patchSize)
  }
}

private struct ReadyPatch: Sendable {
  let patch: PlannedPatch
  let bundle: PatchPayload
}

private final class PatchPayload: @unchecked Sendable {
  let input: PatchInput
  let request: DownloadRequest
  private let workspace: TransferWorkspace?
  private let lock = NSLock()
  private var consumers: Int

  init(
    input: PatchInput, request: DownloadRequest, consumers: Int,
    workspace: TransferWorkspace? = nil
  ) {
    self.input = input
    self.request = request
    self.consumers = consumers
    self.workspace = workspace
  }

  func consumed() async throws {
    let finished = lock.withLock {
      consumers -= 1
      return consumers == 0
    }
    if finished, let workspace, case .cached(let binary) = input {
      try await workspace.consumed(binary, request: request)
    }
  }
}

private actor RepairTargets {
  private var files: [URL: PlannedUpdateFile] = [:]
  func add(_ file: PlannedUpdateFile) { files[file.fileURL] = file }
  func all() -> [PlannedUpdateFile] { files.values.sorted { $0.fileURL.path < $1.fileURL.path } }
}

private actor CachedPayloads {
  private var downloads: [URL: CachedDownload] = [:]
  func retain(_ download: CachedDownload) { downloads[download.fileURL] = download }

  func releaseAll() throws {
    for download in downloads.values { try download.release() }
    downloads.removeAll()
  }
}

private final class UpdateExecution: Sendable {
  let workspace: TransferWorkspace
  private let plan: UpdatePlan
  private let cacheOnly: Bool
  private let cachedPayloads = CachedPayloads()
  private let settings: TransferSettings
  private let downloadCache: DownloadCache
  private let installer: Installer
  private let reporter: UpdateReporter
  private let finalize: @Sendable () throws -> Void
  private let journal: UpdateJournal?
  private let operationLock: TransferFileLock
  private let snapshots: OriginalSnapshots
  private let originalsDirectory: URL
  private let io: WorkLimiter
  private let repairs = RepairTargets()
  private let downloadWorkers: Int
  private let workers: [PatchApplyWorker]

  init(
    plan: UpdatePlan, gameDirectory: URL, settings: TransferSettings, downloadCache: DownloadCache,
    installer: Installer, downloadWorkers: Int, writeWorkers: Int, reporter: UpdateReporter,
    cacheOnly: Bool, gameID: String, mode: GameBranchCategoryScenario, predownload: Bool,
    ignoredFiles: Set<String>,
    finalize: @escaping @Sendable () throws -> Void
  ) async throws {
    guard cacheOnly || settings.diskCacheEnabled || settings.writeMode != .inPlace else {
      throw SophonClientError.UnknownError(
        "In-place updates require disk recovery originals; use temporary output with --no-disk-cache"
      )
    }
    self.settings = settings
    self.cacheOnly = cacheOnly
    self.downloadCache = downloadCache
    self.installer = installer
    self.downloadWorkers = downloadWorkers
    self.reporter = reporter
    self.finalize = finalize
    io = WorkLimiter(limit: settings.ioPolicy == .serialized ? 1 : Int.max)
    workers = (0..<(settings.ioPolicy == .serialized ? 1 : writeWorkers)).map(PatchApplyWorker.init)
    operationLock = try await runTransferIO {
      try TransferFileLock(gameDirectory.appendingPathComponent(".sophon-operation.lock"))
    }
    let installDirectory = InstallationJournal.directory(
      settings: settings, gameDirectory: gameDirectory)
    let installation = try await runTransferIO {
      try InstallationJournal.load(directory: installDirectory)
    }
    guard installation?.finished != false else {
      throw SophonClientError.UnknownError(
        "Resume the unfinished installation before starting an update")
    }
    let stateDirectory = UpdateJournal.directory(settings: settings, gameDirectory: gameDirectory)
    if !settings.preserveState { try await runTransferIO { try removeOwnedFile(stateDirectory) } }
    let journal =
      settings.preserveState
      ? try await runTransferIO {
        try UpdateJournal(
          directory: stateDirectory, plan: plan, gameID: gameID, mode: mode,
          predownload: predownload, cacheOnly: cacheOnly,
          predownloadDirectory: settings.predownloadURL(gameDirectory: gameDirectory).path,
          ignoredFiles: ignoredFiles)
      } : nil
    self.journal = journal
    let activePlan = journal?.plan ?? excludingIgnoredFiles(from: plan, ignoredFiles: ignoredFiles)
    self.plan = activePlan
    let originals = stateDirectory.appendingPathComponent("originals", isDirectory: true)
    workspace = try await TransferWorkspace(
      settings: settings, gameDirectory: gameDirectory, operation: "update",
      transport: downloadCache, io: io, recoveryDirectory: originals)
    originalsDirectory = originals
    let sizes = try await runTransferIO {
      try OriginalSnapshots.existingSizes(directory: originals)
    }
    snapshots = OriginalSnapshots(
      cache: workspace.cache, directory: originals, io: io,
      plan: activePlan,
      writeMode: settings.writeMode, existingSizes: sizes, cacheOnly: cacheOnly,
      telemetry: workspace.telemetry, diskCacheEnabled: settings.diskCacheEnabled)
  }

  func run() async throws {
    await reporter.record(
      .planned(
        sourceVersion: plan.sourceVersion, targetVersion: plan.targetVersion,
        patchBytes: plan.patchSize, installBytes: plan.installSize,
        totalFiles: plan.installFiles.count, deleteFiles: plan.deleteFiles.count,
        deleteBytes: plan.deleteSize))
    do {
      guard !cacheOnly || plan.patchSize <= downloadCache.diskLimit else {
        throw SophonClientError.UnknownError("The download cache cannot hold the complete update")
      }
      var recovered = Set<URL>()
      for patch in plan.patchBundles.flatMap(\.patches) {
        try await installer.control?.checkpoint()
        if try await recover(patch.target) {
          recovered.insert(patch.target.fileURL)
          try await done(patch, skipped: true)
        } else if !cacheOnly
          && (journal?.stage(of: patch.target.fileURL) == .repair
            || journal?.stage(of: patch.target.fileURL) == .cachedRepair)
        {
          recovered.insert(patch.target.fileURL)
          await repairs.add(patch.target)
          await reporter.record(.fileNeedsRepair(fileURL: patch.target.fileURL))
          if let original = patch.original { try await snapshots.consumed(original) }
        }
      }
      try await snapshots.preloadSharedSources(plan)
      await reporter.record(.phaseChanged(cacheOnly ? .caching : .running))
      try await pipeline(excluding: recovered)
      let repairFiles = await repairs.all()
      if !repairFiles.isEmpty { try await repair(repairFiles) }
      if !cacheOnly {
        await reporter.record(.phaseChanged(.deleting))
        for file in plan.deleteFiles {
          try await installer.control?.checkpoint()
          try Task.checkCancellation()
          let removed = try await runTransferIO {
            let exists = FileManager.default.fileExists(atPath: file.fileURL.path)
            try removeOwnedFile(file.fileURL)
            return exists
          }
          await reporter.record(.fileDeleted(fileURL: file.fileURL, bytes: removed ? file.size : 0))
        }
      }
      try await runTransferIO(checkCancellation: false) { [self] in
        if !cacheOnly { try finalize() }
        try journal?.complete()
      }
      await snapshots.close()
      try await cachedPayloads.releaseAll()
      try await workspace.finish(completed: true)
      try await runTransferIO(checkCancellation: false) { [originalsDirectory] in
        try removeOwnedFile(originalsDirectory)
      }
      await reporter.record(.finished(.completed))
    } catch {
      await snapshots.close()
      try? await cachedPayloads.releaseAll()
      try? await workspace.finish(completed: false)
      await reporter.record(
        .finished(Task.isCancelled ? .cancelled : .failed(reason: error.localizedDescription)))
      throw error
    }
  }

  private func pipeline(excluding recovered: Set<URL>) async throws {
    let bundles = plan.patchBundles.filter { bundle in
      bundle.patches.contains { !recovered.contains($0.target.fileURL) }
    }
    if !cacheOnly {
      var requests = try bundles.map { try $0.downloadRequest() }
      for file in await repairs.all() {
        requests += try file.installChunks.map { try $0.downloadRequest() }
      }
      try await workspace.retainOnlyDownloads(requests)
    }
    await reporter.record(.patchDownloadsPlanned(bytes: bundles.reduce(0) { $0 + $1.patchSize }))
    for bundle in bundles {
      let request = try bundle.downloadRequest()
      let retained =
        cacheOnly
        ? try await downloadCache.retainedBytes(request)
        : try await workspace.retainedBytes(request)
      workspace.telemetry.planDownload(bundle.patchID, size: bundle.patchSize, retained: retained)
    }
    let ready = AsyncChannel<ReadyPatch>()
    let downloadLimit = WorkLimiter(limit: min(downloadWorkers, settings.entryLimit))
    try await withThrowingTaskGroup(of: Void.self) { group in
      group.addTask { [self] in
        defer { ready.finish() }
        try await withThrowingTaskGroup(of: Void.self) { downloads in
          for bundle in bundles {
            try await installer.control?.checkpoint()
            let patches = bundle.patches.filter { !recovered.contains($0.target.fileURL) }
            guard !patches.isEmpty else { continue }
            downloads.addTask { [self] in
              try await downloadLimit.withPermit {
                let request = try bundle.downloadRequest()
                let payload: PatchPayload
                if cacheOnly {
                  let downloaded = try await downloadCache.get(
                    request, waitForSpace: false, telemetry: workspace.telemetry)
                  await cachedPayloads.retain(downloaded)
                  payload = PatchPayload(
                    input: .download(downloaded, offset: 0, size: downloaded.size),
                    request: request, consumers: patches.count)
                } else {
                  var memoryHeadroom: UInt64 = 0
                  var diskHeadroom: UInt64 = 0
                  for original in patches.compactMap(\.original) {
                    if await snapshots.requiresDisk(original)
                      || original.size > settings.memoryLimit
                    {
                      diskHeadroom = max(
                        diskHeadroom, await snapshots.additionalDiskBytes(original))
                    } else {
                      memoryHeadroom = max(memoryHeadroom, original.size)
                    }
                  }
                  let binary = try await workspace.download(
                    request,
                    purpose: .download(
                      memoryHeadroom: memoryHeadroom, diskHeadroom: diskHeadroom))
                  payload = PatchPayload(
                    input: .cached(binary), request: request, consumers: patches.count,
                    workspace: workspace)
                }
                await reporter.record(
                  .bundleDownloaded(patchID: bundle.patchID, bytes: bundle.patchSize))
                for patch in patches {
                  try Task.checkCancellation()
                  await ready.send(ReadyPatch(patch: patch, bundle: payload))
                }
              }
            }
          }
          do { while try await downloads.next() != nil {} } catch {
            downloads.cancelAll()
            throw error
          }
        }
      }
      for worker in workers {
        group.addTask { [self] in
          for await job in ready {
            try await installer.control?.checkpoint()
            try Task.checkCancellation()
            try await process(job, worker: worker)
            try await job.bundle.consumed()
          }
        }
      }
      do { while try await group.next() != nil {} } catch {
        group.cancelAll()
        ready.finish()
        throw error
      }
    }
  }

  private func process(_ job: ReadyPatch, worker: PatchApplyWorker) async throws {
    let patch = job.patch
    if cacheOnly {
      try await cached(patch)
      return
    }
    await reporter.record(.fileStarted(fileURL: patch.target.fileURL))
    let input = try job.bundle.input.slice(offset: patch.patchOffset, size: patch.patchLength)
    let isHDiff = try await runTransferIO { try input.isHDiff(telemetry: self.workspace.telemetry) }
    var originalInput: PatchInput?
    if isHDiff, let original = patch.original {
      let snapshot = try await snapshots.get(original)
      if original.fileURL == patch.target.fileURL, !snapshot.fromSavedOriginal,
        snapshot.observed?.size == patch.target.size,
        snapshot.observed?.md5 == patch.target.md5.lowercased()
      {
        try await done(patch, skipped: true)
        return
      }
      if original.fileURL != patch.target.fileURL || snapshot.fromSavedOriginal {
        if try await current(patch.target) {
          try await done(patch, skipped: true)
          return
        }
      }
      guard snapshot.observed?.size == original.size,
        snapshot.observed?.md5 == original.md5.lowercased()
      else {
        try await queueRepair(patch)
        return
      }
      originalInput = snapshot.input
    } else if try await current(patch.target) {
      try await done(patch, skipped: true)
      return
    }

    let paths = outputPaths(patch.target)
    let output = settings.writeMode == .inPlace ? patch.target.fileURL : paths.temporary
    let request = PatchApplyRequest(
      original: originalInput, patch: input, target: patch.target, outputURL: output,
      synchronize: settings.ioPolicy == .serialized, telemetry: workspace.telemetry)
    do {
      try await io.withPermit { [journal] in
        try await runTransferIO { try journal?.record(patch.target.fileURL, stage: .writing) }
        try await worker.run(request)
        try await runTransferIO(checkCancellation: false) {
          if output != patch.target.fileURL {
            try commitUpdatedFile(
              temporary: output, target: patch.target.fileURL, backup: paths.backup)
          }
          try journal?.record(patch.target.fileURL, stage: .completed)
        }
      }
      try await done(patch, skipped: false)
    } catch {
      if error is CancellationError || Task.isCancelled { throw error }
      if error is HPatchError || error is BinaryCacheError {
        try await queueRepair(patch)
      } else if let error = error as? SophonClientError {
        switch error {
        case .InvalidChecksumError, .SizeMismatch, .UnsupportedManifestConfiguration:
          try await queueRepair(patch)
        default: throw error
        }
      } else {
        throw error
      }
    }
  }

  private func current(_ target: PlannedUpdateFile) async throws -> Bool {
    try await io.withPermit {
      let digest = try await runTransferIO {
        guard (try? transferFileMetadata(target.fileURL.path).size) == target.size else {
          return nil as FileDigest?
        }
        return try digestFile(target.fileURL, telemetry: self.workspace.telemetry)
      }
      return digest?.size == target.size && digest?.md5 == target.md5.lowercased()
    }
  }

  private func outputPaths(_ target: PlannedUpdateFile) -> (temporary: URL, backup: URL) {
    let key = transferKey(target.fileURL.path + target.md5).prefix(32)
    let directory = target.fileURL.deletingLastPathComponent()
    return (
      directory.appendingPathComponent(".sophon-\(key).new"),
      directory.appendingPathComponent(".sophon-\(key).old")
    )
  }

  private func recover(_ target: PlannedUpdateFile) async throws -> Bool {
    let paths = outputPaths(target)
    let journal = journal
    if cacheOnly { return false }
    return try await io.withPermit {
      try await runTransferIO {
        if journal?.stage(of: target.fileURL) == .completed {
          try removeOwnedFile(paths.temporary)
          try removeOwnedFile(paths.backup)
          return true
        }
        if FileManager.default.fileExists(atPath: paths.backup.path),
          !FileManager.default.fileExists(atPath: target.fileURL.path)
        {
          try FileManager.default.moveItem(at: paths.backup, to: target.fileURL)
        }
        if let digest = try digestFile(paths.temporary, telemetry: self.workspace.telemetry),
          digest.size == target.size, digest.md5 == target.md5.lowercased()
        {
          try commitUpdatedFile(
            temporary: paths.temporary, target: target.fileURL, backup: paths.backup)
          return true
        }
        if (try? transferFileMetadata(target.fileURL.path).size) == target.size,
          let digest = try digestFile(target.fileURL, telemetry: self.workspace.telemetry),
          digest.size == target.size, digest.md5 == target.md5.lowercased()
        {
          try removeOwnedFile(paths.backup)
          return true
        }
        return false
      }
    }
  }

  private func cached(_ patch: PlannedPatch) async throws {
    try await runTransferIO(checkCancellation: false) { [journal] in
      try journal?.record(patch.target.fileURL, stage: .cachedPatch)
    }
    await reporter.record(.fileCached(fileURL: patch.target.fileURL))
    if let original = patch.original { try await snapshots.consumed(original) }
  }

  private func done(_ patch: PlannedPatch, skipped: Bool) async throws {
    if cacheOnly {
      try await cached(patch)
      return
    }
    let paths = outputPaths(patch.target)
    try await io.withPermit { [journal] in
      try await runTransferIO(checkCancellation: false) {
        try removeOwnedFile(paths.temporary)
        try removeOwnedFile(paths.backup)
        try journal?.record(patch.target.fileURL, stage: .completed)
      }
    }
    await reporter.record(
      .fileCompleted(fileURL: patch.target.fileURL, bytes: patch.target.size, skipped: skipped))
    if let original = patch.original { try await snapshots.consumed(original) }
  }

  private func queueRepair(_ patch: PlannedPatch) async throws {
    try await runTransferIO { [journal] in try journal?.record(patch.target.fileURL, stage: .repair)
    }
    await repairs.add(patch.target)
    await reporter.record(.fileNeedsRepair(fileURL: patch.target.fileURL))
    if let original = patch.original { try await snapshots.consumed(original) }
  }

  private func repair(_ files: [PlannedUpdateFile]) async throws {
    await reporter.record(.phaseChanged(.repairing))
    if cacheOnly {
      let chunks = try makeRepairPlan(
        files, outputURLs: Dictionary(uniqueKeysWithValues: files.map { ($0.fileURL, $0.fileURL) })
      ).requiredChunks
      let limit = WorkLimiter(limit: downloadWorkers)
      try await withThrowingTaskGroup(of: Void.self) { group in
        for chunk in chunks {
          group.addTask { [self] in
            try await limit.withPermit {
              let download = try await downloadCache.get(
                chunk.downloadRequest(), waitForSpace: false)
              await cachedPayloads.retain(download)
            }
          }
        }
        do { while try await group.next() != nil {} } catch {
          group.cancelAll()
          throw error
        }
      }
      for file in files {
        try await runTransferIO(checkCancellation: false) { [journal] in
          try journal?.record(file.fileURL, stage: .cachedRepair)
        }
        await reporter.record(.fileCached(fileURL: file.fileURL))
      }
      return
    }
    let paths = Dictionary(
      uniqueKeysWithValues: files.map {
        ($0.fileURL, settings.writeMode == .inPlace ? $0.fileURL : outputPaths($0).temporary)
      })
    let repairPlan = try makeRepairPlan(files, outputURLs: paths)
    for file in repairPlan.plannedFiles {
      try await runTransferIO {
        try FileManager.default.createDirectory(
          at: file.fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        guard FileManager.default.createFile(atPath: file.fileURL.path, contents: nil) else {
          throw SophonClientError.UnknownError("Cannot create repair output")
        }
        let handle = try FileHandle(forUpdating: file.fileURL)
        defer { try? handle.close() }
        try handle.truncate(atOffset: file.size)
      }
    }
    await reporter.record(
      .repairPlanned(downloadBytes: repairPlan.downloadSize, writeBytes: repairPlan.diskWriteSize))
    let repairReporter = InstallationReporter(logger: reporter.logger)
    let subscription = await repairReporter.subscribe()
    let progress = Task { [reporter] in
      for await event in subscription.events {
        switch event {
        case .chunkDownloaded(_, let bytes): await reporter.record(.repairDownloaded(bytes: bytes))
        case .chunkWritten(_, _, _, let bytes): await reporter.record(.repairWritten(bytes: bytes))
        default: break
        }
      }
    }
    do {
      try await installer.execute(
        repairPlan, reporter: repairReporter, serializedWrites: settings.ioPolicy == .serialized,
        workspace: workspace)
    } catch {
      await repairReporter.unsubscribe(subscription.id)
      await progress.value
      throw error
    }
    await repairReporter.unsubscribe(subscription.id)
    await progress.value
    if settings.ioPolicy == .serialized {
      // Flush the whole write batch before verification starts reading from the target drive.
      for output in paths.values {
        try await runTransferIO {
          let handle = try FileHandle(forWritingTo: output)
          defer { try? handle.close() }
          try handle.synchronize()
        }
      }
    }
    for file in files {
      let output = paths[file.fileURL]!
      let paths = outputPaths(file)
      try await runTransferIO { [journal] in
        let digest = try digestFile(output, telemetry: self.workspace.telemetry)
        guard digest?.size == file.size, digest?.md5 == file.md5.lowercased() else {
          throw SophonClientError.InvalidChecksumError(
            expected: file.md5, actual: digest?.md5 ?? "missing")
        }
        if output != file.fileURL {
          try commitUpdatedFile(temporary: output, target: file.fileURL, backup: paths.backup)
        }
        try journal?.record(file.fileURL, stage: .completed)
      }
      await reporter.record(.fileCompleted(fileURL: file.fileURL, bytes: file.size, skipped: false))
    }
  }
}

private func makeRepairPlan(_ files: [PlannedUpdateFile], outputURLs: [URL: URL]) throws
  -> InstallationPlan
{
  var chunks: [String: RequiredChunk] = [:]
  var plannedFiles: [PlannedFile] = []
  for file in files {
    let output = outputURLs[file.fileURL]!
    plannedFiles.append(
      PlannedFile(
        fileURL: output, size: file.size, md5: file.md5,
        requiredChunkCount: file.installChunks.count, needsTrimming: false))
    for var chunk in file.installChunks {
      chunk.chunkApplicationInfos = chunk.chunkApplicationInfos.map {
        ChunkApplicationInfo(fileURL: output, offset: $0.offset)
      }
      if var existing = chunks[chunk.chunkID] {
        guard existing.uncompressedMd5 == chunk.uncompressedMd5,
          existing.compressedMd5 == chunk.compressedMd5,
          existing.uncompressedSize == chunk.uncompressedSize,
          existing.compressedSize == chunk.compressedSize
        else { throw SophonClientError.UnknownError("Conflicting repair chunk metadata") }
        existing.chunkApplicationInfos += chunk.chunkApplicationInfos
        chunks[chunk.chunkID] = existing
      } else {
        chunks[chunk.chunkID] = chunk
      }
    }
  }
  let required = chunks.values.sorted { $0.chunkID < $1.chunkID }
  return InstallationPlan(
    totalChunkCount: required.count,
    downloadSize: required.reduce(0) {
      $0 + ($1.downloadInfo.compression ? $1.compressedSize : $1.uncompressedSize)
    },
    diskWriteSize: files.reduce(0) { $0 + $1.size }, requiredChunks: required,
    plannedFiles: plannedFiles)
}
