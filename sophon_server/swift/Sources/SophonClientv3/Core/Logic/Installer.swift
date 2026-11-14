import AsyncAlgorithms
import Foundation
import HYPAPIClient

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

final class Installer: Sendable {
  let baseGameDir: URL
  let checker: ChunkCheckWorker
  let downloader: DownloadWorker
  let postProcessor: ChunkPostProcessWorker

  let maxCocurrentChecks: Int
  let maxCocurrentDownloads: Int
  let maxCocurrentPostProcessors: Int
  let maxCocurrentWrites: Int
  let maxCachedFileHandles: Int
  let transferSettings: TransferSettings
  let control: TransferControl?

  internal init(
    baseGameDir: URL, maxCocurrentChecks: Int, maxCocurrentDownloads: Int,
    maxCocurrentPostProcessors: Int, maxCocurrentWrites: Int, session: URLSession = .shared,
    maxRetries: Int = 10,
    retryInterval: Int = 5, maxCachedFileHandles: Int = 512, downloadCache: DownloadCache? = nil,
    transferSettings: TransferSettings = TransferSettings(), control: TransferControl? = nil
  ) throws {
    self.baseGameDir = baseGameDir
    self.checker = ChunkCheckWorker(baseGameDir: self.baseGameDir)
    self.downloader = DownloadWorker(
      session: session, maxRetries: maxRetries, retryInterval: retryInterval, cache: downloadCache)
    self.postProcessor = ChunkPostProcessWorker()

    self.maxCocurrentChecks = maxCocurrentChecks
    self.maxCocurrentDownloads = maxCocurrentDownloads
    self.maxCocurrentPostProcessors = maxCocurrentPostProcessors
    self.maxCocurrentWrites = maxCocurrentWrites
    self.maxCachedFileHandles = maxCachedFileHandles
    self.transferSettings = transferSettings
    self.control = control
    guard maxCocurrentChecks > 0 else {
      throw SophonClientError.UnknownError("MaxCocurrentChecks should be a positive integer")
    }
    guard maxCocurrentDownloads > 0 else {
      throw SophonClientError.UnknownError("MaxCocurrentDownloads should be a positive integer")
    }
    guard maxCocurrentPostProcessors > 0 else {
      throw SophonClientError.UnknownError(
        "MaxCocurrentPostProcessors should be a positive integer")
    }
    guard maxCocurrentWrites > 0 else {
      throw SophonClientError.UnknownError("MaxCocurrentWrites should be a positive integer")
    }
    guard maxCachedFileHandles >= maxCocurrentWrites else {
      throw SophonClientError.UnknownError(
        "File handle cache budget must allow at least one handle per disk writer")
    }
  }

  private func ensureSameChunk(expected chunk1: RequiredChunk, got chunk2: ChunkInfo) throws {
    guard chunk1.uncompressedMd5 == chunk2.md5,
      chunk1.compressedMd5 == chunk2.compressedMd5,
      chunk1.compressedSize == UInt64(chunk2.compressedSize),
      chunk1.uncompressedSize == UInt64(chunk2.uncompressedSize)
    else {
      throw SophonClientError.UnknownError(
        "Conflicting metadata for chunk \(chunk2.chunkID)"
      )
    }
  }

