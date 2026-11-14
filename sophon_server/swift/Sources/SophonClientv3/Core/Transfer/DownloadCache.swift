import Foundation

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

struct CachedDownload: Sendable {
  let fileURL: URL
  let size: UInt64
  // Protect the payload from eviction until the last consumer releases it.
  fileprivate let fileLock: TransferFileLock

  func release() throws { try fileLock.release() }
}

private enum DownloadCacheError: Error {
  case rangeUnsupported
  case capacityBusy
}

actor DownloadCache {
  private let directory: URL
  nonisolated let diskLimit: UInt64
  private let cachedSource: DownloadCache?
  private let maxRetries: Int
  private let retryInterval: Int
  private let http: RangeDownloadSession
  private let requests: WorkLimiter
  private let budget: DownloadBudget
  private let budgetOperations = WorkLimiter(limit: 1)
  private var checkedInitialCapacity = false

  init(
    directory: URL, diskLimit: UInt64, maxConcurrentDownloads: Int,
    maxRetries: Int, retryInterval: Int, cachedSource: DownloadCache? = nil,
    configuration: URLSessionConfiguration = .ephemeral, control: TransferControl? = nil
  ) {
    self.directory = directory
    self.diskLimit = diskLimit
    self.cachedSource = cachedSource
    budget = DownloadBudget(directory: directory, limit: diskLimit)
    self.maxRetries = maxRetries
    self.retryInterval = retryInterval
    configuration.httpMaximumConnectionsPerHost = maxConcurrentDownloads
    configuration.urlCache = nil
    http = RangeDownloadSession(configuration: configuration, control: control)
    requests = WorkLimiter(limit: maxConcurrentDownloads)
  }

  deinit { http.invalidate() }

  // Decision checks do not fetch data or change the cache. Usage still verifies MD5.
  func contains(_ request: DownloadRequest) async throws -> Bool {
    if let cachedSource, try await cachedSource.contains(request) { return true }
    let key = transferKey("\(request.md5.lowercased()):\(request.size)")
    let path = DownloadPaths(directory: directory, key: key).ready
    return try await runTransferIO {
      do {
        let size = try path.resourceValues(forKeys: [.fileSizeKey]).fileSize
        return size.flatMap(UInt64.init(exactly:)) == request.size
      } catch {
        if isMissingFile(error) { return false }
        throw error
      }
    }
  }

  func get(
    _ request: DownloadRequest, waitForSpace: Bool = true, telemetry: TransferTelemetry? = nil
  ) async throws -> CachedDownload {
    try Task.checkCancellation()
    if let cachedSource, try await cachedSource.contains(request) {
      return try await cachedSource.get(request, waitForSpace: false, telemetry: telemetry)
    }
    let key = transferKey("\(request.md5.lowercased()):\(request.size)")
    if !checkedInitialCapacity {
      // A restarted operation can lower its limit while all requested payloads are cached.
      // Trim idle entries before acquiring payload pins, avoiding mutually pinned waiters.
      do {
        try await reserveSpace(
          0, key: "", paths: DownloadPaths(directory: directory, key: ""), createPartial: false)
      } catch DownloadCacheError.capacityBusy {
        throw SophonClientError.UnknownError(
          "The download cache exceeds its limit and its payloads are currently in use")
      }
      checkedInitialCapacity = true
    }
    if let telemetry {
      telemetry.planDownload(
        request.chunkID, size: request.size,
        retained: try await retainedBytes(request, directory: directory))
    }
    return try await fetch(request, key: key, waitForSpace: waitForSpace, telemetry: telemetry)
  }

  func retainedBytes(_ request: DownloadRequest, directory: URL? = nil) async throws -> UInt64 {
    if let cachedSource, try await cachedSource.contains(request) { return request.size }
    if try await contains(request) { return request.size }
    let paths = DownloadPaths(
      directory: directory ?? self.directory,
      key: transferKey("\(request.md5.lowercased()):\(request.size)"))
    return try await runTransferIO {
      guard FileManager.default.fileExists(atPath: paths.partial.path) else { return 0 }
      return try DownloadContext.savedRanges(paths: paths, size: request.size).reduce(0) {
        $0 + $1.upperBound - $1.lowerBound
      }
    }
  }

  private func cached(
    _ request: DownloadRequest, telemetry: TransferTelemetry
  ) async throws -> CachedDownload? {
    let paths = DownloadPaths(
      directory: directory, key: transferKey("\(request.md5.lowercased()):\(request.size)"))
    guard FileManager.default.fileExists(atPath: paths.ready.path) else { return nil }
    let lease = try await acquireLock(paths.lock, shared: true)
    var handedOff = false
    defer { if !handedOff { try? lease.release() } }
    let device = telemetry.register(paths.ready, role: "Predownload")
    guard
      let digest = try await runTransferIO({
        try digestFile(paths.ready, telemetry: telemetry, device: device, isCache: true)
      }), digest.size == request.size, digest.md5 == request.md5.lowercased()
    else {
      return nil
    }
    handedOff = true
    return CachedDownload(fileURL: paths.ready, size: request.size, fileLock: lease)
  }

  func getWorking(
    _ request: DownloadRequest, directory: URL, cache: BinaryCache, purpose: BinaryCache.Purpose,
    telemetry: TransferTelemetry, io: WorkLimiter, category: String = "patch"
  ) async throws -> CachedBinary {
    let paths = DownloadPaths(
      directory: directory, key: transferKey("\(request.md5.lowercased()):\(request.size)"))
    let retained = try await retainedBytes(request, directory: directory)
    if !FileManager.default.fileExists(atPath: paths.partial.path) {
      try await runTransferIO { try removeOwnedFile(paths.index) }
    }
    let progressID = category == "patch" ? request.chunkID : "\(category):\(request.chunkID)"
    telemetry.planDownload(progressID, size: request.size, retained: retained, category: category)
    let writer = try await cache.makeWriter(
      expectedSize: request.size, purpose: purpose, fileURL: paths.partial, preserveFile: true)
    do {
      let source = cachedSource ?? self
      let copied = try await io.withPermit {
        guard let payload = try await source.cached(request, telemetry: telemetry) else {
          return false
        }
        let device = telemetry.register(payload.fileURL, role: "Predownload")
        let handle = try await runTransferIO { try FileHandle(forReadingFrom: payload.fileURL) }
        defer {
          try? handle.close()
          try? payload.release()
        }
        var offset: UInt64 = 0
        while let data = try await runTransferIO({
          try handle.read(upToCount: 1024 * 1024)
        }), !data.isEmpty {
          telemetry.cacheRead(UInt64(data.count), inMemory: false, device: device)
          try await writer.write(data, at: offset)
          offset += UInt64(data.count)
        }
        guard offset == request.size else { throw BinaryCacheError.unexpectedEndOfFile }
        return true
      }
      if copied {
        let binary = try await writer.finish()
        guard try await runTransferIO({ try binary.checksum() }) == request.md5.lowercased() else {
          try binary.remove()
          throw SophonClientError.InvalidChecksumError(
            expected: request.md5, actual: "cached payload")
        }
        telemetry.ready(progressID)
        return binary
      }
      let context = try await runTransferIO {
        try DownloadContext(
          paths: paths, request: request, writer: writer, telemetry: telemetry,
          progressID: progressID)
      }
      defer { context.close() }
      if writer.inMemory {
        let ranges = try await runTransferIO {
          try DownloadContext.savedRanges(paths: paths, size: request.size)
        }
        if !ranges.isEmpty {
          try await io.withPermit {
            let device = telemetry.register(paths.partial, role: "Cache")
            let handle = try await runTransferIO { try FileHandle(forReadingFrom: paths.partial) }
            defer { try? handle.close() }
            for range in ranges {
              var offset = range.lowerBound
              while offset < range.upperBound {
                let count = Int(min(1024 * 1024, range.upperBound - offset))
                let data = try await runTransferIO { [offset] in
                  try handle.seek(toOffset: offset)
                  return try handle.read(upToCount: count) ?? Data()
                }
                guard !data.isEmpty else { throw BinaryCacheError.unexpectedEndOfFile }
                telemetry.cacheRead(UInt64(data.count), inMemory: false, device: device)
                try await writer.write(data, at: offset)
                offset += UInt64(data.count)
              }
            }
          }
        }
        try await runTransferIO { try removeOwnedFile(paths.partial) }
        await cache.removedRetainedFile(paths.partial)
      }
      telemetry.planDownload(
        progressID, size: request.size, retained: context.receivedBytes, category: category)
      var lastError: (any Error)?
      for attempt in 0...maxRetries {
        try Task.checkCancellation()
        do {
          try await transfer(request, context: context)
          let checksum = try await runTransferIO { try writer.preview().checksum() }
          guard checksum == request.md5.lowercased() else {
            try await runTransferIO { try context.reset() }
            throw SophonClientError.InvalidChecksumError(expected: request.md5, actual: checksum)
          }
          let binary = try await writer.finish()
          telemetry.ready(progressID)
          return binary
        } catch {
          try Task.checkCancellation()
          if let error = error as? SophonClientError,
            case .InvalidHTTPStatus(let code) = error,
            (400..<500).contains(code), code != 408, code != 429
          {
            throw error
          }
          lastError = error
          if attempt < maxRetries { try await Task.sleep(for: .seconds(retryInterval)) }
        }
      }
      throw lastError ?? SophonClientError.UnknownError("Download failed")
    } catch {
      writer.pause()
      throw error
    }
  }

  private func transfer(_ request: DownloadRequest, context: DownloadContext) async throws {
    if context.useWholeRequest {
      try await transferWhole(request, context: context)
    } else {
      do { try await transferRanges(request, context: context) } catch DownloadCacheError
        .rangeUnsupported
      {
        try await runTransferIO { try context.disableRanges() }
        try await transferWhole(request, context: context)
      }
    }
  }

  private func fetch(
    _ request: DownloadRequest, key: String, waitForSpace: Bool,
    telemetry: TransferTelemetry?
  ) async throws
    -> CachedDownload
  {
    guard request.size <= diskLimit, request.size <= UInt64(Int64.max) else {
      throw BinaryCacheError.entryTooLarge(request.size)
    }
    let paths = DownloadPaths(directory: directory, key: key)
    let device = telemetry?.register(directory, role: "Predownload") ?? ""
    let (fileLock, readyExists) = try await acquirePayloadLock(paths)
    var handedOff = false
    defer { if !handedOff { try? fileLock.release() } }

    // Another process can finish or evict the payload while this lock is acquired.
    if let digest = try await runTransferIO({
      try digestFile(paths.ready, telemetry: telemetry, device: device, isCache: true)
    }),
      digest.size == request.size, digest.md5 == request.md5.lowercased()
    {
      try fileLock.makeShared()
      telemetry?.ready(request.chunkID)
      telemetry?.stored(request.size, device: device)
      handedOff = true
      return CachedDownload(fileURL: paths.ready, size: request.size, fileLock: fileLock)
    }
    if readyExists {
      // Drop our invalid payload's shared lock before competing to repair it.
      try fileLock.unlock()
      while true {
        do {
          try await runTransferIO { try fileLock.makeExclusive() }
          break
        } catch TransferLockError.busy {
          // A competing caller may repair the entry and keep it pinned for reading.
          do { try fileLock.makeShared() } catch TransferLockError.busy {
            try await Task.sleep(for: .milliseconds(20))
            continue
          }
          if let digest = try await runTransferIO({
            try digestFile(paths.ready, telemetry: telemetry, device: device, isCache: true)
          }),
            digest.size == request.size, digest.md5 == request.md5.lowercased()
          {
            telemetry?.ready(request.chunkID)
            telemetry?.stored(request.size, device: device)
            handedOff = true
            return CachedDownload(fileURL: paths.ready, size: request.size, fileLock: fileLock)
          }
          try fileLock.unlock()
          try await Task.sleep(for: .milliseconds(20))
        }
      }
      if let digest = try await runTransferIO({
        try digestFile(paths.ready, telemetry: telemetry, device: device, isCache: true)
      }),
        digest.size == request.size, digest.md5 == request.md5.lowercased()
      {
        try fileLock.makeShared()
        telemetry?.ready(request.chunkID)
        telemetry?.stored(request.size, device: device)
        handedOff = true
        return CachedDownload(fileURL: paths.ready, size: request.size, fileLock: fileLock)
      }
    }
    if FileManager.default.fileExists(atPath: paths.ready.path) {
      try await withBudget { try $0.remove(paths) }
    }

    while true {
      do {
        try await reserveSpace(request.size, key: key, paths: paths)
        break
      } catch DownloadCacheError.capacityBusy {
        guard waitForSpace else {
          throw SophonClientError.UnknownError(
            "The download cache has insufficient unpinned space for the predownload")
        }
        try await Task.sleep(for: .milliseconds(100))
      }
    }
    let context = try await runTransferIO {
      try DownloadContext(paths: paths, request: request, telemetry: telemetry)
    }
    defer { context.close() }
    var lastError: (any Error)?

    for attempt in 0...maxRetries {
      try Task.checkCancellation()
      do {
        if context.useWholeRequest {
          try await transferWhole(request, context: context)
        } else {
          do { try await transferRanges(request, context: context) } catch DownloadCacheError
            .rangeUnsupported
          {
            try await runTransferIO { try context.disableRanges() }
            try await transferWhole(request, context: context)
          }
        }
        let digest = try await runTransferIO {
          try digestFile(paths.partial, telemetry: telemetry, device: device, isCache: true)
        }
        guard digest?.size == request.size, digest?.md5 == request.md5.lowercased() else {
          try await runTransferIO { try context.reset() }
          throw SophonClientError.InvalidChecksumError(
            expected: request.md5, actual: digest?.md5 ?? "missing payload")
        }
        try await finish(context: context, paths: paths)
        try fileLock.makeShared()
        telemetry?.ready(request.chunkID)
        handedOff = true
        return CachedDownload(fileURL: paths.ready, size: request.size, fileLock: fileLock)
      } catch {
        try Task.checkCancellation()
        if let error = error as? SophonClientError,
          case .InvalidHTTPStatus(let code) = error,
          (400..<500).contains(code), code != 408, code != 429
        {
          throw error
        }
        lastError = error
        if attempt < maxRetries { try await Task.sleep(for: .seconds(retryInterval)) }
      }
    }
    throw lastError ?? SophonClientError.UnknownError("Download failed")
  }

  private func transferRanges(_ request: DownloadRequest, context: DownloadContext) async throws {
    let pending = context.pendingRanges()
    try await withThrowingTaskGroup(of: Void.self) { group in
      var next = 0
      func addNext() {
        guard next < pending.count else { return }
        let index = pending[next]
        next += 1
        group.addTask { [requests, http] in
          try await requests.withPermit {
            let transfer = RangeTransfer(request: request, context: context, index: index)
            try await transfer.run(http)
          }
        }
      }
      for _ in 0..<min(8, pending.count) { addNext() }
      do { while try await group.next() != nil { addNext() } } catch {
        group.cancelAll()
        throw error
      }
    }
  }

  private func transferWhole(_ request: DownloadRequest, context: DownloadContext) async throws {
    guard request.size > 0 else { return }
    try await requests.withPermit { [http] in
      try await RangeTransfer(request: request, context: context, index: nil).run(http)
    }
  }

  private func acquireLock(_ path: URL, shared: Bool = false) async throws -> TransferFileLock {
    while true {
      do {
        return try await runTransferIO { try TransferFileLock(path, shared: shared) }
      } catch TransferLockError.busy { try await Task.sleep(for: .milliseconds(20)) }
    }
  }

  // Waiting callers can share a newly completed payload without waiting for its consumers.
  private func acquirePayloadLock(_ paths: DownloadPaths) async throws -> (TransferFileLock, Bool) {
    while true {
      let ready = FileManager.default.fileExists(atPath: paths.ready.path)
      do {
        return (try await runTransferIO { try TransferFileLock(paths.lock, shared: ready) }, ready)
      } catch TransferLockError.busy { try await Task.sleep(for: .milliseconds(20)) }
    }
  }

  private func reserveSpace(
    _ size: UInt64, key: String, paths: DownloadPaths, createPartial: Bool = true
  ) async throws {
    try await withBudget {
      try $0.reserve(size, key: key, paths: paths, createPartial: createPartial)
    }
  }

  private func finish(context: DownloadContext, paths: DownloadPaths) async throws {
    try await withBudget(checkCancellation: false) { budget in
      context.close()
      try budget.finish(paths)
    }
  }

  private func withBudget(
    checkCancellation: Bool = true, _ operation: @escaping @Sendable (DownloadBudget) throws -> Void
  ) async throws {
    try await budgetOperations.withPermit {
      let lock = try await self.acquireLock(self.directory.appendingPathComponent("budget.lock"))
      defer { withExtendedLifetime(lock) {} }
      try await runTransferIO(checkCancellation: checkCancellation) { try operation(self.budget) }
    }
  }
}

