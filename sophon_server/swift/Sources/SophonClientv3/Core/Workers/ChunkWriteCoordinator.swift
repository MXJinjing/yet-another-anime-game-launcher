import AsyncAlgorithms
import Foundation

final class ChunkWriteCoordinator: Sendable {
  private let workers: [ChunkWriteWorker]
  private let tracker: FileCompletionTracker
  private let reporter: InstallationReporter?
  private let fileWorkers: [URL: Int]
  private let journal: InstallationJournal?

  init(
    plannedFiles: [PlannedFile],
    workerCount: Int,
    maxCachedFileHandles: Int = 512,
    reporter: InstallationReporter? = nil,
    journal: InstallationJournal? = nil, telemetry: TransferTelemetry? = nil
  ) throws {
    guard workerCount > 0 else {
      throw SophonClientError.UnknownError(
        "Write worker count must be positive"
      )
    }
    guard maxCachedFileHandles >= workerCount else {
      throw SophonClientError.UnknownError(
        "File handle cache budget must allow at least one handle per disk writer"
      )
    }
    self.workers = try (0..<workerCount).map {
      try ChunkWriteWorker(
        index: $0, maxCachedFileHandles: maxCachedFileHandles / workerCount, telemetry: telemetry)
    }
    var loads = Array(repeating: UInt64(0), count: workerCount)
    var fileWorkers: [URL: Int] = [:]
    for file in plannedFiles.filter({ $0.requiredChunkCount > 0 }).sorted(by: {
      $0.size == $1.size ? $0.fileURL.path < $1.fileURL.path : $0.size > $1.size
    }) {
      let index = loads.indices.min(by: { loads[$0] < loads[$1] }) ?? 0
      fileWorkers[file.fileURL.standardizedFileURL] = index
      loads[index] += file.size
    }
    self.fileWorkers = fileWorkers
    self.tracker = try FileCompletionTracker(
      plannedFiles: plannedFiles
    )
    self.reporter = reporter
    self.journal = journal
  }

  internal func write(
    _ chunk: ProcessedChunk
  ) async throws {
    for application in chunk.chunkApplicationInfos {
      try Task.checkCancellation()

      let worker = try worker(for: application.fileURL)
      var offset: UInt64 = 0
      for try await data in try chunk.data.stream() {
        try await worker.run(
          ChunkWriteRequest(
            data: data,
            applicationInfo: ChunkApplicationInfo(
              fileURL: application.fileURL, offset: application.offset + offset)))
        offset += UInt64(data.count)
      }
      if let journal {
        try await runTransferIO(checkCancellation: false) {
          try journal.written(chunkID: chunk.chunkID, application: application)
        }
      }
      await reporter?.record(
        .chunkWritten(
          filePath: application.fileURL, chunkID: chunk.chunkID,
          offset: application.offset, bytes: chunk.data.size))

      if let completedFile = try await tracker.completeWrite(
        to: application.fileURL
      ) {
        try await worker.close(completedFile.fileURL)
        await reporter?.record(.fileCompleted(filePath: completedFile.fileURL))
      }
    }
    try await chunk.workspace.consumed(chunk.data, request: chunk.request)
  }

  internal func ensureComplete() async throws {
    try await tracker.ensureComplete()
  }

  internal func closeAll() async {
    for worker in workers {
      await worker.closeAll()
    }
  }

  private func worker(
    for fileURL: URL
  ) throws -> ChunkWriteWorker {
    guard let index = fileWorkers[fileURL.standardizedFileURL] else {
      throw SophonClientError.UnknownError("File is missing from the write plan: \(fileURL.path)")
    }
    return workers[index]
  }

  internal func run(
    _ input: AsyncChannel<ProcessedChunk>
  ) async throws {
    do {
      try await withThrowingTaskGroup(of: Void.self) { group in
        for _ in workers.indices {
          group.addTask { [self] in
            for await chunk in input {
              try Task.checkCancellation()
              try await write(chunk)
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
    } catch {
      await closeAll()
      throw error
    }

    await closeAll()
  }
}