  internal func scan(
    installInfos: [(manifest: Manifest, chunkDownloadInfo: SophonDownloadInfo)],
    ignoredFiles: Set<String> = [],
    reporter: InstallationReporter? = nil, quickVerify: Bool = false
  )
    async throws
    -> InstallationPlan
  {
    await reporter?.record(.phaseChanged(.scanning))
    let manifests = installInfos.map(\.manifest)
    let chunkDownloadInfos = installInfos.map(\.chunkDownloadInfo)
    try checkManifests(manifests)  // this checks fileInfo too

    var totalFiles = 0
    var totalChunks = 0
    var totalBytes: UInt64 = 0
    for manifest in manifests {
      for file in manifest.files where file.flags == FILE_FLAG_FILE {
        if !ignoredFiles.isEmpty,
          ignoredFiles.contains(ignoredFileKey(baseGameDir.appendingPathComponent(file.filename)))
        {
          continue
        }
        totalFiles += 1
        totalChunks += file.chunks.count
        for chunk in file.chunks {
          totalBytes += UInt64(chunk.uncompressedSize)
        }
      }
    }
    await reporter?.record(
      .scanPlanned(totalFiles: totalFiles, totalChunks: totalChunks, totalBytes: totalBytes))

    var manifestIndex = 0
    var fileIndex = 0
    func nextJob() -> ScanJob? {
      while manifestIndex < manifests.count {
        let files = manifests[manifestIndex].files

        if fileIndex < files.count {
          let file = files[fileIndex]
          fileIndex += 1
          if file.flags == FILE_FLAG_DIRECTORY {
            continue
          }
          if !ignoredFiles.isEmpty,
            ignoredFiles.contains(ignoredFileKey(baseGameDir.appendingPathComponent(file.filename)))
          {
            continue
          }

          return ScanJob(
            file: file,
            downloadInfo: chunkDownloadInfos[manifestIndex]
          )
        }
        manifestIndex += 1
        fileIndex = 0
      }
      return nil
    }

    let checker = self.checker
    return try await withThrowingTaskGroup(
      of: ScanResult.self
    ) {
      group in
      var requiredChunksByID: [String: RequiredChunk] = [:]
      var plannedFiles: [PlannedFile] = []

      for _ in 0..<maxCocurrentChecks {
        guard let job = nextJob() else {
          break
        }

        group.addTask { [control] in
          try await control?.checkpoint()
          return ScanResult(
            state: try await checker.run(job.file, reporter: reporter, quickVerify: quickVerify),
            downloadInfo: job.downloadInfo
          )
        }
      }

      while let result = try await group.next() {
        if let job = nextJob() {
          group.addTask { [control] in
            try await control?.checkpoint()
            return ScanResult(
              state: try await checker.run(job.file, reporter: reporter, quickVerify: quickVerify),
              downloadInfo: job.downloadInfo
            )
          }
        }

        let state = result.state
        if state.requiredChunks.isEmpty && !state.needsTrimming {
          await reporter?.record(.fileCompleted(filePath: state.filePath))
        }
        plannedFiles.append(
          PlannedFile(
            fileURL: state.filePath, size: state.size, md5: state.md5,
            requiredChunkCount: state.requiredChunks.count, needsTrimming: state.needsTrimming))

        for chunk in state.requiredChunks {
          let applicationInfo = ChunkApplicationInfo(
            fileURL: state.filePath,
            offset: chunk.offset
          )

          if var existing = requiredChunksByID[chunk.chunkID] {
            try ensureSameChunk(expected: existing, got: chunk)
            existing.chunkApplicationInfos.append(applicationInfo)
            requiredChunksByID[chunk.chunkID] = existing
          } else {
            requiredChunksByID[chunk.chunkID] = RequiredChunk(
              chunkID: chunk.chunkID,
              uncompressedMd5: chunk.md5,
              compressedMd5: chunk.compressedMd5,
              compressedSize: UInt64(chunk.compressedSize),
              uncompressedSize: UInt64(chunk.uncompressedSize),
              downloadInfo: result.downloadInfo,
              chunkApplicationInfos: [applicationInfo]
            )
          }
        }
      }

      let requiredChunks = requiredChunksByID.values.sorted {
        let first = $0.chunkApplicationInfos.first!
        let second = $1.chunkApplicationInfos.first!
        if first.fileURL != second.fileURL { return first.fileURL.path < second.fileURL.path }
        return first.offset < second.offset
      }
      let downloadSize = requiredChunks.reduce(0) {
        $0 + ($1.downloadInfo.compression ? $1.compressedSize : $1.uncompressedSize)
      }
      let diskWriteSize = requiredChunks.reduce(UInt64(0)) {
        $0 + $1.uncompressedSize * UInt64($1.chunkApplicationInfos.count)
      }
      await reporter?.record(
        .planned(
          downloadBytes: downloadSize, writeBytes: diskWriteSize,
          totalChunk: requiredChunks.count, totalFile: plannedFiles.count))
      return InstallationPlan(
        totalChunkCount: requiredChunks.count,
        downloadSize: downloadSize,
        diskWriteSize: diskWriteSize,
        requiredChunks: requiredChunks,
        plannedFiles: plannedFiles,
      )
    }
  }

  // template function for workers with different input and outputs
  private func runStage<Input: Sendable, Output: Sendable>(
    workerCount: Int,
    input: AsyncChannel<Input>,
    output: AsyncChannel<Output>,
    transform: @escaping @Sendable (Input) async throws -> Output
  ) async throws {
    defer {
      output.finish()
    }

    try await withThrowingTaskGroup(of: Void.self) { group in
      for _ in 0..<workerCount {
        group.addTask {
          for await value in input {
            try Task.checkCancellation()

            let result = try await transform(value)
            await output.send(result)
          }
        }
      }

      do {
        while (try await group.next()) != nil {}
      } catch {
        group.cancelAll()
        throw error
      }
    }
  }