// Accessed only while the caller holds budget.lock, including across processes.
private final class DownloadBudget: @unchecked Sendable {
  private struct Entry {
    let size: UInt64
    let modified: Date
  }

  private let directory: URL
  private let limit: UInt64
  private var occupied: UInt64 = 0
  private var entries: [String: Entry] = [:]
  private var ready: [String] = []
  private var revision: Data?
  private var loaded = false

  init(directory: URL, limit: UInt64) {
    self.directory = directory
    self.limit = limit
  }

  private func refresh() throws {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let versionURL = directory.appendingPathComponent("budget.version")
    let version: Data?
    do { version = try Data(contentsOf: versionURL) } catch {
      if !isMissingFile(error) { throw error }
      version = nil
    }
    guard !loaded || revision != version else { return }
    var current: [String: Entry] = [:]
    var bytes: UInt64 = 0
    for name in try FileManager.default.contentsOfDirectory(atPath: directory.path)
    where name.hasSuffix(".bin") || name.hasSuffix(".partial") {
      let metadata = try transferFileMetadata(directory.path + "/" + name)
      current[name] = Entry(size: metadata.size, modified: metadata.modified)
      bytes += metadata.size
    }
    entries = current
    occupied = bytes
    ready = current.keys.filter { $0.hasSuffix(".bin") }.sorted {
      current[$0]!.modified < current[$1]!.modified
    }
    revision = version
    loaded = true
  }

