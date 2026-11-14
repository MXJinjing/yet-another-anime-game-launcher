import Foundation

final class ChunkWriteWorker: @unchecked Sendable {
  // TODO: maybe refactor for truly sequential reads
  private struct CachedHandle {
    let handle: FileHandle
    var lastUsed: UInt64
  }

  private let ioQueue: DispatchQueue
  private let maxCachedFileHandles: Int
  private var accessCounter: UInt64 = 0
  private var handles: [URL: CachedHandle] = [:]
  private let telemetry: TransferTelemetry?
  private var devices: [URL: String] = [:]

  init(index: Int, maxCachedFileHandles: Int, telemetry: TransferTelemetry? = nil) throws {
    guard maxCachedFileHandles > 0 else {
      throw SophonClientError.UnknownError("File handle cache capacity must be positive")
    }
    self.maxCachedFileHandles = maxCachedFileHandles
    self.telemetry = telemetry
    self.ioQueue = DispatchQueue(
      label: "sophon.chunk-write.\(index)",
      qos: .utility
    )
  }

  internal func run(_ request: ChunkWriteRequest) async throws {
    try Task.checkCancellation()

    try await withCheckedThrowingContinuation({
      continuation in
      ioQueue.async {
        [self] in
        continuation.resume(
          with: Result {
            try write(request)
          })
      }
    })
  }

  private func getHandle(
    for fileURL: URL
  ) throws -> FileHandle {
    accessCounter += 1
    if var cached = handles[fileURL] {
      cached.lastUsed = accessCounter
      handles[fileURL] = cached
      return cached.handle
    }

    if handles.count >= maxCachedFileHandles,
      let oldest = handles.min(by: { $0.value.lastUsed < $1.value.lastUsed })
    {
      handles.removeValue(forKey: oldest.key)
      try oldest.value.handle.close()
    }

    try FileManager.default.createDirectory(
      at: fileURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )

    if !FileManager.default.fileExists(atPath: fileURL.path) {
      guard
        FileManager.default.createFile(
          atPath: fileURL.path,
          contents: nil
        )
      else {
        throw SophonClientError.UnknownError(
          "Failed to create \(fileURL.path)"
        )
      }
    }

    // can do both read and write
    let handle = try FileHandle(forUpdating: fileURL)
    handles[fileURL] = CachedHandle(handle: handle, lastUsed: accessCounter)
    return handle
  }

  internal func close(
    _ fileURL: URL
  ) async throws {
    let fileURL = fileURL.standardizedFileURL

    try await withCheckedThrowingContinuation { continuation in
      ioQueue.async { [self] in
        continuation.resume(
          with: Result {
            if let cached = handles.removeValue(forKey: fileURL) {
              try cached.handle.close()
            }
          }
        )
      }
    }
  }

  internal func closeAll() async {
    await withCheckedContinuation { continuation in
      ioQueue.async { [self] in
        for cached in handles.values {
          try? cached.handle.close()
        }

        handles.removeAll()
        continuation.resume()
      }
    }
  }

  private func write(_ request: ChunkWriteRequest) throws {
    let application = request.applicationInfo
    let fileURL = application.fileURL.standardizedFileURL
    let handle = try getHandle(for: fileURL)

    do {
      try handle.seek(toOffset: application.offset)
      try handle.write(contentsOf: request.data)
      let device = devices[fileURL] ?? telemetry?.register(fileURL, role: "Target") ?? ""
      devices[fileURL] = device
      telemetry?.write(UInt64(request.data.count), device: device)
    } catch {
      if let cached = handles.removeValue(forKey: fileURL) {
        try? cached.handle.close()
      }
      throw error
    }
  }
}
