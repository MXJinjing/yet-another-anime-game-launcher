import Crypto
import Foundation

let transferIOQueue = DispatchQueue(
  label: "sophon.transfer.io", qos: .utility, attributes: .concurrent)

func runTransferIO<T: Sendable>(
  checkCancellation: Bool = true,
  _ operation: @escaping @Sendable () throws -> T
) async throws -> T {
  if checkCancellation { try Task.checkCancellation() }
  return try await withCheckedThrowingContinuation { continuation in
    transferIOQueue.async {
      #if canImport(ObjectiveC)
        continuation.resume(with: Result { try autoreleasepool(invoking: operation) })
      #else
        continuation.resume(with: Result(catching: operation))
      #endif
    }
  }
}

func isMissingFile(_ error: any Error) -> Bool {
  let error = error as NSError
  return error.domain == NSCocoaErrorDomain
    && (error.code == CocoaError.Code.fileNoSuchFile.rawValue
      || error.code == CocoaError.Code.fileReadNoSuchFile.rawValue)
}

func removeOwnedFile(_ fileURL: URL) throws {
  do { try FileManager.default.removeItem(at: fileURL) } catch {
    if !isMissingFile(error) { throw error }
  }
}

func transferKey(_ value: String) -> String {
  SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
}

// Quota scans need only size and time, without owner-name or extended-attribute queries.
func transferFileMetadata(_ path: String) throws -> (size: UInt64, modified: Date) {
  #if canImport(Darwin) || canImport(Glibc)
    var info = stat()
    guard lstat(path, &info) == 0 else {
      throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }
    #if canImport(Darwin)
      let time = info.st_mtimespec
    #else
      let time = info.st_mtim
    #endif
    return (
      UInt64(max(0, info.st_size)),
      Date(timeIntervalSince1970: Double(time.tv_sec) + Double(time.tv_nsec) / 1_000_000_000)
    )
  #else
    let attributes = try FileManager.default.attributesOfItem(atPath: path)
    return (
      (attributes[.size] as? NSNumber)?.uint64Value ?? 0,
      attributes[.modificationDate] as? Date ?? .distantPast
    )
  #endif
}

struct FileDigest: Sendable {
  let size: UInt64
  let md5: String
}

func digestFile(
  _ fileURL: URL, telemetry: TransferTelemetry? = nil, device: String? = nil, isCache: Bool = false
) throws -> FileDigest? {
  let handle: FileHandle
  do { handle = try FileHandle(forReadingFrom: fileURL) } catch {
    if isMissingFile(error) { return nil }
    throw error
  }
  defer { try? handle.close() }

  var hasher = Insecure.MD5()
  var size: UInt64 = 0
  let activeDevice = device ?? telemetry?.register(fileURL, role: "Target") ?? ""
  #if canImport(ObjectiveC)
    var reachedEnd = false
    while !reachedEnd {
      try autoreleasepool {
        guard let data = try handle.read(upToCount: 1024 * 1024), !data.isEmpty else {
          reachedEnd = true
          return
        }
        hasher.update(data: data)
        size += UInt64(data.count)
        if isCache {
          telemetry?.cacheRead(UInt64(data.count), inMemory: false, device: activeDevice)
        } else {
          telemetry?.read(UInt64(data.count), device: activeDevice)
        }
      }
    }
  #else
    while let data = try handle.read(upToCount: 1024 * 1024), !data.isEmpty {
      hasher.update(data: data)
      size += UInt64(data.count)
      if isCache {
        telemetry?.cacheRead(UInt64(data.count), inMemory: false, device: activeDevice)
      } else {
        telemetry?.read(UInt64(data.count), device: activeDevice)
      }
    }
  #endif
  return FileDigest(
    size: size, md5: hasher.finalize().map { String(format: "%02x", $0) }.joined())
}

// The operating system releases this lock even when the process is killed.
enum TransferLockError: LocalizedError {
  case busy(URL)

  var errorDescription: String? {
    switch self {
    case .busy(let fileURL):
      return "Another transfer is using \(fileURL.deletingLastPathComponent().path)"
    }
  }
}

final class TransferFileLock: @unchecked Sendable {
  private let handle: FileHandle
  private let fileURL: URL
  private let stateLock = NSLock()
  private var closed = false

