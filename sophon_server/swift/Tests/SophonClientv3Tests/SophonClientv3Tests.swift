import Foundation
import HYPAPIClient
import Testing

@testable import enum SophonCLI.JSONValue
@testable import struct SophonCLI.RPCCLI
@testable import class SophonCLI.RPCDispatcher
@testable import class SophonCLI.RPCEventBuffer
@testable import class SophonCLI.RPCLogStream
@testable import struct SophonCLI.RPCNotification
@testable import struct SophonCLI.RPCOperationParameters
@testable import class SophonCLI.RPCOutput
@testable import class SophonCLI.RPCProgressFeed
@testable import struct SophonCLI.RPCSessionSettings
@testable import class SophonCLI.RPCSnapshotFeed
@testable import SophonClientv3

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

func getTestDataPath() -> URL {
  return URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent()
    .appendingPathComponent(".testData")
}

private struct HDiffFixture: Decodable {
  let old: Data
  let new: Data
  let patch: Data
}

private func loadHDiffFixture() throws -> HDiffFixture {
  let fixtureURL = try #require(
    Bundle.module.url(forResource: "HDiffFixture", withExtension: "json", subdirectory: "Fixtures"))
  return try JSONDecoder().decode(HDiffFixture.self, from: Data(contentsOf: fixtureURL))
}

@Test(arguments: [UInt64(0), UInt64(500 * 1024)])
func testStreamedPatchWithCachedInputs(memoryLimit: UInt64) async throws {
  let fixture = try loadHDiffFixture()
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: root) }
  let telemetry = TransferTelemetry(memoryLimit: memoryLimit, diskLimit: 2 * 1024 * 1024)
  let cache = try BinaryCache(
    directory: root.appendingPathComponent("cache"), memoryLimit: memoryLimit,
    diskLimit: 2 * 1024 * 1024, entryLimit: 4, telemetry: telemetry)
  let originalWriter = try await cache.makeWriter(expectedSize: UInt64(fixture.old.count))
  try await originalWriter.write(fixture.old, at: 0)
  let original = try await originalWriter.finish()
  let bundle = Data(repeating: 0xCC, count: 17) + fixture.patch + Data([0xFF])
  let patchWriter = try await cache.makeWriter(expectedSize: UInt64(bundle.count))
  try await patchWriter.write(bundle, at: 0)
  let patchBundle = try await patchWriter.finish()
  let patch = try patchBundle.slice(offset: 17, length: UInt64(fixture.patch.count))
  let targetURL = root.appendingPathComponent("target.bin")
  try fixture.old.write(to: targetURL)
  let temporary = root.appendingPathComponent("output.bin")
  let target = PlannedUpdateFile(
    fileURL: targetURL, size: UInt64(fixture.new.count), md5: md5Hex(fixture.new), installChunks: []
  )
  let worker = PatchApplyWorker(index: 0)
  try await worker.run(
    PatchApplyRequest(
      original: .cached(original), patch: .cached(patch), target: target, outputURL: temporary))
  #expect(try Data(contentsOf: temporary) == fixture.new)
  #expect(try Data(contentsOf: targetURL) == fixture.old)
  let cacheIO = telemetry.snapshot()
  let memoryWrites =
    (original.inMemory ? UInt64(fixture.old.count) : 0)
    + (patchBundle.inMemory ? UInt64(bundle.count) : 0)
  #expect(cacheIO.memoryCache.writtenBytes == memoryWrites)
  #expect(cacheIO.diskCache.writtenBytes == UInt64(fixture.old.count + bundle.count) - memoryWrites)
  #expect(original.inMemory ? cacheIO.memoryCache.readBytes > 0 : cacheIO.diskCache.readBytes > 0)

  let invalidTarget = PlannedUpdateFile(
    fileURL: targetURL, size: target.size, md5: String(repeating: "0", count: 32), installChunks: []
  )
  await #expect(throws: SophonClientError.self) {
    try await worker.run(
      PatchApplyRequest(
        original: .cached(original), patch: .cached(patch), target: invalidTarget,
        outputURL: temporary))
  }
  #expect(try Data(contentsOf: targetURL) == fixture.old)
}

@Test(arguments: [UInt64(0), UInt64(16)])
func testTransferCacheBudgets(memoryLimit: UInt64) async throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: root) }
  let lockURL = root.appendingPathComponent("contended.lock")
  let lock = try TransferFileLock(lockURL)
  for _ in 0..<3 {
    #expect(throws: TransferLockError.self) { _ = try TransferFileLock(lockURL) }
  }
  withExtendedLifetime(lock) {}
  let cache = try BinaryCache(
    directory: root, memoryLimit: memoryLimit, diskLimit: 16, entryLimit: 2)
  let first = try await cache.makeWriter(expectedSize: 16)
  let usage = await cache.usage
  #expect(usage.memory == memoryLimit)
  #expect(usage.disk == (memoryLimit == 0 ? 16 : 0))
  #expect(usage.entries == 1)
  await #expect(throws: BinaryCacheError.self) { _ = try await cache.makeWriter(expectedSize: 17) }
  // Full pools wait, and a cancelled waiter must not consume bytes or an entry.
  if memoryLimit == 0 {
    let waiting = Task { try await cache.makeWriter(expectedSize: 1) }
    try await Task.sleep(for: .milliseconds(20))
    waiting.cancel()
    await #expect(throws: CancellationError.self) { _ = try await waiting.value }
  } else {
    let second = try await cache.makeWriter(expectedSize: 16)
    let both = await cache.usage
    #expect(both.memory == 16 && both.disk == 16 && both.entries == 2)
    try await second.abort()
  }
  try await first.abort()
  for _ in 0..<100 {
    if await cache.usage.entries == 0 { break }
    try await Task.sleep(for: .milliseconds(1))
  }
  let released = await cache.usage
  #expect(released.memory == 0 && released.disk == 0 && released.entries == 0)

  // A downloaded body leaves room for its consumer, including while that input is active.
  let shared = try BinaryCache(
    directory: root.appendingPathComponent("shared"), memoryLimit: 16, diskLimit: 0, entryLimit: 3)
  let download = try await shared.makeWriter(
    expectedSize: 4, purpose: .download(memoryHeadroom: 8, diskHeadroom: 0))
  let input = try await shared.makeWriter(expectedSize: 8)
  let next = try await shared.makeWriter(
    expectedSize: 4, purpose: .download(memoryHeadroom: 8, diskHeadroom: 0))
  #expect(await shared.usage.memory == 16)
  try await download.abort()
  try await input.abort()
  try await next.abort()

  // Directory enumeration can return a relative URL for the same retained file.
  let retainedURL = root.appendingPathComponent("retained.partial")
  try Data(repeating: 0xA1, count: 16).write(to: retainedURL)
  let relativeURL = URL(
    fileURLWithPath: "retained.partial",
    relativeTo: URL(fileURLWithPath: root.path, isDirectory: true))
  #expect(relativeURL.path == retainedURL.path)
  let restored = try BinaryCache(
    directory: root, memoryLimit: 0, diskLimit: 16, entryLimit: 1)
  try await restored.restoreDiskFiles([relativeURL: 16])
  let reopening = Task {
    try await restored.makeWriter(expectedSize: 16, fileURL: retainedURL, forceDisk: true)
  }
  defer { reopening.cancel() }
  for _ in 0..<50 {
    if await restored.usage.entries == 1 { break }
    try await Task.sleep(for: .milliseconds(1))
  }
  let admitted = await restored.usage.entries == 1
  #expect(admitted)
  if admitted {
    let writer = try await reopening.value
    try writer.restoreRanges([0..<16])
    try (await writer.finish()).remove()
  } else {
    reopening.cancel()
    await #expect(throws: CancellationError.self) { _ = try await reopening.value }
  }
}

private final class TransferHTTPFixture: @unchecked Sendable {
  struct Reply {
    let data: Data
    let headers: [String: String]
    let status: Int
    let fail: Bool
    let holdResponse: Bool
  }

  let data: Data
  private let lock = NSLock()
  private var failurePrefix: Int?
  private let ignoreRanges: Bool
  private let invalidRange: Bool
  private let holdResponse: Bool
  private let observe: @Sendable () -> Bool
  private var requests: [String?] = []
  private var observations: [Bool] = []

  init(
    _ data: Data, failurePrefix: Int? = nil, ignoreRanges: Bool = false,
    invalidRange: Bool = false, holdResponse: Bool = false,
    observe: @escaping @Sendable () -> Bool = { true }
  ) {
    self.data = data
    self.failurePrefix = failurePrefix
    self.ignoreRanges = ignoreRanges
    self.invalidRange = invalidRange
    self.holdResponse = holdResponse
    self.observe = observe
  }

  var ranges: [String?] { lock.withLock { requests } }
  var observed: [Bool] { lock.withLock { observations } }

  func reply(_ request: URLRequest) -> Reply {
    lock.withLock {
      let range = request.value(forHTTPHeaderField: "Range")
      requests.append(range)
      observations.append(observe())
      let parts = range?.dropFirst(6).split(separator: "-")
      let start = !ignoreRanges ? parts.flatMap { Int($0[0]) } ?? 0 : 0
      let end = !ignoreRanges ? parts.flatMap { Int($0[1]) } ?? (data.count - 1) : data.count - 1
      let full = range == nil || ignoreRanges
      let bytes = data.subdata(in: start..<(end + 1))
      let headers =
        full
        ? ["Content-Length": String(data.count)]
        : [
          "Content-Length": String(bytes.count),
          "Content-Range": "bytes \(start)-\(end)/\(data.count + (invalidRange ? 1 : 0))",
        ]
      if let prefix = failurePrefix {
        failurePrefix = nil
        return Reply(
          data: Data(bytes.prefix(prefix)), headers: headers, status: full ? 200 : 206, fail: true,
          holdResponse: false)
      }
      return Reply(
        data: holdResponse ? Data(bytes.prefix(8192)) : bytes, headers: headers,
        status: full ? 200 : 206, fail: false, holdResponse: holdResponse)
    }
  }
}

private final class TransferURLProtocol: URLProtocol {
  private final class Registry: @unchecked Sendable {
    let lock = NSLock()
    var entries: [URL: TransferHTTPFixture] = [:]
  }
  private static let registry = Registry()

  static func register(_ fixture: TransferHTTPFixture, at url: URL) {
    registry.lock.withLock { registry.entries[url] = fixture }
  }

  static func remove(_ url: URL) {
    _ = registry.lock.withLock { registry.entries.removeValue(forKey: url) }
  }
  override class func canInit(with request: URLRequest) -> Bool {
    request.url?.host == "transfer.invalid"
  }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    guard let url = request.url,
      let fixture = Self.registry.lock.withLock({ Self.registry.entries[url] })
    else {
      client?.urlProtocol(self, didFailWithError: URLError(.resourceUnavailable))
      return
    }
    let reply = fixture.reply(request)
    let response = HTTPURLResponse(
      url: url, statusCode: reply.status, httpVersion: "HTTP/1.1", headerFields: reply.headers)!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: reply.data)
    if reply.holdResponse { return }
    if reply.fail {
      client?.urlProtocol(self, didFailWithError: URLError(.networkConnectionLost))
    } else {
      client?.urlProtocolDidFinishLoading(self)
    }
  }
  override func stopLoading() {}
}

private func transferTestCache(
  _ directory: URL, diskLimit: UInt64 = 16 * 1024 * 1024, cachedSource: DownloadCache? = nil
)
  -> DownloadCache
{
  let configuration = URLSessionConfiguration.ephemeral
  configuration.protocolClasses = [TransferURLProtocol.self]
  return DownloadCache(
    directory: directory, diskLimit: diskLimit, maxConcurrentDownloads: 1,
    maxRetries: 0, retryInterval: 0, cachedSource: cachedSource, configuration: configuration)
}

@Test(
  .timeLimit(.minutes(1)),
  arguments: [
    "resume", "ignored-ranges", "invalid-range", "capacity", "tampered", "shrink", "shared-budget",
    "prefetched", "cancelled",
  ])