  // Change the marker before touching payloads. A killed writer leaves other indexes stale,
  // so the next holder of budget.lock reconstructs accounting from the actual files.
  private func mutate(_ operation: () throws -> Void) throws {
    let version = Data(UUID().uuidString.utf8)
    try version.write(to: directory.appendingPathComponent("budget.version"), options: .atomic)
    loaded = false
    try operation()
    revision = version
    loaded = true
  }

  func reserve(_ size: UInt64, key: String, paths: DownloadPaths, createPartial: Bool) throws {
    try refresh()
    let partialName = paths.partial.lastPathComponent
    let existing = FileManager.default.fileExists(atPath: paths.partial.path)
    // Recover accounting if a caller removed its partial outside the cache protocol.
    if (entries[partialName] != nil) != existing {
      loaded = false
      try refresh()
    }
    let required = existing ? 0 : size
    var remaining = occupied
    var victims: [String] = []
    var locks: [TransferFileLock] = []
    var active = false
    defer { withExtendedLifetime(locks) {} }
    if remaining > limit - required {
      for name in ready {
        guard remaining > limit - required else { break }
        let otherKey = String(name.dropLast(4))
        guard otherKey != key else { continue }
        let other = DownloadPaths(directory: directory, key: otherKey)
        do { locks.append(try TransferFileLock(other.lock)) } catch TransferLockError.busy {
          active = true
          continue
        }
        victims.append(name)
        remaining -= entries[name]!.size
      }
    }
    if remaining > limit - required {
      for name in entries.keys where name.hasSuffix(".partial") {
        let otherKey = String(name.dropLast(8))
        guard otherKey != key else { continue }
        do {
          let lock = try TransferFileLock(DownloadPaths(directory: directory, key: otherKey).lock)
          withExtendedLifetime(lock) {}
        } catch TransferLockError.busy { active = true }
      }
      if active { throw DownloadCacheError.capacityBusy }
      throw SophonClientError.UnknownError(
        "Download cache is full of active or partial downloads; increase its limit or resume them")
    }
    guard !victims.isEmpty || (!existing && createPartial) else { return }
    try mutate {
      for name in victims {
        let other = DownloadPaths(directory: directory, key: String(name.dropLast(4)))
        try removeOwnedFile(other.ready)
        try removeOwnedFile(other.index)
        occupied -= entries.removeValue(forKey: name)!.size
      }
      let removed = Set(victims)
      ready.removeAll { removed.contains($0) }
      if !existing, createPartial {
        guard FileManager.default.createFile(atPath: paths.partial.path, contents: nil) else {
          throw SophonClientError.UnknownError("Cannot create \(paths.partial.path)")
        }
        let handle = try FileHandle(forUpdating: paths.partial)
        defer { try? handle.close() }
        try handle.truncate(atOffset: size)
        entries[partialName] = Entry(size: size, modified: Date())
        occupied += size
      }
    }
  }