  internal func install(
    installInfos: [(manifest: Manifest, chunkDownloadInfo: SophonDownloadInfo)],
    reporter: InstallationReporter? = nil,
    finishReport: Bool = true
  )
    async throws
  {
    do {
      let plan = try await scan(installInfos: installInfos, reporter: reporter)
      try await install(plan, reporter: reporter, finishReport: finishReport)
    } catch {
      await reporter?.record(
        .finished(Task.isCancelled ? .cancelled : .failed(reason: error.localizedDescription)))
      throw error
    }
  }

  internal func install(
    _ plan: InstallationPlan, reporter: InstallationReporter? = nil,
    journal: InstallationJournal? = nil, finishReport: Bool = true
  ) async throws {
    do {
      try Task.checkCancellation()
      await reporter?.record(.phaseChanged(.trimming))
      try await trimFiles(plan: plan, reporter: reporter, journal: journal)
      try Task.checkCancellation()

      try await execute(plan, reporter: reporter, journal: journal)
      if finishReport { await reporter?.record(.finished(.completed)) }
    } catch {
      if error is CancellationError || Task.isCancelled {
        await reporter?.record(.finished(.cancelled))
      } else {
        await reporter?.record(.finished(.failed(reason: error.localizedDescription)))
      }
      throw error
    }
  }

  private func trimFiles(
    plan: InstallationPlan,
    reporter: InstallationReporter? = nil,
    journal: InstallationJournal? = nil
  ) async throws {
    for file in plan.trimFiles {
      try Task.checkCancellation()

      let fileURL = file.fileURL.standardizedFileURL
      let handle = try FileHandle(forWritingTo: fileURL)
      do {
        let currentSize = try handle.seekToEnd()
        guard currentSize >= file.size else {
          throw SophonClientError.UnknownError(
            """
            File became shorter than the saved trimming plan
            path: \(fileURL.path)
            expected maximum: \(file.size)
            actual: \(currentSize)
            """
          )
        }

        if currentSize > file.size { try handle.truncate(atOffset: file.size) }
        try handle.close()
        try await runTransferIO(checkCancellation: false) { try journal?.trimmed(fileURL) }
        await reporter?.record(.fileTrimmed(filePath: fileURL))
        if file.requiredChunkCount == 0 {
          await reporter?.record(.fileCompleted(filePath: fileURL))
        }
      } catch {
        try? handle.close()
        throw error
      }
    }
  }