func testTransferDownloadRecovery(scenario: String) async throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: root) }
  let bytes = Data(
    repeating: 0xA7, count: scenario == "ignored-ranges" ? 5 * 1024 * 1024 : 256 * 1024)
  let url = URL(string: "https://transfer.invalid/\(UUID().uuidString)")!
  let fixture = TransferHTTPFixture(
    bytes,
    ignoreRanges: scenario == "ignored-ranges", invalidRange: scenario == "invalid-range",
    holdResponse: scenario == "cancelled")
  TransferURLProtocol.register(fixture, at: url)
  defer { TransferURLProtocol.remove(url) }
  let request = DownloadRequest(
    chunkID: "test", url: url, md5: md5Hex(bytes), size: UInt64(bytes.count))

  if scenario == "resume" {
    // Darwin can discard buffered URLProtocol data when didFail follows didLoad synchronously.
    // Seed the persisted prefix to test restart independently of that delivery behavior.
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let key = transferKey("\(request.md5):\(request.size)")
    let partial = root.appendingPathComponent(key + ".partial")
    try Data(bytes.prefix(8192)).write(to: partial)
    let handle = try FileHandle(forUpdating: partial)
    try handle.truncate(atOffset: request.size)
    try handle.close()
    try Data("{\"range\":0,\"bytes\":8192}\n{\"range\":".utf8)
      .write(to: root.appendingPathComponent(key + ".jsonl"))
  }
  let source =
    scenario == "prefetched" ? transferTestCache(root.appendingPathComponent("source")) : nil
  if let source { try await source.get(request).release() }
  let cache = transferTestCache(
    root,
    diskLimit: scenario == "prefetched"
      ? 1 : scenario == "capacity" ? request.size : 16 * 1024 * 1024,
    cachedSource: source)
  if scenario == "cancelled" {
    let telemetry = TransferTelemetry(memoryLimit: 0, diskLimit: request.size)
    let waiting = Task { try await cache.get(request, telemetry: telemetry) }
    for _ in 0..<100 {
      if telemetry.snapshot().receivedBytes > 0 { break }
      try await Task.sleep(for: .milliseconds(1))
    }
    #expect(!fixture.ranges.isEmpty)
    waiting.cancel()
    await #expect(throws: CancellationError.self) { _ = try await waiting.value }
    return
  }
  if scenario == "invalid-range" {
    await #expect(throws: (any Error).self) { _ = try await cache.get(request) }
    #expect(
      try FileManager.default.contentsOfDirectory(atPath: root.path).allSatisfy {
        !$0.hasSuffix(".bin")
      })
    return
  }
  var downloaded: CachedDownload? = try await cache.get(request)
  #expect(try Data(contentsOf: #require(downloaded).fileURL) == bytes)
  let payloadURL = try #require(downloaded).fileURL
  let metadata = try transferFileMetadata(payloadURL.path)
  let attributes = try FileManager.default.attributesOfItem(atPath: payloadURL.path)
  let modified = try #require(attributes[.modificationDate] as? Date)
  #expect(metadata.size == request.size)
  #expect(abs(metadata.modified.timeIntervalSince(modified)) < 0.000001)
  if scenario == "resume" { #expect(fixture.ranges.contains("bytes=8192-\(bytes.count - 1)")) }
  if scenario == "ignored-ranges" { #expect(fixture.ranges.contains(nil)) }
  if scenario == "prefetched" {
    #expect(try await cache.contains(request))
    #expect(
      payloadURL.deletingLastPathComponent().path == root.appendingPathComponent("source").path)
    #expect(fixture.ranges.count == 1)
  }
  if scenario == "tampered" || scenario == "prefetched" {
    let path = try #require(downloaded).fileURL
    try downloaded?.release()
    downloaded = nil
    try Data(repeating: 0, count: bytes.count).write(to: path)
    async let first = cache.get(request)
    async let second = cache.get(request)
    let (verified, shared) = try await (first, second)
    #expect(try Data(contentsOf: verified.fileURL) == bytes)
    #expect(shared.fileURL == verified.fileURL)
    #expect(fixture.ranges.count == 2)
    try verified.release()
    try shared.release()
  }
  if scenario == "shared-budget" {
    try downloaded?.release()
    downloaded = nil
    let firstCache = transferTestCache(root, diskLimit: request.size * 2)
    try await firstCache.get(request).release()
    let secondURL = url.appendingPathComponent("second")
    let thirdURL = url.appendingPathComponent("third")
    let secondBytes = Data(repeating: 0xB8, count: bytes.count)
    let thirdBytes = Data(repeating: 0xC9, count: bytes.count)
    TransferURLProtocol.register(TransferHTTPFixture(secondBytes), at: secondURL)
    TransferURLProtocol.register(TransferHTTPFixture(thirdBytes), at: thirdURL)
    defer {
      TransferURLProtocol.remove(secondURL)
      TransferURLProtocol.remove(thirdURL)
    }
    let secondRequest = DownloadRequest(
      chunkID: "second", url: secondURL, md5: md5Hex(secondBytes), size: request.size)
    let thirdRequest = DownloadRequest(
      chunkID: "third", url: thirdURL, md5: md5Hex(thirdBytes), size: request.size)
    let secondCache = transferTestCache(root, diskLimit: request.size * 2)
    try await secondCache.get(secondRequest).release()
    let third = try await firstCache.get(thirdRequest)
    #expect(try Data(contentsOf: third.fileURL) == thirdBytes)
    var used: UInt64 = 0
    for name in try FileManager.default.contentsOfDirectory(atPath: root.path)
    where name.hasSuffix(".bin") || name.hasSuffix(".partial") {
      used += try transferFileMetadata(root.appendingPathComponent(name).path).size
    }
    #expect(used == request.size * 2)
  }
  if scenario == "shrink" {
    let nextURL = url.appendingPathComponent("second")
    let nextBytes = Data(repeating: 0xB8, count: bytes.count)
    let nextFixture = TransferHTTPFixture(nextBytes)
    TransferURLProtocol.register(nextFixture, at: nextURL)
    defer { TransferURLProtocol.remove(nextURL) }
    let nextRequest = DownloadRequest(
      chunkID: "second", url: nextURL, md5: md5Hex(nextBytes), size: request.size)
    try downloaded?.release()
    downloaded = nil
    do {
      let next = try await cache.get(nextRequest)
      #expect(try Data(contentsOf: next.fileURL) == nextBytes)
      try next.release()
    }
    let smaller = transferTestCache(root, diskLimit: request.size)
    let next = try await smaller.get(nextRequest)
    #expect(try Data(contentsOf: next.fileURL) == nextBytes)
    let cached = try FileManager.default.contentsOfDirectory(atPath: root.path)
      .filter { $0.hasSuffix(".bin") || $0.hasSuffix(".partial") }
    #expect(cached.count == 1)
  }
  if scenario == "capacity" {
    let nextURL = url.appendingPathComponent("second")
    let nextBytes = Data(repeating: 0xB8, count: bytes.count)
    let nextFixture = TransferHTTPFixture(nextBytes)
    TransferURLProtocol.register(nextFixture, at: nextURL)
    defer { TransferURLProtocol.remove(nextURL) }
    let nextRequest = DownloadRequest(
      chunkID: "second", url: nextURL, md5: md5Hex(nextBytes), size: request.size)
    let waiting = Task { try await cache.get(nextRequest) }
    try await Task.sleep(for: .milliseconds(30))
    #expect(nextFixture.ranges.isEmpty)
    waiting.cancel()
    await #expect(throws: CancellationError.self) { _ = try await waiting.value }
    try downloaded?.release()
    downloaded = nil
    let next = try await cache.get(nextRequest)
    #expect(try Data(contentsOf: next.fileURL) == nextBytes)
  }
}

private func transferTestPlan(
  root: URL, fixture: HDiffFixture, bundleID: String = "bundle"
) throws -> UpdatePlan {
  let targetURL = root.appendingPathComponent("target.bin")
  let info = try JSONDecoder().decode(
    SophonDownloadInfo.self,
    from: JSONSerialization.data(withJSONObject: [
      "encryption": 0, "compression": 0, "password": "",
      "url_prefix": "https://transfer.invalid/\(root.lastPathComponent)", "url_suffix": "",
    ]))
  let chunk = RequiredChunk(
    chunkID: "install", uncompressedMd5: md5Hex(fixture.new), compressedMd5: md5Hex(fixture.new),
    compressedSize: UInt64(fixture.new.count), uncompressedSize: UInt64(fixture.new.count),
    downloadInfo: info,
    chunkApplicationInfos: [ChunkApplicationInfo(fileURL: targetURL, offset: 0)])
  let target = PlannedUpdateFile(
    fileURL: targetURL, size: UInt64(fixture.new.count), md5: md5Hex(fixture.new),
    installChunks: [chunk])
  let patch = PlannedPatch(
    patchOffset: 0, patchLength: UInt64(fixture.patch.count),
    original: PlannedPatchSource(
      fileURL: targetURL, size: UInt64(fixture.old.count), md5: md5Hex(fixture.old)), target: target
  )
  return UpdatePlan(
    sourceVersion: "old", targetVersion: "new",
    patchBundles: [
      PlannedPatchBundle(
        patchID: bundleID, patchSize: UInt64(fixture.patch.count), patchHash: md5Hex(fixture.patch),
        downloadInfo: info, patches: [patch])
    ],
    installFiles: [target],
    deleteFiles: [PlannedDeleteFile(fileURL: root.appendingPathComponent("obsolete"), size: 4)])
}

@Test(
  .timeLimit(.minutes(1)),
  arguments: ["ram", "spill", "resume-ram", "resume-spill", "no-spill", "bad-prefetch"])
func testTransferWorkingCache(scenario: String) async throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: root) }
  let bytes = Data(repeating: 0xB7, count: 256 * 1024)
  let url = URL(string: "https://transfer.invalid/\(root.lastPathComponent)")!
  let fixture = TransferHTTPFixture(bytes)
  TransferURLProtocol.register(fixture, at: url)
  defer { TransferURLProtocol.remove(url) }
  let request = DownloadRequest(
    chunkID: "body", url: url, md5: md5Hex(bytes), size: UInt64(bytes.count))
  var settings = TransferSettings()
  settings.cacheDirectory = root.appendingPathComponent("cache").path
  settings.memoryLimit = scenario == "spill" || scenario == "resume-spill" ? 0 : request.size * 2
  settings.diskLimit = request.size
  settings.diskCacheEnabled = scenario != "no-spill"
  let working = settings.cacheURL.appendingPathComponent("working/\(transferKey(root.path))/update")
  let downloads = working.appendingPathComponent("downloads")
  let key = transferKey("\(request.md5):\(request.size)")
  if scenario.hasPrefix("resume") {
    try FileManager.default.createDirectory(at: downloads, withIntermediateDirectories: true)
    try Data(bytes.prefix(8192)).write(to: downloads.appendingPathComponent(key + ".partial"))
    try Data("{\"range\":0,\"bytes\":8192}\n".utf8)
      .write(to: downloads.appendingPathComponent(key + ".jsonl"))
  }
  let prefetch =
    scenario == "bad-prefetch" ? transferTestCache(root.appendingPathComponent("prefetch")) : nil
  if let prefetch {
    let cached = try await prefetch.get(request)
    try Data(repeating: 0, count: bytes.count).write(to: cached.fileURL)
    try cached.release()
  }
  let transport = transferTestCache(downloads, cachedSource: prefetch)
  let workspace = try await TransferWorkspace(
    settings: settings, gameDirectory: root, operation: "update", transport: transport)
  do {
    let binary = try await workspace.download(request)
    #expect(try binary.data() == bytes)
    #expect(binary.inMemory == (settings.memoryLimit > 0))
    let progress = workspace.telemetry.snapshot()
    #expect(progress.memoryBytes <= settings.memoryLimit)
    #expect(progress.devices.reduce(UInt64(0)) { $0 + $1.reservedCacheBytes } <= settings.diskLimit)
    #expect(progress.receivedBytes == request.size)
    #expect(progress.retainedBytes == (scenario.hasPrefix("resume") ? 8192 : 0))
    #expect(progress.transferredBytes == request.size - progress.retainedBytes)
    #expect(progress.devices.count == 1)
    #expect(progress.devices.first?.roles.contains("Target") == true)
    #expect(progress.devices.first?.roles.contains("Cache") == true)
    if scenario.hasPrefix("resume") {
      #expect(fixture.ranges.contains("bytes=8192-\(bytes.count - 1)"))
    }
    if scenario == "ram" || scenario == "no-spill" {
      #expect(!FileManager.default.fileExists(atPath: working.path))
      #expect(progress.devices.allSatisfy { $0.writtenBytes == 0 && $0.cacheBytes == 0 })
    }
    try await workspace.consumed(binary, request: request)
    for _ in 0..<50 {
      if await workspace.cache.usage.entries == 0 { break }
      try await Task.sleep(for: .milliseconds(1))
    }
    #expect(await workspace.cache.usage.entries == 0)
    // Consumption must free capacity even if an async frame still retains the finished value.
    withExtendedLifetime(binary) {}
    #expect(
      !FileManager.default.fileExists(
        atPath: downloads.appendingPathComponent(key + ".partial").path))
    #expect(
      !FileManager.default.fileExists(atPath: downloads.appendingPathComponent(key + ".jsonl").path)
    )
  }
  try await workspace.finish(completed: true)
  #expect(!FileManager.default.fileExists(atPath: working.path))
  let final = workspace.telemetry.snapshot()
  #expect(final.memoryBytes == 0)
  #expect(final.devices.allSatisfy { $0.cacheBytes == 0 && $0.reservedCacheBytes == 0 })
  if scenario == "no-spill" {
    await #expect(throws: BinaryCacheError.self) {
      _ = try await workspace.cache.makeWriter(expectedSize: settings.memoryLimit + 1)
    }
  }
}

@Test(arguments: [UpdateWriteMode.temporaryReplacement, .inPlace], [false, true])
func testTransferPredownloadAndRepair(writeMode: UpdateWriteMode, rawPayload: Bool) async throws {
  let hdiff = try loadHDiffFixture()
  let new = rawPayload ? Data(repeating: 0x5A, count: 2 * 1024 * 1024 + 17) : hdiff.new
  let fixture = HDiffFixture(
    old: hdiff.old, new: new, patch: rawPayload ? new : hdiff.patch)
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: root) }
  var settings = try JSONDecoder().decode(TransferSettings.self, from: Data("{}".utf8))
  #expect(settings.ioPolicy == .parallel)
  #expect(
    try JSONDecoder().decode(
      TransferSettings.self, from: Data("{\"ioPolicy\":\"serialized\"}".utf8)
    ).ioPolicy == .serialized)
  #expect(settings.memoryLimit == 1024 * 1024 * 1024)
  settings.cacheDirectory = root.appendingPathComponent("cache").path
  settings.memoryLimit = 0
  settings.writeMode = writeMode
  if writeMode == .inPlace {
    settings.predownloadDirectory = root.appendingPathComponent("prefetch").path
  }
  var cacheSettings = settings
  cacheSettings.diskLimit = 1
  let plan = try transferTestPlan(root: root, fixture: fixture)
  let target = try #require(plan.installFiles.first)
  let deletion = try #require(plan.deleteFiles.first)
  try Data("gone".utf8).write(to: deletion.fileURL)
  let bundleURL = try #require(plan.patchBundles.first).downloadRequest().url
  let installURL = try #require(target.installChunks.first).getDownloadURL()
  let bundleFixture = TransferHTTPFixture(fixture.patch)
  let installFixture = TransferHTTPFixture(
    fixture.new, observe: { FileManager.default.fileExists(atPath: deletion.fileURL.path) })
  TransferURLProtocol.register(bundleFixture, at: bundleURL)
  TransferURLProtocol.register(installFixture, at: installURL)
  defer {
    TransferURLProtocol.remove(bundleURL)
    TransferURLProtocol.remove(installURL)
  }
  let predownload = transferTestCache(
    settings.predownloadURL(gameDirectory: root), diskLimit: UInt64(Int64.max))
  let cache = transferTestCache(
    settings.cacheURL.appendingPathComponent("downloads"), cachedSource: predownload)
  let updater = try Updater(baseGameDir: root, maxCocurrentDownloads: 2, maxCocurrentWrites: 2)
  let installer = try Installer(
    baseGameDir: root, maxCocurrentChecks: 1, maxCocurrentDownloads: 2,
    maxCocurrentPostProcessors: 2,
    maxCocurrentWrites: 2, downloadCache: cache)
  try await updater.execute(
    plan, settings: cacheSettings, downloadCache: predownload, installer: installer,
    reporter: UpdateReporter(logger: .init(label: "test")), cacheOnly: true,
    finalize: {
      throw SophonClientError.UnknownError("Download-only runs must not finalize game files")
    })
  #expect(!FileManager.default.fileExists(atPath: target.fileURL.path))
  #expect(FileManager.default.fileExists(atPath: deletion.fileURL.path))
  #expect(bundleFixture.ranges.count == 1)
  #expect(installFixture.ranges.isEmpty)
  #expect(
    !FileManager.default.fileExists(
      atPath: settings.cacheURL.appendingPathComponent("downloads").path))
  #expect(try await cache.contains(try #require(plan.patchBundles.first).downloadRequest()))
  let cachedState = try #require(
    try await SophonClientv3.savedUpdateState(at: root, settings: settings))
  #expect(cachedState.predownloadDirectory == settings.predownloadURL(gameDirectory: root).path)
  try fixture.old.write(to: target.fileURL)
  let patched = UpdateReporter(logger: .init(label: "test"))
  try await updater.execute(
    plan, settings: settings, downloadCache: cache, installer: installer, reporter: patched)
  #expect(try Data(contentsOf: target.fileURL) == fixture.new)
  #expect(bundleFixture.ranges.count == 1)
  #expect(installFixture.ranges.isEmpty)
  #expect(!FileManager.default.fileExists(atPath: deletion.fileURL.path))
  #expect(try await SophonClientv3.savedUpdateState(at: root, settings: settings)?.finished == true)
  let appliedProgress = await patched.snapshot()
  #expect(appliedProgress.metrics.common.write.completed == UInt64(fixture.new.count))
  #expect(appliedProgress.metrics.deletion.files.total == 1)
  #expect(appliedProgress.metrics.deletion.files.completed == 1)
  #expect(appliedProgress.metrics.deletion.bytes.total == 4)
  #expect(appliedProgress.metrics.deletion.bytes.completed == 4)

  // Only the updated target falls back to installation when its source is broken.
  try Data(repeating: 0x00, count: fixture.old.count).write(to: target.fileURL)
  try Data("gone".utf8).write(to: deletion.fileURL)
  let cachedRepair = UpdateReporter(logger: .init(label: "test"))
  try await updater.execute(
    plan, settings: cacheSettings, downloadCache: predownload, installer: installer,
    reporter: cachedRepair,
    cacheOnly: true)
  #expect(try Data(contentsOf: target.fileURL) == Data(repeating: 0x00, count: fixture.old.count))
  #expect(FileManager.default.fileExists(atPath: deletion.fileURL.path))
  let cacheState = try #require(
    try await SophonClientv3.savedUpdateState(at: root, settings: settings))
  #expect(cacheState.cacheOnly)
  #expect(cacheState.files[target.fileURL.path] == .cachedPatch)
  #expect(installFixture.ranges.isEmpty)
  let repaired = UpdateReporter(logger: .init(label: "test"))
  try await updater.execute(
    plan, settings: settings, downloadCache: cache, installer: installer, reporter: repaired)
  #expect(try Data(contentsOf: target.fileURL) == fixture.new)
  #expect(await repaired.snapshot().metrics.repair.files == (rawPayload ? 0 : 1))
  let repairProgress = await repaired.snapshot()
  #expect(
    repairProgress.metrics.repair.download.completed == (rawPayload ? 0 : UInt64(fixture.new.count))
  )
  #expect(
    repairProgress.metrics.repair.write.completed == (rawPayload ? 0 : UInt64(fixture.new.count)))
  #expect(
    repairProgress.metrics.repair.download.total
      == (rawPayload ? nil : repairProgress.metrics.repair.download.completed)
  )
  #expect(
    repairProgress.metrics.repair.write.total
      == (rawPayload ? nil : repairProgress.metrics.repair.write.completed))
  #expect(installFixture.observed == (rawPayload ? [] : [true]))
  #expect(!FileManager.default.fileExists(atPath: deletion.fileURL.path))

  let skipped = UpdateReporter(logger: .init(label: "test"))
  try await updater.execute(
    plan, settings: settings, downloadCache: cache, installer: installer, reporter: skipped)
  #expect(await skipped.snapshot().metrics.skippedFiles == 1)
  #expect(bundleFixture.ranges.count == 1)
}