  func finish(_ paths: DownloadPaths) throws {
    try refresh()
    try mutate {
      try FileManager.default.moveItem(at: paths.partial, to: paths.ready)
      try? removeOwnedFile(paths.index)
      let partial = entries.removeValue(forKey: paths.partial.lastPathComponent)!
      let name = paths.ready.lastPathComponent
      let modified = try transferFileMetadata(paths.ready.path).modified
      entries[name] = Entry(size: partial.size, modified: modified)
      var lower = 0
      var upper = ready.count
      while lower < upper {
        let middle = (lower + upper) / 2
        if entries[ready[middle]]!.modified < modified {
          lower = middle + 1
        } else {
          upper = middle
        }
      }
      ready.insert(name, at: lower)
    }
  }

  func remove(_ paths: DownloadPaths) throws {
    try refresh()
    try mutate {
      for path in [paths.ready, paths.partial, paths.index] {
        try removeOwnedFile(path)
        if let entry = entries.removeValue(forKey: path.lastPathComponent) {
          occupied -= entry.size
        }
      }
      ready.removeAll { $0 == paths.ready.lastPathComponent }
    }
  }
}

private struct DownloadPaths: Sendable {
  let partial: URL
  let ready: URL
  let index: URL
  let lock: URL

  init(directory: URL, key: String) {
    partial = directory.appendingPathComponent(key + ".partial")
    ready = directory.appendingPathComponent(key + ".bin")
    index = directory.appendingPathComponent(key + ".jsonl")
    lock = directory.appendingPathComponent(key + ".lock")
  }
}

