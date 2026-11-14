import Crypto
import Foundation
import HPatch

struct PatchApplyRequest: Sendable {
  let original: PatchInput?
  let patch: PatchInput
  let target: PlannedUpdateFile
  let outputURL: URL
  var synchronize = false
  var telemetry: TransferTelemetry? = nil
}

enum PatchInput: Sendable {
  case cached(CachedBinary)
  case file(URL, offset: UInt64, size: UInt64)
  case download(CachedDownload, offset: UInt64, size: UInt64)

  func slice(offset: UInt64, size: UInt64) throws -> PatchInput {
    switch self {
    case .cached(let binary): return .cached(try binary.slice(offset: offset, length: size))
    case .file(let url, let base, let length):
      guard offset <= length, size <= length - offset else { throw BinaryCacheError.outOfBounds }
      return .file(url, offset: base + offset, size: size)
    case .download(let payload, let base, let length):
      guard offset <= length, size <= length - offset else { throw BinaryCacheError.outOfBounds }
      return .download(payload, offset: base + offset, size: size)
    }
  }

  func isHDiff(telemetry: TransferTelemetry? = nil) throws -> Bool {
    let source = try open(telemetry: telemetry)
    var prefix = Data(count: Int(min(16, try source.size)))
    try prefix.withUnsafeMutableBytes { try source.read(at: 0, into: $0) }
    return prefix.starts(with: Data("HDIFF".utf8))
  }

  fileprivate func open(telemetry: TransferTelemetry? = nil) throws -> any HPatchSource {
    switch self {
    case .cached(let binary): return try CachedPatchSource(binary)
    case .file(let fileURL, let offset, let size):
      return try FilePatchSource(fileURL: fileURL, offset: offset, size: size, telemetry: telemetry)
    case .download(let download, let offset, let size):
      return try FilePatchSource(
        fileURL: download.fileURL, offset: offset, size: size, download: download,
        telemetry: telemetry)
    }
  }
}

final class PatchApplyWorker: Sendable {
  private let ioQueue: DispatchQueue

  init(index: Int) {
    ioQueue = DispatchQueue(label: "sophon.patch-apply.\(index)", qos: .utility)
  }

  // An active write drains before cancellation is returned to the coordinator.
  internal func run(_ request: PatchApplyRequest) async throws {
    try Task.checkCancellation()
    try await withCheckedThrowingContinuation {
      (continuation: CheckedContinuation<Void, any Error>) in
      ioQueue.async {
        continuation.resume(with: Result { try Self.apply(request) })
      }
    }
  }

  private static func apply(_ request: PatchApplyRequest) throws {
    let patch = try request.patch.open(telemetry: request.telemetry)
    let original = try request.original?.open(telemetry: request.telemetry)
    let patchSize = try patch.size
    var prefix = Data(count: Int(min(16, patchSize)))
    try prefix.withUnsafeMutableBytes { try patch.read(at: 0, into: $0) }
    let isHDiff = prefix.starts(with: Data("HDIFF".utf8))
    guard isHDiff || patchSize == request.target.size else {
      throw SophonClientError.UnsupportedManifestConfiguration(
        "Payload is neither an HDIFF patch nor a full target file: \(request.target.fileURL.path)")
    }

    let output = try HashedPatchOutput(
      fileURL: request.outputURL, size: request.target.size, md5: request.target.md5,
      telemetry: request.telemetry)
    defer { try? output.handle.close() }

    if isHDiff {
      try HPatch.apply(old: original, diff: patch, output: output)
    } else {
      try output.prepare(size: patchSize)
      var offset: UInt64 = 0
      while offset < patchSize {
        let count = Int(min(1024 * 1024, patchSize - offset))
        #if canImport(ObjectiveC)
          try autoreleasepool {
            var data = Data(count: count)
            try data.withUnsafeMutableBytes { try patch.read(at: offset, into: $0) }
            try data.withUnsafeBytes { try output.write(at: offset, $0) }
            offset += UInt64(data.count)
          }
        #else
          var data = Data(count: count)
          try data.withUnsafeMutableBytes { try patch.read(at: offset, into: $0) }
          try data.withUnsafeBytes { try output.write(at: offset, $0) }
          offset += UInt64(data.count)
        #endif
      }
    }

    try output.finish()
    if request.synchronize { try output.handle.synchronize() }
    try output.handle.close()
  }
}

private final class FilePatchSource: HPatchSource, @unchecked Sendable {
  let size: UInt64
  private let offset: UInt64
  private let handle: FileHandle
  private let lock = NSLock()
  private let download: CachedDownload?
  private let telemetry: TransferTelemetry?
  private let device: String

  init(
    fileURL: URL, offset: UInt64, size: UInt64, download: CachedDownload? = nil,
    telemetry: TransferTelemetry? = nil
  ) throws {
    self.size = size
    self.offset = offset
    self.download = download
    self.telemetry = telemetry
    self.device =
      telemetry?.register(fileURL, role: download == nil ? "Target" : "Predownload") ?? ""
    handle = try FileHandle(forReadingFrom: fileURL)
    let length = try handle.seekToEnd()
    guard offset <= length, size <= length - offset else {
      try? handle.close()
      throw BinaryCacheError.outOfBounds
    }
  }