@Test(arguments: ["ram", "spill", "mixed", "all-current", "finalization-failed"])
func testTransferLiveUpdate(scenario: String) async throws {
  let fixture = try loadHDiffFixture()
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: root) }
  var settings = TransferSettings()
  settings.cacheDirectory = root.appendingPathComponent("cache").path
  settings.memoryLimit = scenario == "spill" ? 0 : 1024 * 1024
  settings.diskLimit = 1024 * 1024
  settings.diskCacheEnabled = scenario == "spill"
  settings.preserveState = scenario == "finalization-failed"
  var plan = try transferTestPlan(root: root, fixture: fixture)
  var bundleBytes = fixture.patch
  let first = try #require(plan.installFiles.first)
  try (scenario == "mixed" || scenario == "all-current" ? fixture.new : fixture.old)
    .write(to: first.fileURL)
  if scenario == "mixed" {
    let secondURL = root.appendingPathComponent("second.bin")
    try fixture.old.write(to: secondURL)
    let second = PlannedUpdateFile(
      fileURL: secondURL, size: first.size, md5: first.md5, installChunks: [])
    let bundle = try #require(plan.patchBundles.first)
    let patch = PlannedPatch(
      patchOffset: UInt64(fixture.patch.count), patchLength: UInt64(fixture.patch.count),
      original: PlannedPatchSource(
        fileURL: secondURL, size: UInt64(fixture.old.count), md5: md5Hex(fixture.old)),
      target: second)
    bundleBytes += fixture.patch
    plan = UpdatePlan(
      sourceVersion: plan.sourceVersion, targetVersion: plan.targetVersion,
      patchBundles: [
        PlannedPatchBundle(
          patchID: bundle.patchID, patchSize: UInt64(bundleBytes.count),
          patchHash: md5Hex(bundleBytes), downloadInfo: bundle.downloadInfo,
          patches: bundle.patches + [patch])
      ],
      installFiles: [first, second], deleteFiles: plan.deleteFiles)
  }
  let bundle = try #require(plan.patchBundles.first)
  let url = try bundle.downloadRequest().url
  let network = TransferHTTPFixture(bundleBytes)
  TransferURLProtocol.register(network, at: url)
  defer { TransferURLProtocol.remove(url) }
  let cache = transferTestCache(settings.cacheURL.appendingPathComponent("downloads"))
  let updater = try Updater(baseGameDir: root, maxCocurrentDownloads: 2, maxCocurrentWrites: 2)
  let installer = try Installer(
    baseGameDir: root, maxCocurrentChecks: 1, maxCocurrentDownloads: 2,
    maxCocurrentPostProcessors: 2, maxCocurrentWrites: 2, downloadCache: cache)
  let reporter = UpdateReporter(logger: .init(label: "test"))
  if scenario == "finalization-failed" {
    let failed = UpdateReporter(logger: .init(label: "test"))
    await #expect(throws: SophonClientError.self) {
      try await updater.execute(
        plan, settings: settings, downloadCache: cache, installer: installer, reporter: failed,
        finalize: { throw SophonClientError.UnknownError("Cannot write game configuration") })
    }
    #expect(
      try await SophonClientv3.savedUpdateState(at: root, settings: settings)?.finished == false)
    #expect(try Data(contentsOf: first.fileURL) == fixture.new)
    if case .failed? = await failed.snapshot().outcome {
    } else {
      Issue.record("Configuration failure was reported as a completed update")
    }
  }
  try await updater.execute(
    plan, settings: settings, downloadCache: cache, installer: installer, reporter: reporter)
  let progress = await reporter.snapshot()
  #expect(progress.metrics.common.files.completed == UInt64(plan.installFiles.count))
  #expect(progress.metrics.repair.files == 0)
  #expect(
    progress.metrics.skippedFiles
      == (scenario == "mixed" || scenario == "all-current" || scenario == "finalization-failed"
        ? 1 : 0))
  #expect(network.ranges.count == (scenario == "all-current" ? 0 : 1))
  #expect(
    progress.metrics.patch.data.total
      == (scenario == "all-current" || scenario == "finalization-failed"
        ? 0 : UInt64(bundleBytes.count)))
  #expect(progress.metrics.patch.data.remaining == 0)
  #expect(progress.metrics.common.resources?.memoryBytes == 0)
  #expect(
    progress.metrics.common.resources?.devices.allSatisfy {
      $0.cacheBytes == 0 && $0.reservedCacheBytes == 0
    }
      == true)
  #expect(
    !FileManager.default.fileExists(
      atPath: settings.cacheURL.appendingPathComponent("working/\(transferKey(root.path))/update")
        .path))
  for target in plan.installFiles { #expect(try Data(contentsOf: target.fileURL) == fixture.new) }
  if scenario == "ram" {
    let device = try #require(progress.metrics.common.resources?.devices.first)
    #expect(device.read.completed == UInt64(fixture.old.count))
    #expect(device.write.completed == UInt64(fixture.new.count))
  }
}

@Test(arguments: ["in-place", "old-renamed", "new-ready", "committed", "checkpointed", "stateless"])
func testTransferInterruptedUpdate(scenario: String) async throws {
  let fixture = try loadHDiffFixture()
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: root) }
  var settings = TransferSettings()
  settings.cacheDirectory = root.appendingPathComponent("cache").path
  settings.writeMode = scenario == "in-place" ? .inPlace : .temporaryReplacement
  settings.preserveState = scenario != "stateless"
  let plan = try transferTestPlan(root: root, fixture: fixture)
  let patch = try #require(plan.patchBundles.first?.patches.first)
  let source = try #require(patch.original)
  let stateDirectory = UpdateJournal.directory(settings: settings, gameDirectory: root)
  do {
    let journal = try UpdateJournal(directory: stateDirectory, plan: plan)
    try journal.record(
      patch.target.fileURL, stage: scenario == "checkpointed" ? .completed : .writing)
  }
  let events = try FileHandle(forWritingTo: stateDirectory.appendingPathComponent("events.jsonl"))
  try events.seekToEnd()
  try events.write(contentsOf: Data("{\"path\":".utf8))
  try events.close()
  let key = transferKey(patch.target.fileURL.path + patch.target.md5).prefix(32)
  let temporary = root.appendingPathComponent(".sophon-\(key).new")
  let backup = root.appendingPathComponent(".sophon-\(key).old")
  let bundleURL = try #require(plan.patchBundles.first).downloadRequest().url
  let bundleFixture = TransferHTTPFixture(fixture.patch)
  TransferURLProtocol.register(bundleFixture, at: bundleURL)
  defer { TransferURLProtocol.remove(bundleURL) }
  let cache = transferTestCache(settings.cacheURL.appendingPathComponent("downloads"))
  if scenario == "in-place" {
    let original = stateDirectory.appendingPathComponent("originals")
      .appendingPathComponent(
        transferKey("\(source.fileURL.path):\(source.size):\(source.md5)") + ".original")
    try FileManager.default.createDirectory(
      at: original.deletingLastPathComponent(), withIntermediateDirectories: true)
    try fixture.old.write(to: original)
    try Data(repeating: 0xE1, count: fixture.new.count / 2).write(to: patch.target.fileURL)
    try await cache.get(#require(plan.patchBundles.first).downloadRequest()).release()
  } else if scenario == "old-renamed" {
    try fixture.old.write(to: backup)
    try fixture.new.write(to: temporary)
  } else if scenario == "new-ready" {
    try fixture.old.write(to: patch.target.fileURL)
    try fixture.new.write(to: temporary)
  } else if scenario == "checkpointed" {
    // Completion receipts are authoritative; detecting external changes is a separate verification run.
    try Data(repeating: 0xF2, count: fixture.new.count).write(to: patch.target.fileURL)
  } else {
    try fixture.new.write(to: patch.target.fileURL)
    try fixture.old.write(to: backup)
  }
  let updater = try Updater(baseGameDir: root, maxCocurrentDownloads: 1, maxCocurrentWrites: 1)
  let installer = try Installer(
    baseGameDir: root, maxCocurrentChecks: 1, maxCocurrentDownloads: 1,
    maxCocurrentPostProcessors: 1,
    maxCocurrentWrites: 1, downloadCache: cache)
  try await updater.execute(
    plan, settings: settings, downloadCache: cache, installer: installer,
    reporter: UpdateReporter(logger: .init(label: "test")))
  let expected =
    scenario == "checkpointed" ? Data(repeating: 0xF2, count: fixture.new.count) : fixture.new
  #expect(try Data(contentsOf: patch.target.fileURL) == expected)
  #expect(!FileManager.default.fileExists(atPath: backup.path))
  #expect(!FileManager.default.fileExists(atPath: temporary.path))
  #expect(bundleFixture.ranges.count == (scenario == "in-place" ? 1 : 0))
  let finished = try await SophonClientv3.savedUpdateState(at: root, settings: settings)
  if scenario == "stateless" {
    #expect(finished == nil)
  } else {
    #expect(finished?.finished == true)
  }
}

@Test
func testTransferInstallationCheckpoints() async throws {
  let bytes = Data("verified chunk".utf8)
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: root) }
  let source = HDiffFixture(old: Data(), new: bytes, patch: bytes)
  let update = try transferTestPlan(root: root, fixture: source)
  var chunk = try #require(update.installFiles.first?.installChunks.first)
  let first = try #require(chunk.chunkApplicationInfos.first)
  let second = ChunkApplicationInfo(fileURL: first.fileURL, offset: UInt64(bytes.count))
  chunk.chunkApplicationInfos = [first, second]
  let file = PlannedFile(
    fileURL: first.fileURL, size: UInt64(bytes.count * 2), md5: md5Hex(bytes + bytes),
    requiredChunkCount: 2, needsTrimming: false)
  let plan = InstallationPlan(
    totalChunkCount: 1, downloadSize: UInt64(bytes.count), diskWriteSize: file.size,
    requiredChunks: [chunk], plannedFiles: [file])
  var settings = TransferSettings()
  settings.cacheDirectory = root.appendingPathComponent("cache").path
  let directory = InstallationJournal.directory(settings: settings, gameDirectory: root)
  let initial = SavedInstallationState(
    gameID: "fixture", version: "1", mode: .full, voicePacks: [], predownload: false,
    plan: plan, completedApplications: [], trimmedFiles: [], finished: false)
  try bytes.write(to: first.fileURL)
  do {
    let journal = try InstallationJournal(directory: directory, state: initial)
    try journal.written(chunkID: chunk.chunkID, application: first)
  }
  let events = try FileHandle(forWritingTo: directory.appendingPathComponent("events.jsonl"))
  try events.seekToEnd()
  try events.write(contentsOf: Data("{\"application\":".utf8))
  try events.close()
  let saved = try #require(
    try await SophonClientv3.savedInstallationState(at: root, settings: settings))
  let remaining = saved.remainingPlan()
  #expect(remaining.requiredChunks.first?.chunkApplicationInfos.map(\.offset) == [second.offset])
  #expect(remaining.diskWriteSize == UInt64(bytes.count))
  let url = try chunk.getDownloadURL()
  let fixture = TransferHTTPFixture(bytes)
  TransferURLProtocol.register(fixture, at: url)
  defer { TransferURLProtocol.remove(url) }
  let cache = transferTestCache(settings.cacheURL.appendingPathComponent("downloads"))
  let installer = try Installer(
    baseGameDir: root, maxCocurrentChecks: 1, maxCocurrentDownloads: 1,
    maxCocurrentPostProcessors: 1,
    maxCocurrentWrites: 1, downloadCache: cache)
  let journal = try InstallationJournal(directory: directory, state: saved, resume: true)
  let reporter = InstallationReporter(logger: .init(label: "test"))
  try await installer.install(remaining, reporter: reporter, journal: journal)
  try journal.complete()
  #expect(try Data(contentsOf: first.fileURL) == bytes + bytes)
  #expect(await reporter.snapshot().metrics.verification.files.completed == 0)
  #expect(await reporter.snapshot().metrics.common.write.completed == UInt64(bytes.count))
  let completed = try #require(
    try await SophonClientv3.savedInstallationState(at: root, settings: settings))
  #expect(completed.remainingPlan().requiredChunks.isEmpty)
  #expect(completed.finished)
}

