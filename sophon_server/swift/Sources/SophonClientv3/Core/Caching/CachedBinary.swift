import Crypto
// TODO: Un-vibecode this
import Foundation

private let cachedBinaryIOQueue = DispatchQueue(
  label: "sophon.binary-cache.io", qos: .utility, attributes: .concurrent
)

private func cleanupCachedBinaryFile(
  at fileURL: URL, reservation: BinaryCache.Reservation, storedBytes: UInt64
) {
  cachedBinaryIOQueue.async {
    withExtendedLifetime(reservation) {
      do {
        try FileManager.default.removeItem(at: fileURL)
        reservation.telemetry?.removed(storedBytes, device: reservation.device)
      } catch {
        let nsError = error as NSError
        if nsError.domain == NSCocoaErrorDomain,
          nsError.code == CocoaError.Code.fileNoSuchFile.rawValue
            || nsError.code == CocoaError.Code.fileReadNoSuchFile.rawValue
        {
          reservation.telemetry?.removed(storedBytes, device: reservation.device)
          return
        }

        // Keep the bytes and entry slot charged until the file is removed.
        cachedBinaryIOQueue.asyncAfter(deadline: .now() + 5) {
          cleanupCachedBinaryFile(at: fileURL, reservation: reservation, storedBytes: storedBytes)
        }
      }
    }
  }
}

private func performCacheIO<T: Sendable>(
  on queue: DispatchQueue = cachedBinaryIOQueue,
  _ operation: @escaping @Sendable () throws -> T
) async throws -> T {
  try Task.checkCancellation()
  let value: T = try await withCheckedThrowingContinuation { continuation in
    queue.async {
      #if canImport(ObjectiveC)
        continuation.resume(with: Result { try autoreleasepool(invoking: operation) })
      #else
        continuation.resume(with: Result(catching: operation))
      #endif
    }
  }
  try Task.checkCancellation()
  return value
}

private func checkBinaryRange(offset: UInt64, length: UInt64, size: UInt64) throws {
  guard offset <= size, length <= size - offset else {
    throw BinaryCacheError.outOfBounds
  }
}

// Mutated only by the writer's queue; immutable once handed to CachedBinary.
private final class CachedBinaryStorage: @unchecked Sendable {
  let reservation: BinaryCache.Reservation
  var fileURL: URL?
  var data: Data?
  let preserveFile: Bool
  var storedBytes: UInt64 = 0

  init(
    reservation: BinaryCache.Reservation, directory: URL, fileURL: URL?, preserveFile: Bool
  ) throws {
    self.reservation = reservation
    self.preserveFile = preserveFile
    self.storedBytes = reservation.storedBytes
    if reservation.inMemory {
      self.fileURL = nil
      self.data = Data(count: Int(reservation.size))
    } else {
      self.data = nil
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      let target = fileURL ?? directory.appendingPathComponent("sophon-\(UUID().uuidString).tmp")
      try FileManager.default.createDirectory(
        at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
      if !FileManager.default.fileExists(atPath: target.path) {
        try Data().write(to: target, options: .withoutOverwriting)
      }
      self.fileURL = target
    }
  }

  deinit {
    data = nil
    guard let fileURL, !preserveFile else { return }
    cleanupCachedBinaryFile(at: fileURL, reservation: reservation, storedBytes: storedBytes)
  }
}

final class CachedBinaryWriter: @unchecked Sendable {
  private let ioQueue = DispatchQueue(label: "sophon.binary-cache.write", qos: .utility)
  // All mutable state is confined to ioQueue.
  private var storage: CachedBinaryStorage?
  private var handle: FileHandle?
  private var writtenRanges: [Range<UInt64>] = []

  private init(storage: CachedBinaryStorage, handle: FileHandle?) {
    self.storage = storage
    self.handle = handle
  }

  internal static func make(
    reservation: BinaryCache.Reservation, directory: URL, fileURL: URL? = nil,
    preserveFile: Bool = false
  ) async throws -> CachedBinaryWriter {
    try await performCacheIO {
      let storage = try CachedBinaryStorage(
        reservation: reservation, directory: directory, fileURL: fileURL, preserveFile: preserveFile
      )
      let handle = try storage.fileURL.map { try FileHandle(forUpdating: $0) }
      return CachedBinaryWriter(storage: storage, handle: handle)
    }
  }

  deinit {
    let handle = handle
    let storage = storage
    ioQueue.async {
      withExtendedLifetime(storage) {
        try? handle?.close()
      }
    }
  }

  internal func write(_ data: Data, at offset: UInt64) async throws {
    try await run { try $0.writeBytes(data, at: offset) }
  }

