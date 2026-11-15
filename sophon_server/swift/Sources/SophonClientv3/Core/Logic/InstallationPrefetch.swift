import Foundation

extension Installer {
  func cacheChunks(
    _ plan: InstallationPlan, cache: DownloadCache, reporter: InstallationReporter
  ) async throws {
    let telemetry = TransferTelemetry(memoryLimit: 0, diskLimit: cache.diskLimit)
    await reporter.useResources(telemetry)
    await reporter.record(
      .planned(
        downloadBytes: plan.downloadSize, writeBytes: 0,
        totalChunk: plan.totalChunkCount, totalFile: plan.plannedFiles.count))
    await reporter.record(.phaseChanged(.running))
    var requests = try plan.requiredChunks.map { try $0.downloadRequest() }.makeIterator()
    try await withThrowingTaskGroup(of: Void.self) { group in
      func schedule(_ request: DownloadRequest) {
        group.addTask { [control] in
          try await control?.checkpoint()
          let download = try await cache.get(request, waitForSpace: false, telemetry: telemetry)
          try download.release()
          await reporter.record(.chunkDownloaded(chunkID: request.chunkID, bytes: request.size))
        }
      }
      for _ in 0..<maxCocurrentDownloads {
        guard let request = requests.next() else { break }
        schedule(request)
      }
      while try await group.next() != nil {
        if let request = requests.next() { schedule(request) }
      }
    }
  }
}