private final class DownloadContext: @unchecked Sendable {
  static let blockSize: UInt64 = 4 * 1024 * 1024
  private struct Record: Codable {
    var range: Int?
    var bytes: UInt64?
    var wholeRequest: Bool?
  }
  private let lock = NSLock()
  private let data: FileHandle?
  private let index: FileHandle?
  private let writer: CachedBinaryWriter?
  private let telemetry: TransferTelemetry?
  private let downloadID: String
  private let device: String
  private let encoder = JSONEncoder()
  let size: UInt64
  private var prefixes: [UInt64]
  private var wholeRequest = false
  private var closed = false

  init(
    paths: DownloadPaths, request: DownloadRequest, writer: CachedBinaryWriter? = nil,
    telemetry: TransferTelemetry? = nil, progressID: String? = nil
  ) throws {
    size = request.size
    self.writer = writer
    self.telemetry = telemetry
    self.downloadID = progressID ?? request.chunkID
    self.device = telemetry?.register(paths.partial, role: "Cache") ?? ""
    prefixes = Array(
      repeating: 0, count: Int(size / Self.blockSize + (size % Self.blockSize == 0 ? 0 : 1)))
    data = writer == nil ? try FileHandle(forUpdating: paths.partial) : nil
    let journalsToDisk = writer == nil || writer?.inMemory == false
    if journalsToDisk, !FileManager.default.fileExists(atPath: paths.index.path) {
      guard FileManager.default.createFile(atPath: paths.index.path, contents: nil) else {
        try? data?.close()
        throw SophonClientError.UnknownError("Cannot create download progress journal")
      }
    }
    index = journalsToDisk ? try FileHandle(forUpdating: paths.index) : nil
    let saved: Data
    do { saved = try Data(contentsOf: paths.index) } catch {
      if isMissingFile(error) { saved = Data() } else { throw error }
    }
    var validLength = 0
    for line in saved.split(separator: 10, omittingEmptySubsequences: false).dropLast() {
      let record = try JSONDecoder().decode(Record.self, from: Data(line))
      if let range = record.range, let bytes = record.bytes {
        guard prefixes.indices.contains(range), bytes <= length(of: range) else {
          throw SophonClientError.UnknownError("Invalid download progress journal")
        }
        prefixes[range] = bytes
      }
      if let whole = record.wholeRequest { wholeRequest = whole }
      validLength += line.count + 1
    }
    try index?.truncate(atOffset: UInt64(validLength))
    try index?.seekToEnd()
    if writer?.inMemory == false {
      try writer?.restoreRanges(
        prefixes.enumerated().compactMap { range, bytes in
          guard bytes > 0 else { return nil }
          let start = UInt64(range) * Self.blockSize
          return start..<(start + bytes)
        })
    }
  }