  // URLSession's delegate needs a bounded synchronous sink, rather than a task per received packet.
  internal func writeBlocking(_ data: Data, at offset: UInt64) throws {
    try ioQueue.sync { try writeBytes(data, at: offset) }
  }

  private func writeBytes(_ data: Data, at offset: UInt64) throws {
    let writer = self
    guard let storage = writer.storage else { throw BinaryCacheError.closed }
    let length = UInt64(data.count)
    try checkBinaryRange(offset: offset, length: length, size: storage.reservation.size)
    guard !data.isEmpty else { return }

    do {
      if let handle = writer.handle {
        try handle.seek(toOffset: offset)
        try handle.write(contentsOf: data)
      } else {
        storage.data?.replaceSubrange(Int(offset)..<Int(offset + length), with: data)
      }
    } catch {
      try? writer.discard()
      throw error
    }
    storage.reservation.telemetry?.cacheWrite(
      length, inMemory: storage.reservation.inMemory, device: storage.reservation.device)
    writer.recordRange(offset..<(offset + length))
  }

  internal var inMemory: Bool { ioQueue.sync { storage?.reservation.inMemory ?? false } }

  internal func restoreRanges(_ ranges: [Range<UInt64>]) throws {
    try ioQueue.sync {
      guard storage != nil else { throw BinaryCacheError.closed }
      for range in ranges { recordRange(range) }
    }
  }

  internal func preview() throws -> CachedBinary {
    try ioQueue.sync {
      guard let storage else { throw BinaryCacheError.closed }
      return CachedBinary(storage: storage, offset: 0, size: storage.reservation.size)
    }
  }

  internal func pause() {
    ioQueue.sync {
      try? handle?.close()
      handle = nil
      storage = nil
      writtenRanges.removeAll()
    }
  }

  // A failed coverage check leaves the writer open for missing ranges.
  internal func finish() async throws -> CachedBinary {
    try await run { writer in
      guard let storage = writer.storage else { throw BinaryCacheError.closed }
      let size = storage.reservation.size
      guard size == 0 || writer.writtenRanges == [0..<size] else {
        throw BinaryCacheError.incomplete
      }
      do {
        try writer.handle?.close()
      } catch {
        try? writer.discard()
        throw error
      }
      writer.handle = nil
      writer.storage = nil
      writer.writtenRanges.removeAll()
      return CachedBinary(storage: storage, offset: 0, size: size)
    }
  }

  internal func abort() async throws {
    try await withCheckedThrowingContinuation {
      (continuation: CheckedContinuation<Void, any Error>) in
      ioQueue.async { [self] in
        continuation.resume(with: Result { try discard() })
      }
    }
  }

  private func run<T: Sendable>(
    _ operation: @escaping @Sendable (CachedBinaryWriter) throws -> T
  ) async throws -> T {
    do {
      return try await performCacheIO(on: ioQueue) { try operation(self) }
    } catch is CancellationError {
      try? await abort()
      throw CancellationError()
    }
  }

  private func discard() throws {
    defer {
      handle = nil
      storage = nil
      writtenRanges.removeAll()
    }
    try handle?.close()
    if let fileURL = storage?.fileURL {
      try removeOwnedFile(fileURL)
      if let storage {
        storage.reservation.telemetry?.removed(
          storage.storedBytes, device: storage.reservation.device)
      }
      storage?.fileURL = nil
    }
  }

  private func recordRange(_ range: Range<UInt64>) {
    var lower = range.lowerBound
    var upper = range.upperBound
    let first = writtenRanges.firstIndex { $0.upperBound >= lower } ?? writtenRanges.count
    var last = first
    while last < writtenRanges.count, writtenRanges[last].lowerBound <= upper {
      lower = min(lower, writtenRanges[last].lowerBound)
      upper = max(upper, writtenRanges[last].upperBound)
      last += 1
    }
    writtenRanges.replaceSubrange(first..<last, with: [lower..<upper])
    if let storage, !storage.reservation.inMemory {
      let total = writtenRanges.reduce(UInt64(0)) { $0 + $1.upperBound - $1.lowerBound }
      if total > storage.storedBytes {
        storage.reservation.telemetry?.stored(
          total - storage.storedBytes, device: storage.reservation.device)
        storage.storedBytes = total
      }
    }
  }
}

struct CachedBinary: Sendable {
  fileprivate let storage: CachedBinaryStorage
  fileprivate let offset: UInt64
  let size: UInt64

  internal var inMemory: Bool { storage.reservation.inMemory }

  // Called after the last consumer finishes; retained value copies must not hold cache capacity.
  internal func remove() throws {
    if let fileURL = storage.fileURL {
      try removeOwnedFile(fileURL)
      storage.fileURL = nil
      storage.reservation.telemetry?.removed(
        storage.storedBytes, device: storage.reservation.device)
      storage.storedBytes = 0
    }
    storage.data = nil
    storage.reservation.release()
  }