  init(_ fileURL: URL, shared: Bool = false) throws {
    self.fileURL = fileURL
    try FileManager.default.createDirectory(
      at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    let descriptor = open(fileURL.path, O_CREAT | O_RDWR, mode_t(0o600))
    guard descriptor >= 0 else {
      throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }
    guard flock(descriptor, (shared ? LOCK_SH : LOCK_EX) | LOCK_NB) == 0 else {
      let code = errno
      _ = close(descriptor)
      if code == EWOULDBLOCK || code == EAGAIN { throw TransferLockError.busy(fileURL) }
      throw POSIXError(POSIXErrorCode(rawValue: code) ?? .EIO)
    }
    handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
  }

  func makeShared() throws { try changeLock(LOCK_SH | LOCK_NB) }

  func makeExclusive() throws { try changeLock(LOCK_EX | LOCK_NB) }

  func unlock() throws { try changeLock(LOCK_UN) }

  private func changeLock(_ operation: Int32) throws {
    try stateLock.withLock {
      guard !closed else { throw POSIXError(.EBADF) }
      guard flock(handle.fileDescriptor, operation) == 0 else {
        let code = errno
        if code == EWOULDBLOCK || code == EAGAIN { throw TransferLockError.busy(fileURL) }
        throw POSIXError(POSIXErrorCode(rawValue: code) ?? .EIO)
      }
    }
  }

  func release() throws {
    try stateLock.withLock {
      guard !closed else { return }
      defer { closed = true }
      _ = flock(handle.fileDescriptor, LOCK_UN)
      try handle.close()
    }
  }

  deinit { try? release() }
}

actor WorkLimiter {
  final class Permit: Sendable {
    private let owner: WorkLimiter
    init(_ owner: WorkLimiter) { self.owner = owner }
    deinit {
      let owner = owner
      Task { await owner.release() }
    }
  }

  private var available: Int
  private var waiters: [(UUID, CheckedContinuation<Permit, any Error>)] = []

  init(limit: Int) { available = limit }

  func acquire() async throws -> Permit {
    try Task.checkCancellation()
    let id = UUID()
    return try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        if Task.isCancelled {
          continuation.resume(throwing: CancellationError())
          return
        }
        if available > 0, waiters.isEmpty {
          available -= 1
          continuation.resume(returning: Permit(self))
        } else {
          waiters.append((id, continuation))
        }
      }
    } onCancel: {
      Task { await self.cancel(id) }
    }
  }

  func withPermit<T: Sendable>(_ operation: @Sendable () async throws -> T) async throws -> T {
    let permit = try await acquire()
    defer { withExtendedLifetime(permit) {} }
    try Task.checkCancellation()
    return try await operation()
  }

  private func release() {
    if waiters.isEmpty {
      available += 1
    } else {
      waiters.removeFirst().1.resume(returning: Permit(self))
    }
  }

  private func cancel(_ id: UUID) {
    guard let index = waiters.firstIndex(where: { $0.0 == id }) else { return }
    waiters.remove(at: index).1.resume(throwing: CancellationError())
  }
}

// Keeping the backup until the new name exists makes both rename boundaries recoverable.
func commitUpdatedFile(temporary: URL, target: URL, backup: URL) throws {
  let manager = FileManager.default
  if manager.fileExists(atPath: backup.path) {
    if !manager.fileExists(atPath: target.path) {
      try manager.moveItem(at: backup, to: target)
    } else {
      try removeOwnedFile(backup)
    }
  }
  if manager.fileExists(atPath: target.path) {
    var isDirectory: ObjCBool = false
    _ = manager.fileExists(atPath: target.path, isDirectory: &isDirectory)
    guard !isDirectory.boolValue else {
      throw SophonClientError.UnknownError("Update target is a directory: \(target.path)")
    }
    let attributes = try manager.attributesOfItem(atPath: target.path)
    let newAttributes = try manager.attributesOfItem(atPath: temporary.path)
    if let mode = attributes[.posixPermissions] as? NSNumber,
      mode != newAttributes[.posixPermissions] as? NSNumber
    {
      try manager.setAttributes([.posixPermissions: mode], ofItemAtPath: temporary.path)
    }
    try manager.moveItem(at: target, to: backup)
  }
  do { try manager.moveItem(at: temporary, to: target) } catch {
    if !manager.fileExists(atPath: target.path), manager.fileExists(atPath: backup.path) {
      try manager.moveItem(at: backup, to: target)
    }
    throw error
  }
  try removeOwnedFile(backup)
}