  static func savedRanges(paths: DownloadPaths, size: UInt64) throws -> [Range<UInt64>] {
    guard FileManager.default.fileExists(atPath: paths.partial.path) else { return [] }
    let saved: Data
    do { saved = try Data(contentsOf: paths.index) } catch {
      if isMissingFile(error) { return [] }
      throw error
    }
    let count = Int(size / blockSize + (size % blockSize == 0 ? 0 : 1))
    var prefixes = Array(repeating: UInt64(0), count: count)
    for line in saved.split(separator: 10, omittingEmptySubsequences: false).dropLast() {
      let record = try JSONDecoder().decode(Record.self, from: Data(line))
      if let range = record.range, let bytes = record.bytes {
        guard prefixes.indices.contains(range),
          bytes <= min(blockSize, size - UInt64(range) * blockSize)
        else { throw SophonClientError.UnknownError("Invalid download progress journal") }
        prefixes[range] = bytes
      }
    }
    return prefixes.enumerated().compactMap { range, bytes in
      guard bytes > 0 else { return nil }
      let start = UInt64(range) * blockSize
      return start..<(start + bytes)
    }
  }

  var useWholeRequest: Bool { lock.withLock { wholeRequest } }
  var receivedBytes: UInt64 { lock.withLock { prefixes.reduce(0, +) } }

