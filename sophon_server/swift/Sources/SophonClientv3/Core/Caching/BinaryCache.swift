// TODO: Un-vibecode this
import Foundation

enum BinaryCacheError: LocalizedError {
  case invalidConfiguration
  case entryTooLarge(UInt64)
  case outOfBounds
  case incomplete
  case closed
  case invalidBufferSize
  case unexpectedEndOfFile

  var errorDescription: String? {
    switch self {
    case .invalidConfiguration: "Invalid binary cache configuration"
    case .entryTooLarge(let size):
      "A cache entry requires \(size) bytes, exceeding the configured cache limits"
    case .outOfBounds: "Binary cache access is outside the entry's bounds"
    case .incomplete: "The binary cache entry is incomplete"
    case .closed: "The binary cache writer is closed"
    case .invalidBufferSize: "The binary cache buffer size must be positive"
    case .unexpectedEndOfFile: "The binary cache file ended unexpectedly"
    }
  }
}

actor BinaryCache {
  enum Purpose: Sendable {
    case input
    case download(memoryHeadroom: UInt64, diskHeadroom: UInt64)

    var headroom: (memory: UInt64, disk: UInt64) {
      if case .download(let memory, let disk) = self { return (memory, disk) }
      return (0, 0)
    }
    var isDownload: Bool {
      if case .download = self { return true }
      return false
    }
  }

  // The backing owns this reservation, including while slices or readers use it.
  final class Reservation: @unchecked Sendable {
    private let cache: BinaryCache
    let size: UInt64
    let inMemory: Bool
    let id: UUID
    let device: String
    let telemetry: TransferTelemetry?
    let storedBytes: UInt64
    private let lock = NSLock()
    private var released = false

    fileprivate init(
      cache: BinaryCache, id: UUID, size: UInt64, inMemory: Bool, device: String,
      telemetry: TransferTelemetry?, storedBytes: UInt64
    ) {
      self.cache = cache
      self.id = id
      self.size = size
      self.inMemory = inMemory
      self.device = device
      self.telemetry = telemetry
      self.storedBytes = storedBytes
    }

    func release() {
      let shouldRelease = lock.withLock {
        guard !released else { return false }
        released = true
        return true
      }
      guard shouldRelease else { return }
      let cache = cache
      let size = size
      let inMemory = inMemory
      let id = id
      let device = device
      Task {
        await cache.release(id: id, size: size, inMemory: inMemory, device: device)
      }
    }

    deinit { release() }
  }

  private struct Waiter {
    let id: UUID
    let size: UInt64
    let purpose: Purpose
    let forceDisk: Bool
    let device: String
    let fileURL: URL?
    let continuation: CheckedContinuation<Reservation, any Error>
  }

  private let directory: URL
  private let memoryLimit: UInt64
  private let diskLimit: UInt64
  private let entryLimit: Int
  private let telemetry: TransferTelemetry?
  private let device: String
  private var headrooms: [UUID: (memory: UInt64, disk: UInt64)] = [:]
  private var retainedFiles: [String: (size: UInt64, device: String)] = [:]
  private var memoryBytes: UInt64 = 0
  private var diskBytes: UInt64 = 0
  private var inputMemoryBytes: UInt64 = 0
  private var inputDiskBytes: UInt64 = 0
  private var entryCount = 0
  private var waiters: [Waiter] = []

  init(
    directory: URL, memoryLimit: UInt64, diskLimit: UInt64, entryLimit: Int,
    telemetry: TransferTelemetry? = nil
  ) throws {
    guard directory.isFileURL, entryLimit > 0 else {
      throw BinaryCacheError.invalidConfiguration
    }
    self.directory = directory
    self.memoryLimit = min(memoryLimit, UInt64(Int.max))
    self.diskLimit = min(diskLimit, UInt64(Int64.max))
    self.entryLimit = entryLimit
    self.telemetry = telemetry
    self.device = telemetry?.register(directory, role: "Cache") ?? ""
  }

  internal var usage: (memory: UInt64, disk: UInt64, entries: Int) {
    (memoryBytes, diskBytes, entryCount)
  }

  internal func makeWriter(
    expectedSize: UInt64, purpose: Purpose = .input, fileURL: URL? = nil,
    forceDisk: Bool = false, preserveFile: Bool = false
  ) async throws -> CachedBinaryWriter {
    try Task.checkCancellation()
    let headroom = purpose.headroom
    if purpose.isDownload, headroom.memory > 0 || headroom.disk > 0, entryLimit < 2 {
      throw BinaryCacheError.invalidConfiguration
    }
    let fitsMemory =
      !forceDisk && expectedSize <= memoryLimit
      && headroom.memory <= memoryLimit - expectedSize && headroom.disk <= diskLimit
    let fitsDisk =
      expectedSize <= diskLimit && headroom.disk <= diskLimit - expectedSize
      && headroom.memory <= memoryLimit
    guard fitsMemory || fitsDisk else {
      throw BinaryCacheError.entryTooLarge(expectedSize)
    }

    let id = UUID()
    let reservation: Reservation = try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        if Task.isCancelled {
          continuation.resume(throwing: CancellationError())
          return
        }
        let activeDevice = fileURL.flatMap { telemetry?.register($0, role: "Cache") } ?? device
        waiters.append(
          Waiter(
            id: id, size: expectedSize, purpose: purpose, forceDisk: forceDisk,
            device: activeDevice, fileURL: fileURL, continuation: continuation))
        admitWaiters()
      }
    } onCancel: {
      Task { await self.cancelWaiter(id) }
    }

    return try await CachedBinaryWriter.make(
      reservation: reservation, directory: directory, fileURL: fileURL, preserveFile: preserveFile)
  }

  private func admitWaiters() {
    while entryCount < entryLimit {
      // Inputs and processing buffers must not wait behind downloads that need their consumers.
      let order = waiters.indices.sorted {
        let lhs = waiters[$0].purpose.isDownload
        let rhs = waiters[$1].purpose.isDownload
        return lhs == rhs ? $0 < $1 : !lhs
      }
      var admitted = false
      for index in order {
        let waiter = waiters[index]
        let requested = waiter.purpose.headroom
        let requestedMemory =
          waiter.purpose.isDownload
          ? max(requested.memory, headrooms.values.map(\.memory).max() ?? 0) : 0
        let requestedDisk =
          waiter.purpose.isDownload
          ? max(requested.disk, headrooms.values.map(\.disk).max() ?? 0) : 0
        let memoryHeadroom = requestedMemory - min(requestedMemory, inputMemoryBytes)
        let diskHeadroom = requestedDisk - min(requestedDisk, inputDiskBytes)
        if waiter.purpose.isDownload, requestedMemory > 0 || requestedDisk > 0,
          entryCount >= entryLimit - 1, entryCount == headrooms.count
        {
          continue
        }
        let freeMemory = memoryLimit - memoryBytes
        let retained = waiter.fileURL.flatMap { retainedFiles[Self.retainedKey($0)] }
        let storedBytes = retained?.size ?? 0
        let freeDisk = diskLimit - diskBytes + storedBytes
        let inMemory: Bool
        if !waiter.forceDisk, waiter.size <= freeMemory,
          memoryHeadroom <= freeMemory - waiter.size, diskHeadroom <= freeDisk
        {
          inMemory = true
          memoryBytes += waiter.size
        } else if waiter.size <= freeDisk, diskHeadroom <= freeDisk - waiter.size,
          memoryHeadroom <= freeMemory
        {
          inMemory = false
          diskBytes = diskBytes - storedBytes + waiter.size
          if let fileURL = waiter.fileURL {
            retainedFiles.removeValue(forKey: Self.retainedKey(fileURL))
          }
          telemetry?.release(storedBytes, inMemory: false, device: waiter.device)
        } else {
          continue
        }
        if waiter.purpose.isDownload {
          headrooms[waiter.id] = requested
        } else if inMemory {
          inputMemoryBytes += waiter.size
        } else {
          inputDiskBytes += waiter.size
        }
        entryCount += 1
        telemetry?.reserve(waiter.size, inMemory: inMemory, device: waiter.device)
        waiters.remove(at: index)
        waiter.continuation.resume(
          returning: Reservation(
            cache: self, id: waiter.id, size: waiter.size, inMemory: inMemory,
            device: waiter.device, telemetry: telemetry,
            storedBytes: inMemory ? 0 : storedBytes))
        admitted = true
        break
      }
      if !admitted { return }
    }
  }

  private func cancelWaiter(_ id: UUID) {
    guard let index = waiters.firstIndex(where: { $0.id == id }) else { return }
    let waiter = waiters.remove(at: index)
    waiter.continuation.resume(throwing: CancellationError())
    admitWaiters()
  }

  private func release(id: UUID, size: UInt64, inMemory: Bool, device: String) {
    if inMemory {
      memoryBytes -= size
      if headrooms[id] == nil { inputMemoryBytes -= size }
    } else {
      diskBytes -= size
      if headrooms[id] == nil { inputDiskBytes -= size }
    }
    entryCount -= 1
    headrooms.removeValue(forKey: id)
    telemetry?.release(size, inMemory: inMemory, device: device)
    admitWaiters()
  }

  func waitUntilUnused() async {
    while entryCount > 0 { try? await Task.sleep(for: .milliseconds(5)) }
  }

  func restoreDiskFiles(_ files: [URL: UInt64]) throws {
    let sizes = Dictionary(
      files.map { (Self.retainedKey($0.key), $0.value) }, uniquingKeysWith: max)
    let total = sizes.values.reduce(UInt64(0), +)
    guard total <= diskLimit - diskBytes else { throw BinaryCacheError.entryTooLarge(total) }
    for (path, size) in sizes {
      let device = telemetry?.register(URL(fileURLWithPath: path), role: "Cache") ?? self.device
      retainedFiles[path] = (size, device)
      diskBytes += size
      telemetry?.reserve(size, inMemory: false, device: device)
      telemetry?.stored(size, device: device)
    }
  }

  func removedRetainedFile(_ url: URL) {
    guard let retained = retainedFiles.removeValue(forKey: Self.retainedKey(url)) else { return }
    diskBytes -= retained.size
    telemetry?.release(retained.size, inMemory: false, device: retained.device)
    telemetry?.removed(retained.size, device: retained.device)
    admitWaiters()
  }

  func clearRetainedFiles() {
    for path in Array(retainedFiles.keys) { removedRetainedFile(URL(fileURLWithPath: path)) }
  }

  private static func retainedKey(_ url: URL) -> String {
    url.deletingLastPathComponent().standardizedFileURL.resolvingSymlinksInPath()
      .appendingPathComponent(url.lastPathComponent).path
  }
}