  deinit { try? handle.close() }

  func read(at position: UInt64, into buffer: UnsafeMutableRawBufferPointer) throws {
    try lock.withLock {
      guard position <= size, UInt64(buffer.count) <= size - position else {
        throw BinaryCacheError.outOfBounds
      }
      try handle.seek(toOffset: offset + position)
      var count = 0
      while count < buffer.count {
        #if canImport(ObjectiveC)
          try autoreleasepool {
            guard let data = try handle.read(upToCount: min(1024 * 1024, buffer.count - count)),
              !data.isEmpty
            else { throw BinaryCacheError.unexpectedEndOfFile }
            data.copyBytes(
              to: UnsafeMutableRawBufferPointer(rebasing: buffer[count..<(count + data.count)]))
            recordRead(UInt64(data.count))
            count += data.count
          }
        #else
          guard let data = try handle.read(upToCount: min(1024 * 1024, buffer.count - count)),
            !data.isEmpty
          else { throw BinaryCacheError.unexpectedEndOfFile }
          data.copyBytes(
            to: UnsafeMutableRawBufferPointer(rebasing: buffer[count..<(count + data.count)]))
          recordRead(UInt64(data.count))
          count += data.count
        #endif
      }
    }
  }

  private func recordRead(_ bytes: UInt64) {
    if download != nil {
      telemetry?.cacheRead(bytes, inMemory: false, device: device)
    } else {
      telemetry?.read(bytes, device: device)
    }
  }
}

private struct CachedPatchSource: HPatchSource {
  let size: UInt64
  let reader: CachedBinaryReader

  init(_ binary: CachedBinary) throws {
    size = binary.size
    reader = try binary.makeReader()
  }

  func read(at offset: UInt64, into buffer: UnsafeMutableRawBufferPointer) throws {
    #if canImport(ObjectiveC)
      try autoreleasepool {
        let data = try reader.read(at: offset, count: buffer.count)
        data.copyBytes(to: buffer)
      }
    #else
      let data = try reader.read(at: offset, count: buffer.count)
      data.copyBytes(to: buffer)
    #endif
  }
}

// HDIFF output is consumed in order, so hashing needs no second pass over the target.
private final class HashedPatchOutput: HPatchSink, @unchecked Sendable {
  let handle: FileHandle
  private let expectedSize: UInt64
  private let expectedMD5: String
  private let lock = NSLock()
  private var hasher = Insecure.MD5()
  private var written: UInt64 = 0
  private var prepared = false
  private let telemetry: TransferTelemetry?
  private let device: String

  init(
    fileURL: URL, size: UInt64, md5: String, telemetry: TransferTelemetry?
  ) throws {
    expectedSize = size
    expectedMD5 = md5.lowercased()
    self.telemetry = telemetry
    self.device = telemetry?.register(fileURL, role: "Target") ?? ""
    try FileManager.default.createDirectory(
      at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    if !FileManager.default.fileExists(atPath: fileURL.path) {
      guard FileManager.default.createFile(atPath: fileURL.path, contents: nil) else {
        throw SophonClientError.UnknownError("Failed to create \(fileURL.path)")
      }
    }
    handle = try FileHandle(forUpdating: fileURL)
  }

  func prepare(size: UInt64) throws {
    try lock.withLock {
      guard size == expectedSize else {
        throw SophonClientError.SizeMismatch(expected: expectedSize, actual: size)
      }
      guard !prepared else {
        throw SophonClientError.UnknownError("Patch output was prepared twice")
      }
      try handle.truncate(atOffset: size)
      try handle.seek(toOffset: 0)
      prepared = true
    }
  }

  func write(at offset: UInt64, _ bytes: UnsafeRawBufferPointer) throws {
    try lock.withLock {
      guard prepared, offset == written else {
        throw SophonClientError.UnsupportedManifestConfiguration(
          "Patch output must be written sequentially")
      }
      guard UInt64(bytes.count) <= expectedSize - written else {
        throw SophonClientError.UnknownError("Patch output exceeds the target size")
      }
      #if canImport(ObjectiveC)
        try autoreleasepool { try handle.write(contentsOf: Data(bytes)) }
      #else
        try handle.write(contentsOf: Data(bytes))
      #endif
      telemetry?.write(UInt64(bytes.count), device: device)
      hasher.update(bufferPointer: bytes)
      written += UInt64(bytes.count)
    }
  }

  func finish() throws {
    try lock.withLock {
      guard prepared, written == expectedSize else {
        throw SophonClientError.SizeMismatch(expected: expectedSize, actual: written)
      }
      let actual = hasher.finalize().map { String(format: "%02x", $0) }.joined()
      guard actual == expectedMD5 else {
        throw SophonClientError.InvalidChecksumError(expected: expectedMD5, actual: actual)
      }
    }
  }
}