  func length(of range: Int) -> UInt64 {
    min(Self.blockSize, size - UInt64(range) * Self.blockSize)
  }

  func pendingRanges() -> [Int] {
    lock.withLock { prefixes.indices.filter { prefixes[$0] < length(of: $0) } }
  }

  func start(of range: Int) -> UInt64 {
    lock.withLock { UInt64(range) * Self.blockSize + prefixes[range] }
  }

  func write(_ bytes: Data, at position: UInt64, allowExisting: Bool) throws {
    try lock.withLock {
      guard !closed, position <= size, UInt64(bytes.count) <= size - position else {
        throw BinaryCacheError.outOfBounds
      }
      var offset = position
      let end = position + UInt64(bytes.count)
      while offset < end {
        let range = Int(offset / Self.blockSize)
        let base = UInt64(range) * Self.blockSize
        let next = min(end, base + length(of: range))
        let savedEnd = base + prefixes[range]
        guard offset <= savedEnd, allowExisting || offset == savedEnd else {
          throw SophonClientError.UnknownError("Noncontiguous download range")
        }
        let writeFrom = max(offset, savedEnd)
        if writeFrom < next {
          let lower = Int(writeFrom - position)
          let upper = Int(next - position)
          let part = bytes.subdata(in: lower..<upper)
          if let writer {
            try writer.writeBlocking(part, at: writeFrom)
          } else {
            try data?.seek(toOffset: writeFrom)
            try data?.write(contentsOf: part)
            telemetry?.cacheWrite(UInt64(part.count), inMemory: false, device: device)
            telemetry?.stored(UInt64(part.count), device: device)
          }
          try append(Record(range: range, bytes: next - base))
          prefixes[range] = next - base
        }
        offset = next
      }
      telemetry?.receive(
        UInt64(bytes.count), committed: prefixes.reduce(0, +), id: downloadID)
    }
  }

  func disableRanges() throws {
    try lock.withLock {
      try append(Record(wholeRequest: true))
      wholeRequest = true
    }
  }

  func reset() throws {
    try lock.withLock {
      // Keep the reservation visible to other processes; all prefixes restart at zero.
      try data?.truncate(atOffset: size)
      try index?.truncate(atOffset: 0)
      try index?.seek(toOffset: 0)
      prefixes = Array(repeating: 0, count: prefixes.count)
      if wholeRequest { try append(Record(wholeRequest: true)) }
      telemetry?.resetDownload(downloadID)
    }
  }

  private func append(_ record: Record) throws {
    guard let index else { return }
    var bytes = try encoder.encode(record)
    bytes.append(10)
    let offset = try index.offset()
    do {
      try index.write(contentsOf: bytes)
      telemetry?.cacheWrite(UInt64(bytes.count), inMemory: false, device: device)
    } catch {
      try? index.truncate(atOffset: offset)
      try? index.seek(toOffset: offset)
      throw error
    }
  }

  func close() {
    lock.withLock {
      if closed { return }
      closed = true
      try? data?.close()
      try? index?.close()
    }
  }

  deinit { close() }
}

private final class RangeTransfer: @unchecked Sendable {
  let request: URLRequest
  private let context: DownloadContext
  private let position: UInt64
  private let length: UInt64
  private let totalSize: UInt64
  private let whole: Bool
  private let lock = NSLock()
  private var continuation: CheckedContinuation<Void, any Error>?
  private var task: URLSessionDataTask?
  private var cancelled = false
  private var failure: (any Error)?
  private var received: UInt64 = 0

  init(request: DownloadRequest, context: DownloadContext, index: Int?) {
    self.context = context
    totalSize = request.size
    whole = index == nil
    let position = index.map { context.start(of: $0) } ?? 0
    self.position = position
    length =
      index.map {
        UInt64($0) * DownloadContext.blockSize + context.length(of: $0) - position
      } ?? request.size
    var urlRequest = URLRequest(url: request.url)
    urlRequest.cachePolicy = .reloadIgnoringLocalCacheData
    urlRequest.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
    if index != nil {
      urlRequest.setValue("bytes=\(position)-\(position + length - 1)", forHTTPHeaderField: "Range")
    }
    self.request = urlRequest
  }