@Test
func testTransferResourceBlacklist() async throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: root) }
  let blacklist = root.appendingPathComponent("StarRail_Data/Persistent/DownloadBlacklist.json")
  try FileManager.default.createDirectory(
    at: blacklist.deletingLastPathComponent(), withIntermediateDirectories: true)
  var config = try JSONDecoder().decode(
    GameLaunchConfig.self,
    from: Data(
      #"""
      {
        "game": {"id": "fixture", "biz": "hkrpg_global"},
        "installation_dir": "Game", "exe_file_name": "StarRail.exe",
        "audio_pkg_scan_dir": "", "res_category_dir": "",
        "wpf_exe_dir": "", "wpf_pkg_version_dir": "",
        "enable_ldiff": true, "enable_scenario_pkg": false,
        "enable_write_verify_result": false, "write_verify_result_path": "",
        "enable_resource_blacklist": true,
        "blacklist_dir": "StarRail_Data\\Persistent\\DownloadBlacklist.json"
      }
      """#.utf8))
  #expect(try readDownloadBlacklist(config, baseGameDir: root).isEmpty)
  let records = #"""
    {"fileName":"STARRAIL_DATA\\Persistent\\Asb\\Windows\\deleted.block","md5":"unused"}

    {"fileName":"StarRail_Data/StreamingAssets/Asb/Windows/deleted.block"}
    {"fileName":"obsolete"}
    {"metadata":"ignored"}
    """#
  try records.write(to: blacklist, atomically: true, encoding: .utf8)
  let ignoredFiles = try readDownloadBlacklist(config, baseGameDir: root)
  let filenames = [
    "StarRail_Data/StreamingAssets/Asb/Windows/deleted.block",
    "StarRail_Data/StreamingAssets/Asb/Windows/deleted.block.extra",
    "StarRail_Data/Persistent/Asb/Windows/deleted.block",
  ]
  #expect(ignoredFiles.count == 3)
  #expect(ignoredFiles.contains(ignoredFileKey(root.appendingPathComponent(filenames[0]))))
  #expect(ignoredFiles.contains(ignoredFileKey(root.appendingPathComponent(filenames[2]))))
  #expect(!ignoredFiles.contains(ignoredFileKey(root.appendingPathComponent(filenames[1]))))
  config.enableResourceBlacklist = false
  try "invalid JSON".write(to: blacklist, atomically: true, encoding: .utf8)
  #expect(try readDownloadBlacklist(config, baseGameDir: root).isEmpty)
  config.enableResourceBlacklist = true
  #expect(throws: SophonClientError.self) {
    try readDownloadBlacklist(config, baseGameDir: root)
  }
  try records.write(to: blacklist, atomically: true, encoding: .utf8)

  let bytes = Data("resource".utf8)
  let template = try transferTestPlan(
    root: root, fixture: HDiffFixture(old: bytes, new: bytes, patch: bytes))
  let downloadInfo = try #require(template.installFiles.first?.installChunks.first?.downloadInfo)
  var chunk = ChunkInfo()
  chunk.chunkID = "install"
  chunk.md5 = md5Hex(bytes)
  chunk.compressedMd5 = chunk.md5
  chunk.compressedSize = UInt32(bytes.count)
  chunk.uncompressedSize = UInt32(bytes.count)
  var manifest = Manifest()
  var diff = DiffManifest()
  for (index, filename) in filenames.enumerated() {
    var file = FileInfo()
    file.filename = filename
    file.flags = Int32(FILE_FLAG_FILE)
    file.size = Int32(bytes.count)
    file.md5 = chunk.md5
    file.chunks = [chunk]
    manifest.files.append(file)

    var patch = Patch()
    patch.key = "old"
    patch.info.patchID = index == 2 ? "ignored-bundle" : "shared-bundle"
    patch.info.patchSize = Int64(bytes.count * (index == 2 ? 1 : 2))
    patch.info.patchName = md5Hex(index == 2 ? bytes : bytes + bytes)
    patch.info.patchOffset = Int64(index == 1 ? bytes.count : 0)
    patch.info.patchLength = Int64(bytes.count)
    var target = DiffFileInfo()
    target.filename = filename
    target.size = file.size
    target.hash = file.md5
    target.patches = [patch]
    diff.files.append(target)
  }
  var deletion = DeleteFile()
  deletion.key = "old"
  for filename in ["obsolete", "obsolete-other"] {
    var file = DeleteFileInfo()
    file.filename = filename
    file.size = 4
    deletion.info.list.append(file)
  }
  diff.filesDelete = [deletion]
  let ignoredURL = root.appendingPathComponent(filenames[0])
  let retainedURL = root.appendingPathComponent(filenames[1])
  try FileManager.default.createDirectory(
    at: ignoredURL.deletingLastPathComponent(), withIntermediateDirectories: true)
  let untouched = Data("untouched ignored bytes".utf8)
  try untouched.write(to: ignoredURL)
  try untouched.write(to: root.appendingPathComponent("obsolete"))
  try Data("gone".utf8).write(to: root.appendingPathComponent("obsolete-other"))
  var settings = TransferSettings()
  settings.cacheDirectory = root.appendingPathComponent("cache").path
  let cache = transferTestCache(settings.cacheURL.appendingPathComponent("downloads"))
  let installer = try Installer(
    baseGameDir: root, maxCocurrentChecks: 2, maxCocurrentDownloads: 1,
    maxCocurrentPostProcessors: 1, maxCocurrentWrites: 1, downloadCache: cache)
  let installInfos = [(manifest: manifest, chunkDownloadInfo: downloadInfo)]
  let unfiltered = try await installer.scan(installInfos: installInfos)
  let reporter = InstallationReporter(logger: .init(label: "test"))
  let installPlan = try await installer.scan(
    installInfos: installInfos, ignoredFiles: ignoredFiles, reporter: reporter)
  #expect(installPlan.plannedFiles.map(\.fileURL) == [retainedURL])
  #expect(installPlan.requiredChunks.first?.chunkApplicationInfos.map(\.fileURL) == [retainedURL])
  #expect(installPlan.downloadSize == UInt64(bytes.count))
  #expect(installPlan.diskWriteSize == UInt64(bytes.count))
  let progress = await reporter.snapshot()
  #expect(progress.metrics.verification.files.total == 1)
  #expect(progress.metrics.common.read.completed == 0)
  let retainedApplication = try #require(
    unfiltered.requiredChunks.first?.chunkApplicationInfos.first { $0.fileURL == retainedURL })
  let saved = SavedInstallationState(
    gameID: "fixture", version: "new", mode: .full, voicePacks: [], predownload: false,
    plan: unfiltered,
    completedApplications: [
      InstallationJournal.key(chunkID: chunk.chunkID, application: retainedApplication)
    ],
    trimmedFiles: [], finished: false)
  let remaining = excludingIgnoredFiles(from: saved.remainingPlan(), ignoredFiles: ignoredFiles)
  #expect(remaining.requiredChunks.isEmpty && remaining.plannedFiles.isEmpty)
  #expect(remaining.downloadSize == 0 && remaining.diskWriteSize == 0)

  let updater = try Updater(baseGameDir: root, maxCocurrentDownloads: 1, maxCocurrentWrites: 1)
  let updateInfos = [(manifest: diff, diffDownloadInfo: downloadInfo)]
  let fullPlan = try updater.makePlan(
    sourceVersion: "old", targetVersion: "new", installInfos: installInfos, updateInfos: updateInfos
  )
  let updatePlan = try updater.makePlan(
    sourceVersion: "old", targetVersion: "new", installInfos: installInfos,
    updateInfos: updateInfos,
    ignoredFiles: ignoredFiles)
  #expect(updatePlan.installFiles.map(\.fileURL) == [retainedURL])
  #expect(updatePlan.patchBundles.map(\.patchID) == ["shared-bundle"])
  let bundle = try #require(updatePlan.patchBundles.first)
  #expect(bundle.patches.count == 1 && bundle.patches.first?.patchOffset == UInt64(bytes.count))
  #expect(bundle.patchSize == UInt64(bytes.count * 2) && bundle.patchHash == md5Hex(bytes + bytes))
  #expect(updatePlan.deleteFiles.map(\.fileURL) == [root.appendingPathComponent("obsolete-other")])
  #expect(updatePlan.installSize == UInt64(bytes.count) && updatePlan.deleteSize == 4)

  let chunkFixture = TransferHTTPFixture(bytes)
  let chunkURL = try #require(template.installFiles.first?.installChunks.first).getDownloadURL()
  TransferURLProtocol.register(chunkFixture, at: chunkURL)
  defer { TransferURLProtocol.remove(chunkURL) }
  try bytes.write(to: retainedURL)
  do {
    let journal = try UpdateJournal(
      directory: UpdateJournal.directory(settings: settings, gameDirectory: root), plan: fullPlan)
    try journal.record(ignoredURL, stage: .repair)
    try journal.record(root.appendingPathComponent(filenames[2]), stage: .cachedRepair)
    try journal.record(retainedURL, stage: .completed)
  }
  let updateReporter = UpdateReporter(logger: .init(label: "test"))
  try await updater.execute(
    updatePlan, settings: settings, downloadCache: cache, installer: installer,
    reporter: updateReporter, ignoredFiles: ignoredFiles)
  #expect(chunkFixture.ranges.isEmpty)
  #expect(try Data(contentsOf: ignoredURL) == untouched)
  #expect(try Data(contentsOf: root.appendingPathComponent("obsolete")) == untouched)
  #expect(!FileManager.default.fileExists(atPath: root.appendingPathComponent(filenames[2]).path))
  #expect(
    !FileManager.default.fileExists(atPath: root.appendingPathComponent("obsolete-other").path))
  #expect(try Data(contentsOf: retainedURL) == bytes)
  #expect(await updateReporter.snapshot().metrics.repair.files == 0)
  let finished = try #require(
    try await SophonClientv3.savedUpdateState(at: root, settings: settings))
  #expect(finished.finished && finished.plan.installFiles.map(\.fileURL) == [retainedURL])
}

@Test
func testTransferVersionAndActionDecision() throws {
  func branch(_ version: String, from: [String]) throws -> GameSubBranch {
    try JSONDecoder().decode(
      GameSubBranch.self,
      from: JSONSerialization.data(withJSONObject: [
        "package_id": "fixture", "branch": "fixture", "password": "", "tag": version,
        "diff_tags": from, "categories": [],
      ]))
  }
  let records = try JSONDecoder().decode(
    GameScanInfos.self,
    from: JSONSerialization.data(withJSONObject: [
      "game_scan_info": [
        [
          "game_id": "fixture",
          "game_exe_list": [
            ["version": "1", "md5": "shared"], ["version": "2", "md5": "shared"],
            ["version": "3", "md5": "new"],
          ],
        ],
        ["game_id": "other", "game_exe_list": [["version": "wrong-game", "md5": "new"]]],
      ]
    ]))
  #expect(
    resolveInstalledVersion(md5: "NEW", gameID: "fixture", records: records, completedVersion: nil)
      .version == "3")
  #expect(
    resolveInstalledVersion(
      md5: "shared", gameID: "fixture", records: records, completedVersion: nil
    ).version == nil)
  #expect(
    resolveInstalledVersion(
      md5: "shared", gameID: "fixture", records: records, completedVersion: "2"
    ).version == "2")
  let live = try branch("2", from: ["1"])
  let future = try branch("3", from: ["2"])
  let manifestExecutable = (version: "2", md5: "manifest-only")
  let manifestDetected = resolveInstalledVersion(
    md5: "MANIFEST-ONLY", gameID: "fixture", records: records, completedVersion: nil,
    manifestExecutable: manifestExecutable)
  #expect(manifestDetected.version == "2" && manifestDetected.candidates == ["2"])
  #expect(manifestDetected.executableMD5 == "MANIFEST-ONLY")
  #expect(
    decideGameAction(
      installed: manifestDetected, live: live, future: nil, installation: nil, update: nil,
      futureCached: false
    ).action == .none)
  for md5: String? in [nil, "corrupt"] {
    let unknown = resolveInstalledVersion(
      md5: md5, gameID: "fixture", records: records, completedVersion: "2",
      manifestExecutable: manifestExecutable)
    #expect(unknown.version == nil && unknown.candidates.isEmpty)
    #expect(
      decideGameAction(
        installed: unknown, live: live, future: nil, installation: nil, update: nil,
        futureCached: false
      ).action == .install)
  }
  #expect(
    resolveInstalledVersion(
      md5: "new", gameID: "fixture", records: records, completedVersion: nil,
      manifestExecutable: (version: "2", md5: "new")
    ).version == "3")
  #expect(
    resolveInstalledVersion(
      md5: "shared", gameID: "fixture", records: records, completedVersion: nil,
      manifestExecutable: (version: "2", md5: "shared")
    ).version == nil)
  let older = InstalledVersion(version: "1", executableMD5: nil, candidates: ["1"])
  let current = InstalledVersion(version: "2", executableMD5: nil, candidates: ["2"])
  let ahead = InstalledVersion(version: "3", executableMD5: nil, candidates: ["3"])
  #expect(
    decideGameAction(
      installed: older, live: live, future: future, installation: nil, update: nil,
      futureCached: false
    ).action == .update)
  #expect(
    decideGameAction(
      installed: current, live: live, future: future, installation: nil, update: nil,
      futureCached: false
    ).action == .cacheUpdate)
  #expect(
    decideGameAction(
      installed: current, live: live, future: future, installation: nil, update: nil,
      futureCached: true
    ).action == .none)
  #expect(
    decideGameAction(
      installed: ahead, live: live, future: future, installation: nil, update: nil,
      futureCached: false
    ).action == .none)
  #expect(
    decideGameAction(
      installed: older, live: try branch("2", from: []), future: future, installation: nil,
      update: nil, futureCached: false
    ).action == .install)
  #expect(
    decideGameAction(
      installed: current, live: live, future: try branch("3", from: []), installation: nil,
      update: nil, futureCached: false
    ).action == .none)
  let installedPacks = ["en-us", "ko-kr"]
  for version in [
    older, current, ahead, InstalledVersion(version: nil, executableMD5: nil, candidates: []),
  ] {
    let action = decideGameAction(
      installed: version, live: live, future: future, installation: nil, update: nil,
      futureCached: false, voicePacks: installedPacks)
    #expect(action.voicePacks == installedPacks)
  }
  let installation = SavedInstallationState(
    gameID: "fixture", version: "2", mode: .full, voicePacks: ["ja-jp"], predownload: false,
    plan: InstallationPlan(
      totalChunkCount: 0, downloadSize: 0, diskWriteSize: 0, requiredChunks: [], plannedFiles: []),
    completedApplications: [], trimmedFiles: [], finished: false)
  let installAction = decideGameAction(
    installed: older, live: live, future: future, installation: installation, update: nil,
    futureCached: false, voicePacks: installedPacks)
  #expect(installAction.voicePacks == ["en-us", "ja-jp", "ko-kr"])
  let plan = UpdatePlan(
    sourceVersion: "1", targetVersion: "2", patchBundles: [], installFiles: [], deleteFiles: [])
  let writing = SavedUpdateState(
    gameID: "fixture", mode: .full, predownload: false, cacheOnly: false,
    predownloadDirectory: nil, plan: plan, files: [:],
    finished: false)
  // A partially updated executable cannot hide unfinished file work.
  #expect(
    decideGameAction(
      installed: current, live: live, future: future, installation: nil, update: writing,
      futureCached: false
    ).action == .resumeUpdate)
  let liveCache = SavedUpdateState(
    gameID: "fixture", mode: .full, predownload: false, cacheOnly: true,
    predownloadDirectory: nil, plan: plan, files: [:],
    finished: false)
  let resumeCache = decideGameAction(
    installed: older, live: live, future: future, installation: nil, update: liveCache,
    futureCached: false)
  #expect(resumeCache.action == .resumeUpdate)
  #expect(resumeCache.cacheOnly)
  let obsolete = try branch("3", from: ["2"])
  #expect(
    decideGameAction(
      installed: current, live: obsolete, future: nil, installation: nil, update: writing,
      futureCached: false
    ).action == .install)
  let cachePlan = UpdatePlan(
    sourceVersion: "2", targetVersion: "3", patchBundles: [], installFiles: [], deleteFiles: [])
  let caching = SavedUpdateState(
    gameID: "fixture", mode: .full, predownload: true, cacheOnly: true,
    predownloadDirectory: nil, plan: cachePlan, files: [:],
    finished: false)
  #expect(
    decideGameAction(
      installed: current, live: live, future: future, installation: nil, update: caching,
      futureCached: false
    ).cacheOnly)
}

private final class TransferRPCProcess: @unchecked Sendable {
  let process = Process()
  let input = Pipe()
  let output = Pipe()

  init(_ arguments: [String]) throws {
    let products =
      ProcessInfo.processInfo.environment["SOPHON_TEST_PRODUCTS"].map {
        URL(fileURLWithPath: $0, isDirectory: true)
      } ?? getTestDataPath().deletingLastPathComponent().appendingPathComponent(".build/debug")
    process.executableURL = products.appendingPathComponent("SophonCLI")
    process.arguments = ["rpc"] + arguments
    process.standardInput = input
    process.standardOutput = output
    process.standardError = FileHandle.standardError
    try process.run()
  }

  func send(_ line: String) throws {
    try input.fileHandleForWriting.write(contentsOf: Data((line + "\n").utf8))
  }

  func read() throws -> Data {
    var bytes = Data()
    while let byte = try output.fileHandleForReading.read(upToCount: 1), !byte.isEmpty {
      if byte.first == 10 { return bytes }
      bytes.append(byte)
      if bytes.count > 1024 * 1024 { break }
    }
    throw SophonClientError.UnknownError("RPC output ended before a complete message")
  }

  func stop() {
    if process.isRunning { _ = kill(process.processIdentifier, SIGKILL) }
  }

  deinit {
    stop()
    try? input.fileHandleForWriting.close()
    try? output.fileHandleForReading.close()
  }
}

private actor RPCBatchTestSink {
  private(set) var frames: [Data] = []
  private(set) var blocked = false
  private var released = false
  private var releaseWrite: CheckedContinuation<Void, Never>?
  private var entered: [CheckedContinuation<Void, Never>] = []

  func write(_ frame: Data) async {
    frames.append(frame)
    guard frames.count == 1, !released else { return }
    await withCheckedContinuation { continuation in
      releaseWrite = continuation
      blocked = true
      for waiting in entered { waiting.resume() }
      entered.removeAll()
    }
  }

  func waitUntilBlocked() async {
    if blocked { return }
    await withCheckedContinuation { entered.append($0) }
  }

  func release() {
    released = true
    blocked = false
    releaseWrite?.resume()
    releaseWrite = nil
    for waiting in entered { waiting.resume() }
    entered.removeAll()
  }
}

@Test(arguments: [false, true])
func testTransferRPCEventBatches(cancelled: Bool) async throws {
  let reporter = InstallationReporter(logger: .init(label: "rpc-batch-test"))
  let sink = RPCBatchTestSink()
  let output = RPCOutput(writeFrame: { await sink.write($0) })
  let deadline = Task {
    do {
      try await Task.sleep(for: .seconds(10))
      Issue.record("RPC batch sender did not finish")
      await sink.release()
    } catch {}
  }
  defer { deadline.cancel() }
  let feed = await RPCProgressFeed(
    reporter: reporter, operationID: "job", kind: "install",
    status: { .object(["operationID": .string("job"), "status": .string("running")]) },
    send: { try await output.sendNotification($0) })
  await reporter.record(.phaseChanged(.scanning))
  await sink.waitUntilBlocked()
  #expect(await sink.frames.count == 1)

  for index in 0..<10_000 {
    await reporter.record(.chunkDownloaded(chunkID: String(index), bytes: 1))
  }
  await reporter.record(.finished(cancelled ? .cancelled : .completed))
  let snapshot = await reporter.snapshot()
  let terminal = JSONValue.object([
    "operationID": .string("job"), "status": .string(cancelled ? "cancelled" : "completed"),
    "progress": .encoded(snapshot),
  ])
  await feed.finish(terminal)
  // Reporting and completion returned while the transport remained blocked.
  #expect(await sink.blocked)
  #expect(snapshot.metrics.downloadedChunks == 10_000)
  #expect(snapshot.metrics.download.completed == 10_000)
  await sink.release()
  await feed.drain()

  let frames = await sink.frames
  var chunks: [String] = []
  var count = 0
  for frame in frames.dropLast() {
    let value = try #require(JSONSerialization.jsonObject(with: frame) as? [String: Any])
    #expect(value["method"] as? String == "operation.progress")
    let params = try #require(value["params"] as? [String: Any])
    #expect(params["kind"] as? String == "install")
    let events = try #require(params["events"] as? [[String: Any]])
    #expect(events.count <= 128)
    count += events.count
    for event in events {
      if let chunk = event["chunkDownloaded"] as? [String: Any] {
        chunks.append(try #require(chunk["chunkID"] as? String))
        #expect((chunk["bytes"] as? NSNumber)?.uint64Value == 1)
      }
    }
  }
  #expect(count == 10_002)
  #expect(chunks == (0..<10_000).map(String.init))
  let finalFrame = try #require(frames.last)
  let final = try #require(JSONSerialization.jsonObject(with: finalFrame) as? [String: Any])
  #expect(final["method"] as? String == "operation.finished")
  #expect(
    (final["params"] as? [String: Any])?["status"] as? String
      == (cancelled ? "cancelled" : "completed"))
}

private final class RPCEncodingProbe: Encodable, @unchecked Sendable {
  private let lock = NSLock()
  private var encodes = 0
  var count: Int { lock.withLock { encodes } }

  func encode(to encoder: any Encoder) throws {
    lock.withLock { encodes += 1 }
    var value = encoder.singleValueContainer()
    try value.encode("probe")
  }
}

@Test
func testTransferMetricRates() {
  var meter = SophonMeter()
  meter.setTotal(1000)
  meter.start(at: 0)
  meter.advance(100, at: 1)
  let first = meter.snapshot(at: 1)
  #expect(first.completed == 100 && first.remaining == 900 && first.percentage == 10)
  #expect(first.rate == 100 && first.averageRate == 100 && first.etaSeconds == 9)
  // Sampling while idle ages the recent rate without changing the counters.
  let idle = meter.snapshot(at: 7)
  #expect(idle.completed == 100 && idle.rate == 0 && idle.etaSeconds == nil)
  #expect(idle.averageRate == 100.0 / 7)
  meter.advance(100, at: 8)
  meter.finish(at: 8)
  let stopped = meter.snapshot(at: 100)
  #expect(stopped.elapsedSeconds == 8 && stopped.averageRate == 25)
  #expect(stopped.isFinished && stopped.etaSeconds == nil)
  meter.start(at: 100)
  meter.set(50, at: 101)
  #expect(meter.snapshot(at: 101).averageRate == nil)
  meter.set(1000, at: 102)
  meter.finish(at: 102)
  let done = meter.snapshot(at: 103)
  #expect(done.remaining == 0 && done.percentage == 100 && done.etaSeconds == 0)
  var unplanned = SophonMeter()
  unplanned.advance(1, at: 1)
  #expect(unplanned.snapshot(at: 2).total == nil)
  #expect(unplanned.snapshot(at: 2).percentage == nil)
}

@Test
func testTransferReporterMetrics() async throws {
  let path = FileManager.default.temporaryDirectory.appendingPathComponent("metrics.bin")
  let install = InstallationReporter(logger: .init(label: "metrics"))
  await install.record(.metadataPlanned(totalManifests: 2))
  await install.record(.manifestPulled(matchingField: "game", predownload: false))
  await install.record(.planningStarted)
  await install.record(.phaseChanged(.scanning))
  await install.record(.scanPlanned(totalFiles: 2, totalChunks: 3, totalBytes: 300))
  await install.record(.fileMissing(filePath: path, chunkCount: 2, expectedBytes: 200))
  await install.record(
    .fileChunkScanned(
      filePath: path, chunkID: "scan", isBroken: true, offset: 0, bytes: 80, expectedBytes: 100))
  await install.record(.fileScanned(filePath: path, isBroken: true, needsTrimming: true))
  let scanning = await install.snapshot().metrics
  #expect(scanning.verification.bytes.completed == 300)
  #expect(scanning.verification.chunks.completed == 3)
  #expect(scanning.verification.missingFiles == 1 && scanning.verification.brokenFiles == 1)
  #expect(scanning.common.read.completed == 80)
  #expect(!scanning.common.metadata.planning.isFinished)
  await install.record(.planningCompleted)
  await install.record(.planned(downloadBytes: 100, writeBytes: 120, totalChunk: 1, totalFile: 2))
  await install.record(.phaseChanged(.trimming))
  await install.record(.fileTrimmed(filePath: path))
  await install.record(.phaseChanged(.running))
  await install.record(.chunkDownloaded(chunkID: "download", bytes: 100))
  await install.record(.retryScheduled(chunkID: "download", attempt: 1, reason: "fixture"))
  await install.record(
    .chunkPostProcessed(chunkID: "download", compressed_bytes: 100, uncompressed_bytes: 120))
  await install.record(.chunkWritten(filePath: path, chunkID: "download", offset: 0, bytes: 120))
  await install.record(.finished(.completed))
  let installed = await install.snapshot().metrics
  #expect(installed.common.metadata.installationManifests.completed == 1)
  #expect(installed.common.metadata.planning.completed == 1)
  #expect(installed.trimming.completed == 1 && installed.trimming.isFinished)
  #expect(installed.download.completed == 100 && installed.downloadedChunks == 1)
  #expect(installed.processing.bytes == 120 && installed.processing.chunks.completed == 1)
  #expect(installed.common.write.completed == 120 && installed.retries == 1)
  #expect(installed.common.timing.phaseDurations["scanning"] != nil)

  let telemetry = TransferTelemetry(memoryLimit: 1024, diskLimit: 2048)
  let device = telemetry.register(path, role: "Target")
  let update = UpdateReporter(logger: .init(label: "metrics"))
  await update.useResources(telemetry)
  await update.record(.metadataPlanned(installationManifests: 1, diffManifests: 1))
  await update.record(.manifestPulled(kind: "install", matchingField: "game"))
  await update.record(.manifestPulled(kind: "diff", matchingField: "game"))
  await update.record(.planningStarted)
  await update.record(.planningCompleted)
  await update.record(
    .planned(
      sourceVersion: "1", targetVersion: "2", patchBytes: 100, installBytes: 300, totalFiles: 3,
      deleteFiles: 1, deleteBytes: 20))
  await update.record(.phaseChanged(.running))
  telemetry.planDownload("patch", size: 100, retained: 40)
  telemetry.receive(10, committed: 50, id: "patch")
  telemetry.reserve(20, inMemory: true, device: device)
  telemetry.reserve(30, inMemory: false, device: device)
  telemetry.stored(10, device: device)
  telemetry.read(12, device: device)
  telemetry.write(18, device: device)
  telemetry.cacheRead(7, inMemory: true)
  telemetry.cacheWrite(9, inMemory: true)
  telemetry.cacheRead(3, inMemory: false, device: device)
  telemetry.cacheWrite(5, inMemory: false, device: device)
  // No reporter event announces these I/O updates; the snapshot reads the live counters.
  let live = await update.snapshot().metrics
  #expect(live.patch.data.completed == 50 && live.patch.data.remaining == 50)
  #expect(live.patch.network.completed == 10 && live.patch.retainedBytes == 40)
  #expect(live.common.network.completed == 10 && live.common.read.completed == 15)
  #expect(live.common.resources?.memoryBytes == 20)
  #expect(live.common.resources?.diskReservedBytes == 30)
  #expect(live.common.resources?.devices.first?.write.completed == 23)
  #expect(live.common.resources?.devices.first?.cacheBytes == 10)
  #expect(live.common.resources?.memoryCache.read.completed == 7)
  #expect(live.common.resources?.memoryCache.write.completed == 9)
  #expect(live.common.resources?.diskCache.read.completed == 3)
  #expect(live.common.resources?.diskCache.write.completed == 5)
  #expect(live.common.resources?.target.read.completed == 12)
  #expect(live.common.resources?.target.write.completed == 18)
  var meters = SophonMetricsState()
  meters.resourceSource = { telemetry.snapshot() }
  meters.syncResources(at: 1)
  let sampled = meters.snapshot(at: 1, eta: nil)
  #expect(sampled.resources?.memoryCache.read.rate == 7)
  #expect(sampled.resources?.diskCache.write.rate == 5)
  let encoded = try #require(
    JSONSerialization.jsonObject(with: JSONEncoder().encode(live)) as? [String: Any])
  let resources = try #require(
    (encoded["common"] as? [String: Any])?["resources"] as? [String: Any])
  #expect((resources["memoryCache"] as? [String: Any])?["read"] != nil)
  #expect((resources["diskCache"] as? [String: Any])?["write"] != nil)
  #expect(live.common.metadata.manifests.completed == 2)
  #expect(live.common.metadata.diffManifests.completed == 1)
  #expect(live.common.metadata.manifests.isFinished)
  await update.record(.fileCompleted(fileURL: path, bytes: 100, skipped: true))
  await update.record(.fileNeedsRepair(fileURL: path))
  await update.record(.phaseChanged(.repairing))
  await update.record(.repairPlanned(downloadBytes: 60, writeBytes: 100))
  telemetry.planDownload("repair", size: 60, retained: 0, category: "install")
  telemetry.receive(20, committed: 20, id: "repair")
  #expect(await update.snapshot().metrics.repair.download.completed == 20)
  await update.record(.repairWritten(bytes: 10))
  await update.record(.finished(.cancelled))
  let stopped = await update.snapshot()
  #expect(stopped.metrics.common.write.total == 200)
  #expect(stopped.metrics.common.files.completed == 1 && stopped.metrics.skippedFiles == 1)
  #expect(stopped.metrics.repair.files == 1 && stopped.metrics.repair.write.completed == 10)
  #expect(stopped.metrics.patch.data.etaSeconds == nil)
  telemetry.receive(40, committed: 60, id: "repair")
  #expect(await update.snapshot().metrics.repair.download.completed == 20)
  let value = try #require(
    JSONSerialization.jsonObject(with: JSONEncoder().encode(stopped)) as? [String: Any])
  #expect(value["metrics"] != nil && value["totalPatchBytes"] == nil && value["resources"] == nil)
  // Replanning and retry resets preserve new traffic, while retained/received bytes reflect usable data.
  telemetry.resetDownload("patch")
  telemetry.receive(15, committed: 15, id: "patch")
  telemetry.planDownload("patch", size: 100, retained: 15)
  #expect(telemetry.snapshot().transferredBytes == 25)
  #expect(telemetry.snapshot().receivedBytes == 15 && telemetry.snapshot().retainedBytes == 15)
  for index in 0..<1000 {
    let id = String(index)
    telemetry.planDownload(id, size: 1, retained: 0, category: "install")
    telemetry.receive(1, committed: 1, id: id)
  }
  #expect(telemetry.snapshot().downloads.count == 1)
  #expect(telemetry.snapshot().downloadTotals["install"]?.transferredBytes == 1060)
}

@Test
func testTransferRPCSamplesLiveMetrics() async throws {
  let telemetry = TransferTelemetry(memoryLimit: 1024, diskLimit: 0)
  telemetry.planDownload("large", size: 1024, retained: 0, category: "install")
  let reporter = InstallationReporter(logger: .init(label: "rpc-sampling"))
  await reporter.useResources(telemetry)
  let frames = AsyncStream<Data>.makeStream()
  let output = RPCOutput(writeFrame: { frames.continuation.yield($0) })
  let feed = await RPCProgressFeed(
    reporter: reporter, operationID: "live", kind: "install",
    status: { .object(["status": .string("running")]) },
    send: { try await output.sendNotification($0) })
  telemetry.receive(512, committed: 512, id: "large")
  let watchdog = Task {
    do {
      try await Task.sleep(for: .seconds(5))
      Issue.record("External RPC sampling did not publish quiet I/O")
      frames.continuation.finish()
    } catch {}
  }
  defer { watchdog.cancel() }
  var iterator = frames.stream.makeAsyncIterator()
  let frame = try #require(await iterator.next())
  let value = try #require(JSONSerialization.jsonObject(with: frame) as? [String: Any])
  let params = try #require(value["params"] as? [String: Any])
  #expect((params["events"] as? [Any])?.isEmpty == true)
  let progress = try JSONDecoder().decode(
    InstallationProgress.self,
    from: JSONSerialization.data(withJSONObject: try #require(params["progress"])))
  #expect(progress.metrics.common.network.completed == 512)
  #expect(progress.metrics.download.completed == 512 && progress.metrics.downloadedChunks == 0)
  await reporter.record(.finished(.cancelled))
  await feed.finish(.object(["status": .string("cancelled")]))
  await feed.drain()
}

@Test
func testTransferRPCBrokenEventWriter() async {
  let reporter = InstallationReporter(logger: .init(label: "rpc-batch-test"))
  let feed = await RPCProgressFeed(
    reporter: reporter, operationID: "job", kind: "install", status: { .null },
    send: { _ in throw POSIXError(.EPIPE) })
  await reporter.record(.phaseChanged(.running))
  await feed.drain()
  #expect(await reporter.subscribers.isEmpty)
  await reporter.record(.chunkDownloaded(chunkID: "after-disconnect", bytes: 42))
  #expect(await reporter.snapshot().metrics.download.completed == 42)
  await feed.finish(.object(["operationID": .string("job"), "status": .string("completed")]))
}

@Test
func testTransferRPCSnapshotRate() async throws {
  let reporter = InstallationReporter(logger: .init(label: "rpc-snapshot"))
  let frames = AsyncStream<(ContinuousClock.Instant, Data)>.makeStream()
  let output = RPCOutput(writeFrame: { frames.continuation.yield((.now, $0)) })
  let watchdog = Task {
    do {
      try await Task.sleep(for: .seconds(5))
      Issue.record("Snapshot-only progress did not arrive")
      frames.continuation.finish()
    } catch {}
  }
  defer { watchdog.cancel() }
  let feed = await RPCSnapshotFeed(
    reporter: reporter, operationID: "snapshot", kind: "install",
    status: { .object(["status": .string("running")]) },
    send: { try await output.sendNotification($0) })
  await reporter.record(.phaseChanged(.scanning))
  for index in 0..<10_000 {
    await reporter.record(.chunkDownloaded(chunkID: String(index), bytes: 1))
  }
  #expect(await reporter.subscribers.isEmpty)
  var previous: ContinuousClock.Instant?
  var iterator = frames.stream.makeAsyncIterator()
  for _ in 0..<3 {
    let (time, data) = try #require(await iterator.next())
    if let previous { #expect(previous.duration(to: time) >= .milliseconds(240)) }
    previous = time
    let message = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    #expect(message["method"] as? String == "operation.progress")
    let params = try #require(message["params"] as? [String: Any])
    #expect(params["events"] == nil)
    let progress = try JSONDecoder().decode(
      InstallationProgress.self,
      from: JSONSerialization.data(withJSONObject: try #require(params["progress"])))
    #expect(progress.phase == .scanning && progress.metrics.downloadedChunks == 10_000)
  }
  await reporter.record(.finished(.completed))
  await feed.finish(.object(["status": .string("completed")]))
  await feed.drain()
}

@Test(arguments: ["completed", "cancelled", "failed"])
func testTransferRPCSnapshotTerminal(status: String) async throws {
  let reporter = InstallationReporter(logger: .init(label: "rpc-snapshot"))
  let frames = AsyncStream<Data>.makeStream()
  let output = RPCOutput(writeFrame: { frames.continuation.yield($0) })
  let feed = await RPCSnapshotFeed(
    reporter: reporter, operationID: "snapshot", kind: "install", status: { .null },
    send: { try await output.sendNotification($0) })
  let outcome: InstallationOutcome =
    status == "failed"
    ? .failed(reason: "fixture") : status == "cancelled" ? .cancelled : .completed
  await reporter.record(.finished(outcome))
  let snapshot = await reporter.snapshot()
  await feed.finish(
    .object([
      "operationID": .string("snapshot"), "status": .string(status), "progress": .encoded(snapshot),
    ]))
  await feed.drain()
  frames.continuation.finish()
  var count = 0
  for await data in frames.stream {
    let message = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    #expect(message["method"] as? String == "operation.finished")
    #expect((message["params"] as? [String: Any])?["status"] as? String == status)
    count += 1
  }
  #expect(count == 1)
}

@Test
func testTransferRPCSnapshotBackpressure() async throws {
  let reporter = InstallationReporter(logger: .init(label: "rpc-snapshot"))
  let sink = RPCBatchTestSink()
  let output = RPCOutput(writeFrame: { await sink.write($0) })
  let watchdog = Task {
    do {
      try await Task.sleep(for: .seconds(5))
      Issue.record("Snapshot writer remained blocked")
      await sink.release()
    } catch {}
  }
  defer { watchdog.cancel() }
  let control = Task {
    try await output.send(
      .object(["jsonrpc": .string("2.0"), "id": .string("control"), "result": .bool(true)]))
  }
  await sink.waitUntilBlocked()
  let feed = await RPCSnapshotFeed(
    reporter: reporter, operationID: "snapshot", kind: "install", status: { .null },
    send: { try await output.sendNotification($0) })
  let deadline = ContinuousClock.now + .seconds(2)
  while await output.queuedCounts.notifications == 0, ContinuousClock.now < deadline {
    try await Task.sleep(for: .milliseconds(5))
  }
  for index in 0..<10_000 {
    await reporter.record(.chunkDownloaded(chunkID: String(index), bytes: 1))
  }
  try await Task.sleep(for: .milliseconds(500))
  #expect(await output.queuedCounts.notifications == 1)
  #expect(await reporter.subscribers.isEmpty)
  await reporter.record(.finished(.cancelled))
  await feed.finish(
    .object(["status": .string("cancelled"), "progress": .encoded(await reporter.snapshot())]))
  #expect(await sink.blocked)
  await sink.release()
  try await control.value
  await feed.drain()
  let frames = await sink.frames
  let messages = try frames.map {
    try #require(JSONSerialization.jsonObject(with: $0) as? [String: Any])
  }
  #expect(messages.count == 2)
  #expect(messages.last?["method"] as? String == "operation.finished")
  let params = try #require(messages.last?["params"] as? [String: Any])
  let progress = try JSONDecoder().decode(
    InstallationProgress.self,
    from: JSONSerialization.data(withJSONObject: try #require(params["progress"])))
  #expect(progress.metrics.downloadedChunks == 10_000)
}

@Test
func testTransferRPCReplyPriority() async throws {
  let sink = RPCBatchTestSink()
  let watchdog = Task {
    do {
      try await Task.sleep(for: .seconds(10))
      Issue.record("RPC reply sender did not finish")
      await sink.release()
    } catch {}
  }
  defer { watchdog.cancel() }
  let output = RPCOutput(writeFrame: { await sink.write($0) })
  let probe = RPCEncodingProbe()
  let first = Task { try await output.sendNotification(.encoded(probe)) }
  await sink.waitUntilBlocked()
  let buffer = RPCEventBuffer<UpdateEvent>()
  buffer.append(.phaseChanged(.running))
  let next = Task {
    try await output.sendNotification(RPCNotification { .encoded(buffer.take()) })
  }
  let reply = Task {
    try await output.send(Data("{\"jsonrpc\":\"2.0\",\"id\":\"control\",\"result\":true}".utf8))
  }
  let deadline = ContinuousClock.now + .seconds(2)
  var counts = await output.queuedCounts
  while counts.replies != 1 || counts.notifications != 1, ContinuousClock.now < deadline {
    await Task.yield()
    counts = await output.queuedCounts
  }
  #expect(counts.replies == 1 && counts.notifications == 1)
  buffer.append(.phaseChanged(.deleting))
  await sink.release()
  try await first.value
  try await reply.value
  try await next.value
  let frames = await sink.frames
  #expect(probe.count == 1)
  #expect(frames.count == 3)
  #expect(String(data: frames[0], encoding: .utf8) == "\"probe\"\n")
  let response = try #require(JSONSerialization.jsonObject(with: frames[1]) as? [String: Any])
  #expect(response["id"] as? String == "control")
  let events = try #require(JSONSerialization.jsonObject(with: frames[2]) as? [[String: Any]])
  #expect(events.count == 2)
  #expect((events[0]["phaseChanged"] as? [String: Any])?["_0"] as? String == "running")
  #expect((events[1]["phaseChanged"] as? [String: Any])?["_0"] as? String == "deleting")
}

@Test
func testRPCGameConfigScenarioDescriptions() throws {
  let json = #"""
    {"launch_configs": [{
      "game": {"id": "fixture", "biz": "nap_global"},
      "installation_dir": "Game", "exe_file_name": "Game.exe",
      "audio_pkg_scan_dir": "", "res_category_dir": "",
      "wpf_exe_dir": "", "wpf_pkg_version_dir": "",
      "enable_ldiff": false, "enable_scenario_pkg": true,
      "enable_write_verify_result": false, "write_verify_result_path": "",
      "scenario_pkg_info": {
        "full_pkg_name": "Full version", "full_pkg_desc": "Full\nresources",
        "base_pkg_name": "Base version", "base_pkg_desc": "Base\nresources"
      }
    }]}
    """#
  let configs = try JSONDecoder().decode(GameConfigs.self, from: Data(json.utf8))
  #expect(configs.launchConfigs.first?.enableResourceBlacklist == nil)
  let info = try #require(configs.findBy(biz: "nap_global")?.scenarioPkgInfo)
  #expect(info.fullPkgName == "Full version")
  #expect(info.fullPkgDesc == "Full\nresources")
  #expect(info.basePkgName == "Base version")
  #expect(info.basePkgDesc == "Base\nresources")
  let encoded = try JSONEncoder().encode(JSONValue.value(configs))
  let result = try #require(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
  let launchConfigs = try #require(result["launch_configs"] as? [[String: Any]])
  let scenario = try #require(launchConfigs.first?["scenario_pkg_info"] as? [String: String])
  #expect(
    scenario == [
      "full_pkg_name": "Full version", "full_pkg_desc": "Full\nresources",
      "base_pkg_name": "Base version", "base_pkg_desc": "Base\nresources",
    ])
  var config = try #require(launchConfigs.first)
  config["enable_resource_blacklist"] = true
  config["blacklist_dir"] = "StarRail_Data\\Persistent\\DownloadBlacklist.json"
  let blacklistConfig = try JSONDecoder().decode(
    GameLaunchConfig.self, from: JSONSerialization.data(withJSONObject: config))
  #expect(blacklistConfig.enableResourceBlacklist == true)
  #expect(blacklistConfig.blacklistDir == config["blacklist_dir"] as? String)
  let blacklistJSON = try #require(
    JSONSerialization.jsonObject(with: JSONEncoder().encode(blacklistConfig)) as? [String: Any])
  #expect(
    try JSONSerialization.data(withJSONObject: blacklistJSON, options: .sortedKeys)
      == JSONSerialization.data(withJSONObject: config, options: .sortedKeys))
  config["scenario_pkg_info"] = NSNull()
  let unsupported = try JSONDecoder().decode(
    GameLaunchConfig.self, from: JSONSerialization.data(withJSONObject: config))
  #expect(unsupported.scenarioPkgInfo == nil)
}

@Test
func testTransferRPCUpdateEventEncoding() async throws {
  let buffer = RPCEventBuffer<UpdateEvent>()
  let file = URL(fileURLWithPath: "/rpc-encoding-fixture")
  buffer.append(.fileStarted(fileURL: file))
  buffer.append(.fileCompleted(fileURL: file, bytes: 42, skipped: false))
  buffer.append(.phaseChanged(.deleting))
  let value = JSONValue.object([
    "kind": .string("update"), "events": .encoded(buffer.take()),
  ])
  let encoded = try JSONEncoder().encode(value)
  let params = try #require(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
  let events = try #require(params["events"] as? [[String: Any]])
  #expect(events.count == 3)
  #expect(
    (events[0]["fileStarted"] as? [String: Any])?["fileURL"] as? String == file.absoluteString)
  #expect((events[1]["fileCompleted"] as? [String: Any])?["bytes"] as? Int == 42)
  #expect((events[2]["phaseChanged"] as? [String: Any])?["_0"] as? String == "deleting")
}

@Test(arguments: ["stdio", "http"])
func testTransferRPCTransports(transport: String) async throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: root) }
  let manifests = root.appendingPathComponent("manifest cache")
  let logFile = root.appendingPathComponent("logs/rpc log.txt")
  let settings = [
    "--manifest-cache-dir", manifests.path, "--log-file", logFile.path, "--log-level", "debug",
  ]
  let child = try TransferRPCProcess(
    settings + (transport == "http" ? ["--transport", "http", "--token", "fixture-token"] : []))
  let timeout = Task {
    do {
      try await Task.sleep(for: .seconds(10))
      child.stop()
    } catch {}
  }
  defer {
    timeout.cancel()
    child.stop()
  }
  if transport == "stdio" {
    try child.send("{\"jsonrpc\":\"2.0\",\"method\":\"rpc.discover\"}")
    try child.send("{\"jsonrpc\":\"2.0\",\"id\":18446744073709551615,\"method\":\"rpc.discover\"}")
    let response =
      try JSONSerialization.jsonObject(with: await runTransferIO { try child.read() })
      as? [String: Any]
    #expect((response?["id"] as? NSNumber)?.uint64Value == UInt64.max)
    #expect((response?["result"] as? [String: Any])?["methods"] is [String])
    try child.send("{")
    let invalid =
      try JSONSerialization.jsonObject(with: await runTransferIO { try child.read() })
      as? [String: Any]
    #expect((invalid?["error"] as? [String: Any])?["code"] as? Int == -32700)
    try child.send(
      "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"state.inspect\",\"params\":{\"directory\":\"/nonexistent-sophon-rpc-fixture\"}}"
    )
    let state =
      try JSONSerialization.jsonObject(with: await runTransferIO { try child.read() })
      as? [String: Any]
    #expect(state?["result"] is NSNull)
    child.process.interrupt()
  } else {
    let listening =
      try JSONSerialization.jsonObject(with: await runTransferIO { try child.read() })
      as? [String: Any]
    let urlString = try #require((listening?["params"] as? [String: Any])?["url"] as? String)
    let url = try #require(URL(string: urlString))
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = Data("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"rpc.discover\"}".utf8)
    let (_, rejected) = try await URLSession.shared.data(for: request)
    #expect((rejected as? HTTPURLResponse)?.statusCode == 401)
    request.setValue("Bearer fixture-token", forHTTPHeaderField: "Authorization")
    let (data, response) = try await URLSession.shared.data(for: request)
    #expect((response as? HTTPURLResponse)?.statusCode == 200)
    let result = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    #expect(result?["id"] as? Int == 1)
    request.httpBody = Data("{\"jsonrpc\":\"2.0\",\"method\":\"rpc.discover\"}".utf8)
    let (notification, acknowledged) = try await URLSession.shared.data(for: request)
    #expect((acknowledged as? HTTPURLResponse)?.statusCode == 204)
    #expect(notification.isEmpty)
    request.httpBody = Data("{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"rpc.shutdown\"}".utf8)
    let (shutdown, _) = try await URLSession.shared.data(for: request)
    #expect(
      (try JSONSerialization.jsonObject(with: shutdown) as? [String: Any])?["result"] as? Bool
        == true)
  }
  try await runTransferIO { child.process.waitUntilExit() }
  #expect(child.process.terminationStatus == 0)
  #expect(FileManager.default.fileExists(atPath: manifests.path))
  let logs = try String(contentsOf: logFile, encoding: .utf8)
  #expect(logs.contains("RPC server started") && logs.contains("RPC request"))
  #expect(logs.contains("transport=\(transport)") && logs.contains("method=rpc.discover"))
}

@Test
func testTransferRPCOperationParameters() async throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: root) }
  let base: [String: JSONValue] = ["game": .string("fixture"), "directory": .string(root.path)]
  func decode(_ values: [String: JSONValue]) throws -> RPCOperationParameters {
    try JSONDecoder().decode(
      RPCOperationParameters.self,
      from: JSONEncoder().encode(JSONValue.object(base.merging(values) { _, new in new })))
  }
  let defaults = try decode([:])
  #expect(defaults.checks == 8 && defaults.postProcessors == 4)
  #expect(defaults.maxRetries == 10 && defaults.retryInterval == 5)
  #expect(defaults.maxCachedFileHandles == 512)
  let custom = try decode([
    "checks": .integer(2), "postProcessors": .integer(3),
    "maxRetries": .integer(0), "retryInterval": .integer(0),
    "writes": .integer(7), "maxCachedFileHandles": .integer(7),
  ])
  #expect(custom.checks == 2 && custom.postProcessors == 3)
  #expect(custom.maxRetries == 0 && custom.retryInterval == 0)
  #expect(custom.writes == 7 && custom.maxCachedFileHandles == 7)
  let serialized = try decode([
    "checks": .integer(3), "writes": .integer(7), "maxCachedFileHandles": .integer(1),
    "transfer": .object(["ioPolicy": .string("serialized")]),
  ])
  #expect(serialized.checks == 3 && serialized.writes == 7 && serialized.maxCachedFileHandles == 1)

  var invalid: [(String, JSONValue)] = [
    ("maxRetries", .integer(-1)), ("retryInterval", .integer(-1)),
    ("maxCachedFileHandles", .integer(3)), ("writes", .integer(513)),
  ]
  for key in ["checks", "postProcessors", "maxCachedFileHandles", "downloads", "writes"] {
    invalid.append((key, .integer(0)))
    invalid.append((key, .integer(-1)))
  }
  for key in ["checks", "postProcessors", "maxRetries", "retryInterval", "maxCachedFileHandles"] {
    for value in [JSONValue.bool(true), .string("2"), .decimal(1.5), .unsigned(UInt64.max)] {
      invalid.append((key, value))
    }
  }
  let dispatcher = RPCDispatcher(settings: try RPCSessionSettings(manifestCacheDir: root.path))
  for (key, value) in invalid {
    for method in ["install.start", "update.start", "update.plan"] {
      let request = try JSONEncoder().encode(
        JSONValue.object([
          "jsonrpc": .string("2.0"), "id": .integer(1), "method": .string(method),
          "params": .object(base.merging([key: value]) { _, new in new }),
        ]))
      let data = try #require(await dispatcher.handle(request))
      let reply = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
      #expect((reply["error"] as? [String: Any])?["code"] as? Int == -32602)
      #expect(reply["result"] == nil)
    }
  }
}

@Test
func testTransferRPCSessionSettings() async throws {
  let defaults = try RPCCLI.parse([])
  #expect(defaults.manifestCacheDir == nil && defaults.logFile == nil && defaults.logLevel == .info)
  #expect(!defaults.progressSnapshotsOnly)
  #expect(try RPCCLI.parse(["--progress-snapshots-only"]).progressSnapshotsOnly)
  #expect(try RPCSessionSettings().logger == nil)
  for level in ["trace", "debug", "info", "notice", "warning", "error", "critical"] {
    #expect(try RPCCLI.parse(["--log-level", level]).logLevel.rawValue == level)
  }
  for arguments in [
    ["--log-level", "invalid"], ["--log-file", ""], ["--manifest-cache-dir", ""],
  ] {
    #expect(throws: (any Error).self) {
      var command = try RPCCLI.parse(arguments)
      try command.validate()
    }
  }
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: root) }
  let file = root.appendingPathComponent("session log.txt")
  try Data("existing contents\n".utf8).write(to: file)
  let session = try RPCSessionSettings(logFile: file.path, logLevel: .warning)
  let logger = try #require(session.logger)
  logger.debug("filtered debug")
  logger.info("filtered info")
  await withTaskGroup(of: Void.self) { group in
    for index in 0..<100 {
      group.addTask {
        var operationLogger = logger
        operationLogger[metadataKey: "operation.id"] = "\(index)"
        operationLogger.warning("append \(index)")
      }
    }
  }
  let contents = try String(contentsOf: file, encoding: .utf8)
  #expect(contents.hasPrefix("existing contents\n"))
  #expect(!contents.contains("filtered"))
  #expect(contents.split(separator: "\n").count == 101)
  for index in 0..<100 { #expect(contents.contains("operation.id=\(index) ")) }
  let handle = try FileHandle(forWritingTo: file)
  try handle.close()
  let broken = RPCLogStream(handle: handle)
  broken.write("cannot write to a closed file\n")
  broken.write("further writes are disabled\n")
  #expect(try String(contentsOf: file, encoding: .utf8) == contents)
  // File-open failure exits before any RPC/plain-text stdout is emitted.
  let child = try TransferRPCProcess(["--log-file", root.path])
  defer { child.stop() }
  try await runTransferIO { child.process.waitUntilExit() }
  #expect(child.process.terminationStatus != 0)
  #expect((try child.output.fileHandleForReading.readToEnd() ?? Data()).isEmpty)
}

func testManifestContents(_ manifest: Manifest) {
  for fileInfo in manifest.files {
    for chunkInfo in fileInfo.chunks {
      #expect(chunkInfo.chunkID.count > 0, "chunk ID should exist")
      #expect(chunkInfo.md5.count > 0, "chunk uncompressed md5 should exist")
      #expect(chunkInfo.compressedSize > 0, "chunk compressed size should be positive")
      #expect(chunkInfo.uncompressedSize > 0, "chunk uncompressed size should be positive")
      #expect(chunkInfo.compressedMd5.count > 0, "chunk compressed md5 should exist")
      #expect(
        UInt64(chunkInfo.uncompressedSize) + chunkInfo.offset <= UInt64(fileInfo.size),
        "chunk should be within file")
    }
  }
}

func testDiffManifestContents(_ manifest: DiffManifest) {
  for fileInfo in manifest.files {
    #expect(fileInfo.filename.count > 0, "file name should exist")
    #expect(fileInfo.size >= 0, "file size should not be negative")
    #expect(fileInfo.hash.count > 0, "file hash should exist")
    let sourceVersions = fileInfo.patches.map(\.key)
    #expect(
      Set(sourceVersions).count == sourceVersions.count,
      "file \(fileInfo.filename) should have at most one patch per source version")
    for patch in fileInfo.patches {
      #expect(patch.key.count > 0, "patch source version should exist")
      #expect(patch.hasInfo, "patch info should exist")
      #expect(patch.info.patchOffset >= 0, "patch offset should not be negative")
      #expect(patch.info.patchLength >= 0, "patch length should not be negative")
      #expect(
        patch.info.patchOffset + patch.info.patchLength <= patch.info.patchSize,
        "patch should be within the diff file")
    }
  }

  for deleteFile in manifest.filesDelete {
    #expect(deleteFile.key.count > 0, "delete source version should exist")
    #expect(deleteFile.hasInfo, "delete info should exist")
    for fileInfo in deleteFile.info.list {
      #expect(fileInfo.filename.count > 0, "delete file name should exist")
      #expect(fileInfo.size >= 0, "delete file size should not be negative")
      #expect(fileInfo.hash.count > 0, "delete file hash should exist")
    }
  }
}

func printUpdatePlanSummary(_ plan: UpdatePlan, gameID: String) {
  let patches = plan.patchBundles.flatMap(\.patches)
  let patchesWithSource = patches.filter { $0.original != nil }.count

  print(
    """
    update plan for \(gameID) from \(plan.sourceVersion):
      patch bundle files: \(plan.patchBundles.count)
      total bundle target files: \(patches.count)
      files to patch using an original: \(patchesWithSource)
      files supplied by bundles without an original: \(patches.count - patchesWithSource)
      files to delete: \(plan.deleteFiles.count)
      total file size to delete: \(Double(plan.deleteSize) / 1_073_741_824) GiB
      total patch bundle download size: \(Double(plan.patchSize) / 1_073_741_824) GiB
      total updated file size: \(Double(plan.installSize) / 1_073_741_824) GiB
    """)
}

func testDiffManifestParse(
  baseURL: String, sophonBaseURL: String, launcherID: String, gameList: [String]
) async throws {
  let cacheDir = getTestDataPath().appendingPathComponent("manifestCache")
  for gameID in gameList {
    let manager = try await CachedManifestManager(
      baseURL: baseURL, sophonBaseURL: sophonBaseURL, launcherID: launcherID,
      gameID: gameID, manifestCacheDir: cacheDir.path())
    let subBranch = try manager.getGameSubbranch(predownload: false)
    let patchBuildInfo = try await manager.apiClient.getSophonPatchBuildInfo(subBranch)
    #expect(patchBuildInfo.manifests.count > 0, "patch manifests should exist")
    let categories =
      subBranch.getGameBranchCategories(
        categoryScenario: .full, categoryType: .resource)
      + subBranch.getGameBranchCategories(categoryScenario: .full, categoryType: .audio)
    let matchingFields = Set(categories.map(\.matchingField))
    var installInfos: [(manifest: Manifest, chunkDownloadInfo: SophonDownloadInfo)] = []
    var updateInfos: [(manifest: DiffManifest, diffDownloadInfo: SophonDownloadInfo)] = []

    for manifestInfo in patchBuildInfo.manifests {
      let (manifest, diffDownloadInfo) = try await manager.getSophonPatchManifest(
        matchingField: manifestInfo.matchingField)
      #expect(
        manifest.files.count > 0 || manifest.filesDelete.count > 0,
        "manifest with matching field \(manifestInfo.matchingField) should not be empty")
      #expect(diffDownloadInfo.urlPrefix == manifestInfo.diffDownload.urlPrefix)
      #expect(diffDownloadInfo.urlSuffix == manifestInfo.diffDownload.urlSuffix)
      testDiffManifestContents(manifest)

      if matchingFields.contains(manifestInfo.matchingField) {
        installInfos.append(
          try await manager.getSophonManifest(matchingField: manifestInfo.matchingField))
        updateInfos.append((manifest, diffDownloadInfo))
      }
    }

    #expect(updateInfos.count > 0, "selected update manifests should exist")
    let baseGameDir = getTestDataPath().appendingPathComponent("updatePlan")
    let updater = try Updater(
      baseGameDir: baseGameDir, maxCocurrentDownloads: 8, maxCocurrentWrites: 4)
    var installFilesByPath: [String: (file: FileInfo, downloadInfo: SophonDownloadInfo)] = [:]
    for info in installInfos {
      for file in info.manifest.files where file.flags == FILE_FLAG_FILE {
        let path = baseGameDir.appendingPathComponent(file.filename).path.lowercased()
        installFilesByPath[path] = (file, info.chunkDownloadInfo)
      }
    }
    let retainedPaths = Set(installFilesByPath.keys)
    for sourceVersion in subBranch.diffTags {
      let plan = try updater.makePlan(
        sourceVersion: sourceVersion, installInfos: installInfos, updateInfos: updateInfos)
      var expectedPatchesByPath: [String: (info: PatchInfo, downloadInfo: SophonDownloadInfo)] = [:]
      for info in updateInfos {
        for file in info.manifest.files {
          if let patch = file.patches.first(where: { $0.key == sourceVersion }) {
            let path = baseGameDir.appendingPathComponent(file.filename).path.lowercased()
            expectedPatchesByPath[path] = (patch.info, info.diffDownloadInfo)
          }
        }
      }
      let expectedUpdatedPaths = Set(expectedPatchesByPath.keys)
      let plannedFiles = plan.patchBundles.flatMap { $0.patches.map(\.target) }
      #expect(plan.sourceVersion == sourceVersion)
      #expect(plannedFiles.count == expectedUpdatedPaths.count)
      #expect(Set(plannedFiles.map { $0.fileURL.path.lowercased() }) == expectedUpdatedPaths)
      for plannedFile in plan.installFiles + plannedFiles {
        let path = plannedFile.fileURL.path.lowercased()
        let target = try #require(installFilesByPath[path])
        #expect(plannedFile.fileURL == baseGameDir.appendingPathComponent(target.file.filename))
        #expect(plannedFile.size == UInt64(target.file.size))
        #expect(plannedFile.md5 == target.file.md5)
        #expect(plannedFile.installChunks.count == target.file.chunks.count)
        for (plannedChunk, chunk) in zip(plannedFile.installChunks, target.file.chunks) {
          #expect(plannedChunk.chunkID == chunk.chunkID)
          #expect(plannedChunk.uncompressedMd5 == chunk.md5)
          #expect(plannedChunk.compressedMd5 == chunk.compressedMd5)
          #expect(plannedChunk.compressedSize == UInt64(chunk.compressedSize))
          #expect(plannedChunk.uncompressedSize == UInt64(chunk.uncompressedSize))
          #expect(plannedChunk.downloadInfo.urlPrefix == target.downloadInfo.urlPrefix)
          #expect(plannedChunk.downloadInfo.urlSuffix == target.downloadInfo.urlSuffix)
          #expect(plannedChunk.downloadInfo.compression == target.downloadInfo.compression)
          #expect(plannedChunk.downloadInfo.encryption == target.downloadInfo.encryption)
          #expect(plannedChunk.downloadInfo.password == target.downloadInfo.password)
          #expect(plannedChunk.chunkApplicationInfos.count == 1)
          let application = try #require(plannedChunk.chunkApplicationInfos.first)
          #expect(application.fileURL == plannedFile.fileURL)
          #expect(application.offset == chunk.offset)
        }
      }

      #expect(plan.installFiles.count == expectedUpdatedPaths.count)
      #expect(
        Set(plan.installFiles.map { $0.fileURL.path.lowercased() }) == expectedUpdatedPaths)
      let expectedPatchIDs = Set(expectedPatchesByPath.values.map { $0.info.patchID })
      #expect(plan.patchBundles.count == expectedPatchIDs.count)
      #expect(Set(plan.patchBundles.map(\.patchID)) == expectedPatchIDs)
      for bundle in plan.patchBundles {
        #expect(bundle.patches.count > 0)
        let offsets = bundle.patches.map(\.patchOffset)
        #expect(offsets == offsets.sorted())
        for patch in bundle.patches {
          let expectedPatch = try #require(
            expectedPatchesByPath[patch.target.fileURL.path.lowercased()])
          #expect(bundle.patchID == expectedPatch.info.patchID)
          #expect(bundle.patchSize == UInt64(expectedPatch.info.patchSize))
          #expect(bundle.patchHash == expectedPatch.info.patchName)
          #expect(patch.patchOffset == UInt64(expectedPatch.info.patchOffset))
          #expect(patch.patchLength == UInt64(expectedPatch.info.patchLength))
          if expectedPatch.info.originalName.isEmpty {
            #expect(patch.original == nil)
          } else {
            let original = try #require(patch.original)
            #expect(
              original.fileURL
                == baseGameDir.appendingPathComponent(expectedPatch.info.originalName))
            #expect(original.size == UInt64(expectedPatch.info.originalSize))
            #expect(original.md5 == expectedPatch.info.originalHash)
          }
          #expect(bundle.downloadInfo.urlPrefix == expectedPatch.downloadInfo.urlPrefix)
          #expect(bundle.downloadInfo.urlSuffix == expectedPatch.downloadInfo.urlSuffix)
          #expect(bundle.downloadInfo.compression == expectedPatch.downloadInfo.compression)
          #expect(bundle.downloadInfo.encryption == expectedPatch.downloadInfo.encryption)
          #expect(bundle.downloadInfo.password == expectedPatch.downloadInfo.password)
        }
      }

      var expectedDeleteSizes: [String: UInt64] = [:]
      for deletion in updateInfos.flatMap({ $0.manifest.filesDelete })
      where deletion.key == sourceVersion {
        for file in deletion.info.list {
          let path = baseGameDir.appendingPathComponent(file.filename).path.lowercased()
          if !retainedPaths.contains(path) {
            expectedDeleteSizes[path] = UInt64(file.size)
          }
        }
      }
      let expectedDeletePaths = Set(expectedDeleteSizes.keys)
      #expect(plan.deleteFiles.count == expectedDeletePaths.count)
      #expect(Set(plan.deleteFiles.map { $0.fileURL.path.lowercased() }) == expectedDeletePaths)
      for file in plan.deleteFiles {
        let expectedSize = try #require(expectedDeleteSizes[file.fileURL.path.lowercased()])
        #expect(file.size == expectedSize)
      }
      #expect(plan.deleteSize == expectedDeleteSizes.values.reduce(UInt64(0), +))
      printUpdatePlanSummary(plan, gameID: gameID)
    }
  }
}

func testManifestParse(
  baseURL: String, sophonBaseURL: String, launcherID: String, gameList: [String]
) async throws {
  let cacheDir = getTestDataPath().appendingPathComponent("manifestCache")
  let installerTempDir = getTestDataPath().appendingPathComponent(
    "installerTemp-\(UUID().uuidString)")
  for gameID in gameList {
    let settings = SophonClientSettings(
      baseURL: baseURL, sophonBaseURL: sophonBaseURL,
      launcherID: launcherID, gameID: gameID,
      manifestCacheDir: cacheDir.path())
    let client = try await SophonClientv3(settings, baseGameDir: installerTempDir)
    let subBranch = try client.manifestManager.getGameSubbranch(predownload: false)

    let fullResourceCategory = subBranch.getGameBranchCategories(
      categoryScenario: GameBranchCategoryScenario.full,
      categoryType: GameBranchCategoryType.resource)
    let fullAudioCategory = subBranch.getGameBranchCategories(
      categoryScenario: GameBranchCategoryScenario.full, categoryType: GameBranchCategoryType.audio)

    for resource in fullAudioCategory {
      #expect(
        !fullResourceCategory.contains(where: { $0.matchingField == resource.matchingField }),
        "audio category and resource category must not overlap")
    }

    var installInfos: [(manifest: Manifest, chunkDownloadInfo: SophonDownloadInfo)] = []
    for matchingField in (fullResourceCategory + fullAudioCategory).map({ $0.matchingField }) {
      let (manifest, chunkDownloadInfo) = try await client.manifestManager.getSophonManifest(
        matchingField: matchingField)
      installInfos.append((manifest, chunkDownloadInfo))
      #expect(
        manifest.files.count > 0,
        "manifest with matching field \(matchingField) should not have no files")
      testManifestContents(manifest)

      if FileManager.default.fileExists(atPath: installerTempDir.path()) {
        try FileManager.default.removeItem(at: installerTempDir)
      }
      try FileManager.default.createDirectory(
        at: installerTempDir, withIntermediateDirectories: true)
    }
    try checkManifests(installInfos.map { $0.manifest })

    let installer = try Installer(
      baseGameDir: installerTempDir, maxCocurrentChecks: 8, maxCocurrentDownloads: 8,
      maxCocurrentPostProcessors: 8, maxCocurrentWrites: 8)
    let installationPlan = try await installer.scan(installInfos: installInfos)
    print("total chunk count for \(gameID): \(installationPlan.totalChunkCount)")
    print(
      "download size for \(gameID): \(Double(installationPlan.downloadSize) / 1_073_741_824) GiB")
    print(
      "disk write size for \(gameID): \(Double(installationPlan.diskWriteSize) / 1_073_741_824) GiB"
    )
  }
  try? FileManager.default.removeItem(at: installerTempDir)
}

@Test(.enabled(if: ProcessInfo.processInfo.environment["SOPHON_LIVE_TESTS"] == "1"))
func testOSManifestParse() async throws {
  try await testManifestParse(
    baseURL: HYPAPI_OS_BASE_URL, sophonBaseURL: SOPHON_API_OS_BASE_URL,
    launcherID: HYPAPI_OS_LAUNCHER_ID,
    gameList: [
      "U5hbdsT9W7",
      "4ziysqXOQ8",
      "gopR6Cufr3",
      "5TIVvvcwtM",
      "g0mMIvshDb",
      "uxB4MC7nzC",
      "bxPTXSET5t",
      "wkE5P5WsIf",
    ])
}

@Test(.enabled(if: ProcessInfo.processInfo.environment["SOPHON_LIVE_TESTS"] == "1"))
func testCNManifestParse() async throws {
  try await testManifestParse(
    baseURL: HYPAPI_CN_BASE_URL, sophonBaseURL: SOPHON_API_CN_BASE_URL,
    launcherID: HYPAPI_CN_LAUNCHER_ID,
    gameList: [
      "x6znKlJ0xK",
      "64kMb5iAWu",
      "1Z8W5NHUQb",
      "osvnlOc0S8",
    ])
}

@Test(.enabled(if: ProcessInfo.processInfo.environment["SOPHON_LIVE_TESTS"] == "1"))
func testOSDiffManifestParse() async throws {
  try await testDiffManifestParse(
    baseURL: HYPAPI_OS_BASE_URL, sophonBaseURL: SOPHON_API_OS_BASE_URL,
    launcherID: HYPAPI_OS_LAUNCHER_ID,
    gameList: [
      "U5hbdsT9W7",
      "4ziysqXOQ8",
      "gopR6Cufr3",
    ])
}

@Test(.enabled(if: ProcessInfo.processInfo.environment["SOPHON_LIVE_TESTS"] == "1"))
func testCNDiffManifestParse() async throws {
  try await testDiffManifestParse(
    baseURL: HYPAPI_CN_BASE_URL, sophonBaseURL: SOPHON_API_CN_BASE_URL,
    launcherID: HYPAPI_CN_LAUNCHER_ID,
    gameList: [
      "x6znKlJ0xK",
      "64kMb5iAWu",
      "1Z8W5NHUQb",
    ])
}

@Test(arguments: [
  "success", "missing", "wrong-version", "corrupt", "cancelled", "repair", "cache-install",
  "base-install",
])
func testSelectedFilesDownloadFixture(scenario: String) async throws {
  let base = URL(string: "https://transfer.invalid/\(UUID().uuidString)/")!
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: root) }
  let destination = root.appendingPathComponent("game")
  try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
  let previous = Data("previous".utf8)
  try previous.write(to: destination.appendingPathComponent("selected.bin"))
  try previous.write(to: destination.appendingPathComponent("config.ini"))
  let bytes = Data("selected content".utf8)
  let hash = md5Hex(bytes)
  var chunk = ChunkInfo()
  chunk.chunkID = "payload"
  chunk.md5 = hash
  chunk.compressedMd5 = hash
  chunk.uncompressedSize = UInt32(bytes.count)
  chunk.compressedSize = UInt32(bytes.count)
  var file = FileInfo()
  file.filename = "selected.bin"
  file.md5 = scenario == "corrupt" ? String(repeating: "0", count: 32) : hash
  file.size = Int32(bytes.count)
  file.chunks = [chunk]
  var unrelated = file
  unrelated.filename = "unrelated.bin"
  var manifest = Manifest()
  manifest.files = [file, unrelated]
  let manifestBytes = try manifest.serializedData()
  let identity = #"{"id":"fixture","biz":"fixture"}"#
  let scenarios = scenario == "base-install"
    ? #""CATEGORY_SCENARIO_FULL","CATEGORY_SCENARIO_BASE""# : #""CATEGORY_SCENARIO_FULL""#
  let branch = """
    {"package_id":"1","branch":"main","password":"","tag":"1.2.3","diff_tags":["1.2.2"],
    "categories":[{"category_id":"1","matching_field":"game","type":"CATEGORY_TYPE_RESOURCE",
    "scenarios":[\(scenarios)]}]}
    """
  var future = branch.replacingOccurrences(of: "main", with: "future")
    .replacingOccurrences(of: "1.2.3", with: "1.2.4")
  if scenario == "base-install" {
    future = future.replacingOccurrences(of: "1.2.2", with: "1.2.3")
  }
  let branches = """
    {"game_branches":[{"game":\(identity),"main":\(branch),"pre_download":\(future),
    "enable_base_pkg_predownload":false}]}
    """
  let configs = """
    {"launch_configs":[{"game":\(identity),"installation_dir":"game","exe_file_name":"game.exe",
    "audio_pkg_scan_dir":"","res_category_dir":"","wpf_exe_dir":"","wpf_pkg_version_dir":"",
    "enable_ldiff":\(scenario != "cache-install"),"enable_scenario_pkg":\(scenario == "base-install"),"enable_write_verify_result":false,
    "write_verify_result_path":""}]}
    """
  let stats = #"{"compressed_size":"1","uncompressed_size":"1","file_count":"2","chunk_count":"1"}"#
  let download = """
    {"encryption":false,"password":"","compression":false,
     "url_prefix":"\(base.absoluteString)","url_suffix":""}
    """
  let build = """
    {"build_id":"1","tag":"\(scenario == "wrong-version" ? "9.9.9" : "1.2.3")","manifests":[{
    "category_id":"1","category_name":"game","matching_field":"game",
    "manifest":{"id":"manifest","checksum":"\(md5Hex(manifestBytes))",
    "compressed_size":"\(manifestBytes.count)","uncompressed_size":"\(manifestBytes.count)"},
    "chunk_download":\(download),"manifest_download":\(download),
    "stats":\(stats),"deduplicated_stats":\(stats)}]}
    """
  let branchQuery: [URLQueryItem] = [
    .init(name: "package_id", value: "1"), .init(name: "branch", value: "main"),
    .init(name: "password", value: ""),
  ]
  let apiURLs = [
    base.appendingPathComponent("getGameConfigs").appending(queryItems: [
      .init(name: "launcher_id", value: "test")
    ]),
    base.appendingPathComponent("getGameBranches").appending(queryItems: [
      .init(name: "launcher_id", value: "test")
    ]),
    base.appendingPathComponent("getBuild").appending(
      queryItems: branchQuery + [.init(name: "tag", value: "1.2.3")]),
    base.appendingPathComponent("getBuild").appending(queryItems: branchQuery),
    base.appendingPathComponent("getBuild").appending(queryItems: [
      .init(name: "package_id", value: "1"), .init(name: "branch", value: "future"),
      .init(name: "password", value: ""),
    ]),
  ]
  let futureBuild = build.replacingOccurrences(of: "1.2.3", with: "1.2.4")
  for (url, data) in zip(apiURLs, [configs, branches, build, build, futureBuild]) {
    TransferURLProtocol.register(
      TransferHTTPFixture(Data("{\"retcode\":0,\"message\":\"\",\"data\":\(data)}".utf8)), at: url)
  }
  let manifestURL = base.appendingPathComponent("manifest")
  let payloadURL = base.appendingPathComponent("payload")
  TransferURLProtocol.register(TransferHTTPFixture(manifestBytes), at: manifestURL)
  let payload = TransferHTTPFixture(bytes, holdResponse: scenario == "cancelled")
  TransferURLProtocol.register(payload, at: payloadURL)
  defer {
    for url in apiURLs + [manifestURL, payloadURL] { TransferURLProtocol.remove(url) }
  }
  let configuration = URLSessionConfiguration.ephemeral
  configuration.protocolClasses = [TransferURLProtocol.self]
  var transfer = TransferSettings()
  transfer.cacheDirectory = root.appendingPathComponent("cache").path
  if scenario == "base-install" { transfer.preserveState = false }
  let client = try await SophonClientv3(
    SophonClientSettings(
      baseURL: base.absoluteString, sophonBaseURL: base.absoluteString,
      maxRetries: 0, retryInterval: 0, launcherID: "test", gameID: "fixture",
      manifestCacheDir: root.appendingPathComponent("manifests").path, logStdout: false,
      transfer: transfer), baseGameDir: destination, logger: nil, control: nil,
    metadataSession: URLSession(configuration: configuration), payloadConfiguration: configuration)
  if scenario == "base-install" {
    let config = destination.appendingPathComponent("config.ini")
    let original = "\u{feff}[General]\r\nchannel=1\r\n"
    try original.write(to: config, atomically: true, encoding: .utf8)
    await #expect(throws: SelectionError.self) {
      try await client.install(mode: .base, expectedVersion: "1.2.2")
    }
    #expect(try Data(contentsOf: destination.appendingPathComponent("selected.bin")) == previous)
    #expect(try Data(contentsOf: config) == Data(original.utf8))

    try await client.install(mode: .base, expectedVersion: "1.2.3")
    #expect(try await SophonClientv3.savedInstallationState(at: destination, settings: transfer) == nil)
    let updatedConfig = String(decoding: try Data(contentsOf: config), as: UTF8.self)
    #expect(updatedConfig.hasPrefix("\u{feff}[General]\r\n"))
    #expect(updatedConfig.contains("sophon_install_mode=CATEGORY_SCENARIO_BASE\r\n"))
    #expect(updatedConfig.contains("channel=1\r\n"))
    let update = try await client.nextAction(installedVersionHint: "1.2.2")
    #expect(update.action == .update && update.mode == .base)
    let predownload = try await client.nextAction(installedVersionHint: "1.2.3")
    #expect(predownload.action == .cacheUpdate && predownload.mode == .base)
    return
  }
  if scenario == "cache-install" {
    let info = try await client.onlineBuild()
    #expect(info.predownloadVersion == "1.2.4" && info.predownloadFrom == nil)
    #expect(try await client.nextAction(installedVersionHint: "1.2.2").action == .install)
    #expect(try await client.nextAction(installedVersionHint: "1.2.3").action == .cacheUpdate)
    #expect(try await client.nextAction(installedVersionHint: "1.2.5").action == .none)
    #expect(try await !client.usesDiffUpdate(from: "1.2.3", predownload: true))
    await #expect(throws: SelectionError.self) {
      try await client.cacheInstallation(
        mode: .full, reporter: client.makeInstallationReporter(), expectedVersion: "1.2.5")
    }
    try await client.cacheInstallation(
      mode: .full, reporter: client.makeInstallationReporter(), expectedVersion: "1.2.4")
    let requests = payload.ranges
    #expect(requests.count == 1)
    #expect(try Data(contentsOf: destination.appendingPathComponent("selected.bin")) == previous)
    #expect(try Data(contentsOf: destination.appendingPathComponent("config.ini")) == previous)
    #expect(try await !client.hasUnfinishedWrite())
    try await client.install(mode: .full)
    #expect(try Data(contentsOf: destination.appendingPathComponent("selected.bin")) == bytes)
    #expect(try Data(contentsOf: destination.appendingPathComponent("unrelated.bin")) == bytes)
    #expect(payload.ranges == requests)
    return
  }
  if scenario == "repair" {
    let info = try await client.onlineBuild()
    #expect(info.version == "1.2.3" && info.installSize == 1 && info.updatableVersions == ["1.2.2"])
    let reporter = client.makeInstallationReporter()
    try await client.verifyLive(
      mode: .full, installedVersion: "1.2.3", quick: true, reporter: reporter)
    #expect(try Data(contentsOf: destination.appendingPathComponent("unrelated.bin")) == bytes)
    #expect(
      try String(contentsOf: destination.appendingPathComponent("config.ini"), encoding: .utf8)
        .contains("game_version=1.2.3"))
    return
  }
  if scenario == "success" {
    let listing = try await client.listFiles(version: "1.2.3", path: "selected.bin")
    #expect(listing.files.map(\.filename) == ["selected.bin"])
    try await client.downloadFiles(version: "1.2.3", categories: ["game"], files: ["selected.bin"])
  } else if scenario == "cancelled" {
    let operation = Task {
      try await client.downloadFiles(
        version: "1.2.3", categories: ["game"], files: ["selected.bin"])
    }
    for _ in 0..<100 {
      if !payload.ranges.isEmpty { break }
      try await Task.sleep(for: .milliseconds(10))
    }
    #expect(!payload.ranges.isEmpty)
    operation.cancel()
    await #expect(throws: CancellationError.self) { try await operation.value }
  } else {
    await #expect(throws: SelectionError.self) {
      try await client.downloadFiles(
        version: "1.2.3", categories: ["game"],
        files: [scenario == "missing" ? "missing.bin" : "selected.bin"])
    }
  }
  #expect(
    try Data(contentsOf: destination.appendingPathComponent("selected.bin"))
      == (scenario == "success" ? bytes : previous))
  #expect(try Data(contentsOf: destination.appendingPathComponent("config.ini")) == previous)
  #expect(
    !FileManager.default.fileExists(
      atPath: destination.appendingPathComponent("unrelated.bin").path))
  #expect(
    try FileManager.default.contentsOfDirectory(atPath: destination.path).allSatisfy {
      !$0.hasPrefix(".sophon-selection-")
    })
}