  internal func execute(
    _ plan: InstallationPlan,
    reporter: InstallationReporter? = nil,
    journal: InstallationJournal? = nil,
    serializedWrites: Bool = false,
    workspace providedWorkspace: TransferWorkspace? = nil
  ) async throws {
    let workspace: TransferWorkspace
    if let providedWorkspace {
      workspace = providedWorkspace
    } else {
      let transport =
        downloader.cache
        ?? DownloadCache(
          directory: transferSettings.cacheURL.appendingPathComponent("working"),
          diskLimit: transferSettings.diskLimit,
          maxConcurrentDownloads: maxCocurrentDownloads,
          maxRetries: downloader.maxRetries, retryInterval: downloader.retryInterval,
          configuration: downloader.session.configuration)
      workspace = try await TransferWorkspace(
        settings: transferSettings, gameDirectory: baseGameDir, operation: "install",
        transport: transport)
    }
    await reporter?.useResources(workspace.telemetry)
    if providedWorkspace == nil {
      try await workspace.retainOnlyDownloads(
        plan.requiredChunks.map { try $0.downloadRequest() })
    }
    await reporter?.record(.phaseChanged(.running))
    let requiredChunks = AsyncChannel<RequiredChunk>()
    let downloadedChunks = AsyncChannel<DownloadedChunk>()
    let processedChunks = AsyncChannel<ProcessedChunk>()

    let writeCoordinator = try ChunkWriteCoordinator(
      plannedFiles: plan.plannedFiles,
      workerCount: serializedWrites ? 1 : maxCocurrentWrites,
      maxCachedFileHandles: maxCachedFileHandles,
      reporter: reporter, journal: journal, telemetry: workspace.telemetry
    )

    do {
      try await withThrowingTaskGroup(of: Void.self) { group in
        group.addTask {
          defer {
            requiredChunks.finish()
          }

          for chunk in plan.requiredChunks {
            try Task.checkCancellation()
            try await self.control?.checkpoint()
            await requiredChunks.send(chunk)
          }
        }

        group.addTask { [self] in
          try await runStage(
            workerCount: maxCocurrentDownloads,
            input: requiredChunks,
            output: downloadedChunks
          ) { [self] chunk in
            try await download(chunk, reporter: reporter, workspace: workspace)
          }
        }

        group.addTask { [self] in
          try await runStage(
            workerCount: maxCocurrentPostProcessors,
            input: downloadedChunks,
            output: processedChunks
          ) { [self] chunk in
            try await control?.checkpoint()
            let processed = try await postProcessChunk(chunk, workspace: workspace)
            await reporter?.record(
              .chunkPostProcessed(
                chunkID: chunk.chunkID, compressed_bytes: chunk.data.size,
                uncompressed_bytes: processed.data.size))
            return processed
          }
        }

        group.addTask {
          try await writeCoordinator.run(processedChunks)
        }

        do {
          while (try await group.next()) != nil {}
        } catch {
          group.cancelAll()

          requiredChunks.finish()
          downloadedChunks.finish()
          processedChunks.finish()

          throw error
        }
      }

      try Task.checkCancellation()
      try await writeCoordinator.ensureComplete()
      if providedWorkspace == nil { try await workspace.finish(completed: true) }
    } catch {
      requiredChunks.finish()
      downloadedChunks.finish()
      processedChunks.finish()

      await writeCoordinator.closeAll()
      if providedWorkspace == nil { try? await workspace.finish(completed: false) }
      throw error
    }
  }

  private func download(
    _ chunk: RequiredChunk,
    reporter: InstallationReporter?,
    workspace: TransferWorkspace
  ) async throws -> DownloadedChunk {
    guard !chunk.downloadInfo.encryption,
      chunk.downloadInfo.password.isEmpty
    else {
      throw SophonClientError.UnsupportedManifestConfiguration(
        "Encrypted chunks are not supported"
      )
    }

    let downloadURL = try chunk.getDownloadURL()
    let md5 = chunk.downloadInfo.compression ? chunk.compressedMd5 : chunk.uncompressedMd5
    let size = chunk.downloadInfo.compression ? chunk.compressedSize : chunk.uncompressedSize
    let request = DownloadRequest(chunkID: chunk.chunkID, url: downloadURL, md5: md5, size: size)
    let headroom = chunk.downloadInfo.compression ? chunk.uncompressedSize : 0
    let data = try await workspace.download(
      request,
      purpose: .download(
        memoryHeadroom: headroom <= workspace.settings.memoryLimit ? headroom : 0,
        diskHeadroom: headroom > workspace.settings.memoryLimit ? headroom : 0),
      category: "install")
    await reporter?.record(.chunkDownloaded(chunkID: chunk.chunkID, bytes: data.size))

    return DownloadedChunk(
      chunkID: chunk.chunkID, md5: chunk.uncompressedMd5, size: chunk.uncompressedSize, data: data,
      request: request, downloadInfo: chunk.downloadInfo,
      chunkApplicationInfos: chunk.chunkApplicationInfos)
  }

  private func postProcessChunk(
    _ chunk: DownloadedChunk, workspace: TransferWorkspace
  ) async throws -> ProcessedChunk {
    if !chunk.downloadInfo.compression {
      return ProcessedChunk(
        chunkID: chunk.chunkID, data: chunk.data, request: chunk.request,
        workspace: workspace, chunkApplicationInfos: chunk.chunkApplicationInfos
      )
    }

    let writer = try await workspace.cache.makeWriter(expectedSize: chunk.size)
    do {
      let data = try await runTransferIO {
        try self.postProcessor.run(
          ChunkPostProcessRequest(size: chunk.size, md5: chunk.md5, data: chunk.data.data()))
      }
      try await writer.write(data, at: 0)
      let binary = try await writer.finish()
      try await workspace.consumed(chunk.data, request: chunk.request)
      return ProcessedChunk(
        chunkID: chunk.chunkID, data: binary, request: chunk.request,
        workspace: workspace, chunkApplicationInfos: chunk.chunkApplicationInfos)
    } catch {
      try? await writer.abort()
      throw error
    }
  }
}