  internal func data() throws -> Data {
    if let data = storage.data, offset == 0, size == UInt64(data.count) {
      storage.reservation.telemetry?.cacheRead(size, inMemory: true)
      return data
    }
    return try makeReader().read(at: 0, count: Int(size))
  }

  internal func checksum() throws -> String {
    if let data = storage.data, offset == 0, size == UInt64(data.count) {
      storage.reservation.telemetry?.cacheRead(size, inMemory: true)
      return md5Hex(data)
    }
    let reader = try makeReader()
    var hasher = Insecure.MD5()
    var position: UInt64 = 0
    while position < size {
      #if canImport(ObjectiveC)
        try autoreleasepool {
          let data = try reader.read(at: position, count: Int(min(1024 * 1024, size - position)))
          hasher.update(data: data)
          position += UInt64(data.count)
        }
      #else
        let data = try reader.read(at: position, count: Int(min(1024 * 1024, size - position)))
        hasher.update(data: data)
        position += UInt64(data.count)
      #endif
    }
    return hasher.finalize().map { String(format: "%02x", $0) }.joined()
  }

  internal func slice(offset: UInt64, length: UInt64) throws -> CachedBinary {
    try checkBinaryRange(offset: offset, length: length, size: size)
    return CachedBinary(storage: storage, offset: self.offset + offset, size: length)
  }

  // Synchronous access for callers running on a blocking I/O thread.
  internal func makeReader() throws -> CachedBinaryReader {
    try CachedBinaryReader(binary: self)
  }

  internal func stream(bufferSize: Int = 1024 * 1024) throws -> CachedBinaryStream {
    guard bufferSize > 0 else { throw BinaryCacheError.invalidBufferSize }
    return CachedBinaryStream(binary: self, bufferSize: bufferSize)
  }
}

final class CachedBinaryReader: @unchecked Sendable {
  private let binary: CachedBinary
  private let handle: FileHandle?
  private let lock = NSLock()

  fileprivate init(binary: CachedBinary) throws {
    self.binary = binary
    self.handle = try binary.storage.fileURL.map { try FileHandle(forReadingFrom: $0) }
  }

  deinit {
    let handle = handle
    let binary = binary
    cachedBinaryIOQueue.async {
      withExtendedLifetime(binary) {
        try? handle?.close()
      }
    }
  }

  internal func read(at offset: UInt64, count: Int) throws -> Data {
    guard count >= 0 else { throw BinaryCacheError.outOfBounds }
    try checkBinaryRange(offset: offset, length: UInt64(count), size: binary.size)
    guard count > 0 else { return Data() }

    lock.lock()
    defer { lock.unlock() }
    let position = binary.offset + offset
    if let data = binary.storage.data {
      binary.storage.reservation.telemetry?.cacheRead(UInt64(count), inMemory: true)
      return data.subdata(in: Int(position)..<(Int(position) + count))
    }

    guard let handle else { throw BinaryCacheError.closed }
    try handle.seek(toOffset: position)
    var data = Data()
    while data.count < count {
      guard let part = try handle.read(upToCount: count - data.count), !part.isEmpty else {
        throw BinaryCacheError.unexpectedEndOfFile
      }
      data.append(part)
      binary.storage.reservation.telemetry?.cacheRead(
        UInt64(part.count), inMemory: false, device: binary.storage.reservation.device)
    }
    return data
  }
}

// One bounded read per next(), with no background producer or prefetch queue.
struct CachedBinaryStream: AsyncSequence, Sendable {
  typealias Element = Data
  fileprivate let binary: CachedBinary
  fileprivate let bufferSize: Int

  internal func makeAsyncIterator() -> Iterator {
    Iterator(binary: binary, bufferSize: bufferSize)
  }

  struct Iterator: AsyncIteratorProtocol {
    fileprivate let binary: CachedBinary
    fileprivate let bufferSize: Int
    fileprivate var reader: CachedBinaryReader? = nil
    fileprivate var offset: UInt64 = 0

    internal mutating func next() async throws -> Data? {
      guard offset < binary.size else {
        reader = nil
        return nil
      }
      do {
        let binary = binary
        let reader = reader
        let offset = offset
        let count = Int(Swift.min(UInt64(bufferSize), binary.size - offset))
        let (activeReader, data) = try await performCacheIO {
          let activeReader = try reader ?? binary.makeReader()
          return (activeReader, try activeReader.read(at: offset, count: count))
        }
        self.offset += UInt64(data.count)
        self.reader = self.offset < binary.size ? activeReader : nil
        return data
      } catch {
        offset = binary.size
        reader = nil
        throw error
      }
    }
  }
}