  func run(_ session: RangeDownloadSession) async throws {
    try Task.checkCancellation()
    try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        let task = session.makeTask(self)
        let cancelled = lock.withLock {
          self.continuation = continuation
          self.task = task
          return self.cancelled
        }
        if cancelled { cancel(session) } else { task.resume() }
      }
    } onCancel: {
      cancel(session)
    }
  }

  func accept(_ response: URLResponse) -> Bool {
    do {
      guard let response = response as? HTTPURLResponse else {
        throw SophonClientError.InvalidHTTPResponse
      }
      if response.statusCode == 200 {
        guard whole || (position == 0 && length == totalSize) else {
          throw DownloadCacheError.rangeUnsupported
        }
      } else if response.statusCode == 206 {
        let value = response.value(forHTTPHeaderField: "Content-Range") ?? ""
        guard value == "bytes \(position)-\(position + length - 1)/\(totalSize)" else {
          throw SophonClientError.UnknownError("Invalid HTTP Content-Range: \(value)")
        }
      } else {
        throw SophonClientError.InvalidHTTPStatus(response.statusCode)
      }
      guard response.expectedContentLength < 0 || UInt64(response.expectedContentLength) == length
      else {
        throw SophonClientError.UnknownError("HTTP range length does not match the requested bytes")
      }
      return true
    } catch {
      lock.withLock { failure = error }
      return false
    }
  }

  func receive(_ data: Data) -> Bool {
    lock.withLock {
      guard continuation != nil, failure == nil, !cancelled else { return true }
      do {
        guard UInt64(data.count) <= length - received else { throw BinaryCacheError.outOfBounds }
        try context.write(data, at: position + received, allowExisting: whole)
        received += UInt64(data.count)
        return true
      } catch {
        failure = error
        return false
      }
    }
  }

  func complete(_ error: (any Error)?) {
    let state = lock.withLock {
      let continuation = continuation
      self.continuation = nil
      task = nil
      return (continuation, failure, cancelled, received)
    }
    guard let continuation = state.0 else { return }
    if state.2 {
      continuation.resume(throwing: CancellationError())
    } else if let error = state.1 ?? error {
      continuation.resume(throwing: error)
    } else if state.3 != length {
      continuation.resume(
        throwing: SophonClientError.SizeMismatch(expected: length, actual: state.3))
    } else {
      continuation.resume()
    }
  }

  private func cancel(_ session: RangeDownloadSession) {
    let task = lock.withLock {
      cancelled = true
      return self.task
    }
    task?.cancel()
    if let task { session.forget(task.taskIdentifier) }
    complete(nil)
  }
}

private final class RangeDownloadSession: NSObject, URLSessionDataDelegate, @unchecked Sendable {
  private let lock = NSLock()
  private var transfers: [Int: RangeTransfer] = [:]
  private var session: URLSession!
  private let control: TransferControl?

  init(configuration: URLSessionConfiguration, control: TransferControl?) {
    self.control = control
    super.init()
    let queue = OperationQueue()
    queue.maxConcurrentOperationCount = 1
    queue.qualityOfService = .utility
    session = URLSession(configuration: configuration, delegate: self, delegateQueue: queue)
  }

  func makeTask(_ transfer: RangeTransfer) -> URLSessionDataTask {
    let task = session.dataTask(with: transfer.request)
    lock.withLock { transfers[task.taskIdentifier] = transfer }
    return task
  }

  func invalidate() { session.invalidateAndCancel() }

  func forget(_ id: Int) { _ = lock.withLock { transfers.removeValue(forKey: id) } }

  func urlSession(
    _ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
    completionHandler: @escaping @Sendable (URLSession.ResponseDisposition) -> Void
  ) {
    let transfer = lock.withLock { transfers[dataTask.taskIdentifier] }
    if transfer?.accept(response) == true {
      completionHandler(.allow)
    } else {
      completionHandler(.cancel)
      forget(dataTask.taskIdentifier)
      transfer?.complete(nil)
    }
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    let transfer = lock.withLock { transfers[dataTask.taskIdentifier] }
    if control?.admit(data.count) == false || transfer?.receive(data) == false {
      dataTask.cancel()
      forget(dataTask.taskIdentifier)
      transfer?.complete(nil)
    }
  }

  func urlSession(
    _ session: URLSession, task: URLSessionTask, didCompleteWithError error: (any Error)?
  ) {
    lock.withLock { transfers.removeValue(forKey: task.taskIdentifier) }?.complete(error)
  }
}
