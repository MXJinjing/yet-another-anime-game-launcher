import Foundation

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

final class ChunkCheckWorker: Sendable {
  private let baseGameDir: URL
  private let ioQueue: DispatchQueue

  init(baseGameDir: URL) {
    self.baseGameDir = baseGameDir
    self.ioQueue = DispatchQueue(
      label: "sophon.chunk-check", qos: .utility, attributes: .concurrent)
  }

  internal func run(
    _ fileInfo: FileInfo,
    reporter: InstallationReporter? = nil, quickVerify: Bool = false
  ) async throws -> GameFileState {
    try Task.checkCancellation()

    guard let reporter else {
      return try await runOnce(fileInfo, quickVerify: quickVerify)
    }

    let events = AsyncStream<InstallationEvent>.makeStream(bufferingPolicy: .unbounded)
    // Forward GCD-produced scan events through one structured task per file.
    async let reporting: Void = {
      for await event in events.stream {
        await reporter.record(event)
      }
    }()

    do {
      let state = try await runOnce(fileInfo, quickVerify: quickVerify) { event in
        events.continuation.yield(event)
      }
      events.continuation.finish()
      await reporting
      return state
    } catch {
      events.continuation.finish()
      await reporting
      throw error
    }
  }

  private func runOnce(
    _ fileInfo: FileInfo, quickVerify: Bool,
    onEvent: @escaping @Sendable (InstallationEvent) -> Void = { _ in }
  ) async throws -> GameFileState {
    return try await withCheckedThrowingContinuation { continuation in
      ioQueue.async { [self] in
        continuation.resume(
          with: Result {
            try checkOnce(fileInfo, quickVerify: quickVerify, onEvent: onEvent)
          }
        )
      }
    }
  }

  private func checkChunk(
    _ chunkInfo: borrowing ChunkInfo, _ handle: FileHandle, filePath: URL,
    onEvent: @Sendable (InstallationEvent) -> Void
  ) throws -> Bool {
    let size = Int(chunkInfo.uncompressedSize)
    // seeking to greater offset than file size is permitted
    // it will just return nil as data
    try handle.seek(toOffset: chunkInfo.offset)
    var matches: Bool = false
    #if canImport(ObjectiveC)
      try autoreleasepool {
        let data = try handle.read(upToCount: size) ?? Data()
        matches = data.count == size && md5Hex(data) == chunkInfo.md5
        onEvent(
          .fileChunkScanned(
            filePath: filePath, chunkID: chunkInfo.chunkID, isBroken: !matches,
            offset: chunkInfo.offset, bytes: UInt64(data.count),
            expectedBytes: UInt64(chunkInfo.uncompressedSize)))
      }
    #else
      let data = try handle.read(upToCount: size) ?? Data()
      matches = data.count == size && md5Hex(data) == chunkInfo.md5
      onEvent(
        .fileChunkScanned(
          filePath: filePath, chunkID: chunkInfo.chunkID, isBroken: !matches,
          offset: chunkInfo.offset, bytes: UInt64(data.count),
          expectedBytes: UInt64(chunkInfo.uncompressedSize)))
    #endif

    return matches
  }

  private func checkOnce(
    _ fileInfo: borrowing FileInfo, quickVerify: Bool,
    onEvent: @Sendable (InstallationEvent) -> Void
  ) throws -> GameFileState {
    try checkFileInfo(fileInfo)  // just in case it is used in other stuff
    let filePath = baseGameDir.appendingPathComponent(fileInfo.filename)
    guard let fileSize = UInt64(exactly: fileInfo.size) else {
      throw SophonClientError.UnknownError("Invalid file size: \(fileInfo.size)")
    }
    if fileInfo.flags == FILE_FLAG_DIRECTORY {
      return GameFileState(
        filePath: filePath, needsTrimming: false, size: fileSize, md5: fileInfo.md5,
        requiredChunks: [])
    }

    let chunks = fileInfo.chunks.sorted { $0.offset < $1.offset }
    let handle: FileHandle
    do {
      handle = try FileHandle(forReadingFrom: filePath)
    } catch {
      let nsError = error as NSError
      let isMissingFIle =
        nsError.domain == NSCocoaErrorDomain
        && (nsError.code == CocoaError.Code.fileNoSuchFile.rawValue
          || nsError.code == CocoaError.Code.fileReadNoSuchFile.rawValue)
      guard isMissingFIle else {
        throw error
      }
      onEvent(
        .fileMissing(
          filePath: filePath, chunkCount: chunks.count,
          expectedBytes: chunks.reduce(UInt64(0)) { $0 + UInt64($1.uncompressedSize) }))
      onEvent(.fileScanned(filePath: filePath, isBroken: true, needsTrimming: false))
      return GameFileState(
        filePath: filePath, needsTrimming: false, size: fileSize, md5: fileInfo.md5,
        requiredChunks: fileInfo.chunks)
    }

    defer { try? handle.close() }

    let actualSize = try handle.seekToEnd()
    if quickVerify {
      let isBroken = actualSize != fileSize
      for chunk in chunks {
        onEvent(
          .fileChunkScanned(
            filePath: filePath, chunkID: chunk.chunkID, isBroken: isBroken,
            offset: chunk.offset, bytes: 0, expectedBytes: UInt64(chunk.uncompressedSize)))
      }
      onEvent(
        .fileScanned(filePath: filePath, isBroken: isBroken, needsTrimming: actualSize > fileSize))
      return GameFileState(
        filePath: filePath, needsTrimming: actualSize > fileSize, size: fileSize,
        md5: fileInfo.md5, requiredChunks: isBroken ? fileInfo.chunks : [])
    }
    let needsTrimming = actualSize > fileSize
    var requiredChunks: [ChunkInfo] = []
    for chunk in chunks {
      if try !checkChunk(chunk, handle, filePath: filePath, onEvent: onEvent) {
        requiredChunks.append(chunk)
      }
    }

    onEvent(
      .fileScanned(
        filePath: filePath, isBroken: !requiredChunks.isEmpty, needsTrimming: needsTrimming))
    return GameFileState(
      filePath: filePath, needsTrimming: needsTrimming, size: fileSize, md5: fileInfo.md5,
      requiredChunks: requiredChunks)
  }
}
