import Foundation

// A single budget covers this operation's downloads, original inputs and processing buffers.
final class TransferWorkspace: Sendable {
  let directory: URL
  let cache: BinaryCache
  let telemetry: TransferTelemetry
  let transport: DownloadCache
  let io: WorkLimiter
  let settings: TransferSettings

  init(
    settings: TransferSettings, gameDirectory: URL, operation: String,
    transport: DownloadCache, io: WorkLimiter? = nil, recoveryDirectory: URL? = nil
  ) async throws {
    self.settings = settings
    self.transport = transport
    self.io = io ?? WorkLimiter(limit: Int.max)
    directory = settings.cacheURL.appendingPathComponent("working", isDirectory: true)
      .appendingPathComponent(transferKey(gameDirectory.path), isDirectory: true)
      .appendingPathComponent(operation, isDirectory: true)
    telemetry = TransferTelemetry(
      memoryLimit: settings.memoryLimit,
      diskLimit: settings.diskCacheEnabled ? settings.diskLimit : 0)
    telemetry.register(gameDirectory, role: "Target")
    telemetry.register(directory, role: "Cache")
    if !settings.preserveState {
      try await runTransferIO { [directory] in try removeOwnedFile(directory) }
    }
    cache = try BinaryCache(
      directory: directory.appendingPathComponent("inputs", isDirectory: true),
      memoryLimit: settings.memoryLimit,
      diskLimit: settings.diskCacheEnabled ? settings.diskLimit : 0,
      entryLimit: settings.entryLimit, telemetry: telemetry)
    let retained = try await runTransferIO { [directory] in
      try removeOwnedFile(directory.appendingPathComponent("inputs"))
      let downloads = directory.appendingPathComponent("downloads", isDirectory: true)
      if !settings.diskCacheEnabled { try removeOwnedFile(downloads) }
      var files: [URL: UInt64] = [:]
      for folder in [downloads, recoveryDirectory].compactMap({ $0 }) {
        guard FileManager.default.fileExists(atPath: folder.path) else { continue }
        for file in try FileManager.default.contentsOfDirectory(
          at: folder, includingPropertiesForKeys: [.fileSizeKey])
        where file.pathExtension == "partial" || file.pathExtension == "original" {
          files[file] = try transferFileMetadata(file.path).size
        }
      }
      var total = files.values.reduce(UInt64(0), +)
      let limit = settings.diskCacheEnabled ? settings.diskLimit : 0
      // Lowering a limit may discard download prefixes, but never an in-place recovery original.
      for file in files.keys.filter({ $0.pathExtension == "partial" }).sorted(by: {
        files[$0]! > files[$1]!
      }) where total > limit {
        try removeOwnedFile(file)
        try removeOwnedFile(file.deletingPathExtension().appendingPathExtension("jsonl"))
        total -= files.removeValue(forKey: file)!
      }
      return files
    }
    try await cache.restoreDiskFiles(retained)
  }

  func download(
    _ request: DownloadRequest,
    purpose: BinaryCache.Purpose = .download(memoryHeadroom: 0, diskHeadroom: 0),
    category: String = "patch"
  ) async throws -> CachedBinary {
    try await transport.getWorking(
      request, directory: directory.appendingPathComponent("downloads", isDirectory: true),
      cache: cache, purpose: purpose, telemetry: telemetry, io: io, category: category)
  }

  func retainedBytes(_ request: DownloadRequest) async throws -> UInt64 {
    try await transport.retainedBytes(
      request, directory: directory.appendingPathComponent("downloads", isDirectory: true))
  }

  func retainOnlyDownloads(_ requests: [DownloadRequest]) async throws {
    let keys = Set(requests.map { transferKey("\($0.md5.lowercased()):\($0.size)") })
    let downloads = directory.appendingPathComponent("downloads", isDirectory: true)
    let removed = try await runTransferIO {
      guard FileManager.default.fileExists(atPath: downloads.path) else { return [URL]() }
      var removed: [URL] = []
      for file in try FileManager.default.contentsOfDirectory(
        at: downloads, includingPropertiesForKeys: nil)
      where (file.pathExtension == "partial" || file.pathExtension == "jsonl")
        && !keys.contains(file.deletingPathExtension().lastPathComponent)
      {
        try removeOwnedFile(file)
        removed.append(file)
      }
      return removed
    }
    for file in removed { await cache.removedRetainedFile(file) }
  }

  func consumed(_ binary: CachedBinary, request: DownloadRequest) async throws {
    try await runTransferIO(checkCancellation: false) {
      try binary.remove()
      let key = transferKey("\(request.md5.lowercased()):\(request.size)")
      try removeOwnedFile(self.directory.appendingPathComponent("downloads/\(key).partial"))
      try removeOwnedFile(self.directory.appendingPathComponent("downloads/\(key).jsonl"))
    }
    let key = transferKey("\(request.md5.lowercased()):\(request.size)")
    await cache.removedRetainedFile(directory.appendingPathComponent("downloads/\(key).partial"))
  }

  func finish(completed: Bool) async throws {
    await cache.waitUntilUnused()
    if completed {
      try await runTransferIO(checkCancellation: false) { [directory] in
        try removeOwnedFile(directory)
      }
      await cache.clearRetainedFiles()
    }
  }
}
