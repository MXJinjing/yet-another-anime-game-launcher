import Crypto
import Foundation

struct OriginalSnapshot: Sendable {
  let input: PatchInput?
  let observed: FileDigest?
  let fromSavedOriginal: Bool
}

actor OriginalSnapshots {
  private let cache: BinaryCache
  private let directory: URL
  private let io: WorkLimiter
  private let targets: [URL: PlannedUpdateFile]
  private let durableSources: Set<URL>
  private let sharedSources: Set<URL>
  private let cacheOnly: Bool
  private let telemetry: TransferTelemetry?
  private var references: [String: Int]
  private var tasks: [String: Task<OriginalSnapshot, any Error>] = [:]
  private var diskSizes: [String: UInt64]

  init(
    cache: BinaryCache, directory: URL, io: WorkLimiter,
    plan: UpdatePlan, writeMode: UpdateWriteMode, existingSizes: [String: UInt64],
    cacheOnly: Bool = false, telemetry: TransferTelemetry? = nil, diskCacheEnabled: Bool = true
  ) {
    self.cache = cache
    self.directory = directory
    self.io = io
    self.cacheOnly = cacheOnly
    self.telemetry = telemetry
    targets = Dictionary(uniqueKeysWithValues: plan.installFiles.map { ($0.fileURL, $0) })
    let patches = plan.patchBundles.flatMap(\.patches)
    let targetPaths = Set(plan.installFiles.map(\.fileURL))
    sharedSources = Set(
      patches.compactMap { patch in
        guard !cacheOnly, let original = patch.original, targetPaths.contains(original.fileURL),
          original.fileURL != patch.target.fileURL
        else { return nil }
        return original.fileURL
      })
    durableSources = Set(
      patches.compactMap { patch in
        guard !cacheOnly, diskCacheEnabled, let original = patch.original else { return nil }
        if writeMode == .inPlace
          || (targetPaths.contains(original.fileURL) && original.fileURL != patch.target.fileURL)
        {
          return original.fileURL
        }
        return nil
      })
    references = [:]
    for source in patches.compactMap(\.original) {
      references[Self.key(source), default: 0] += 1
    }
    diskSizes = existingSizes
  }

  static func existingSizes(directory: URL) throws -> [String: UInt64] {
    guard FileManager.default.fileExists(atPath: directory.path) else { return [:] }
    var result: [String: UInt64] = [:]
    for file in try FileManager.default.contentsOfDirectory(
      at: directory, includingPropertiesForKeys: [.fileSizeKey])
    where file.pathExtension == "original" {
      result[file.deletingPathExtension().lastPathComponent] = UInt64(
        try file.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0)
    }
    return result
  }

  private static func key(_ source: PlannedPatchSource) -> String {
    transferKey("\(source.fileURL.path):\(source.size):\(source.md5.lowercased())")
  }

  func preloadSharedSources(_ plan: UpdatePlan) async throws {
    for source in plan.patchBundles.flatMap(\.patches).compactMap(\.original)
    where sharedSources.contains(source.fileURL) && references[Self.key(source), default: 0] > 0 {
      _ = try await get(source)
    }
  }

  func get(_ source: PlannedPatchSource) async throws -> OriginalSnapshot {
    let key = Self.key(source)
    if let task = tasks[key] { return try await task.value }
    let durable = !cacheOnly && (durableSources.contains(source.fileURL) || diskSizes[key] != nil)
    if durable { diskSizes[key] = source.size }
    let savedURL = directory.appendingPathComponent(key + ".original")
    let candidate = targets[source.fileURL]
    let task = Task { [cache, io, cacheOnly, telemetry] in
      if durable,
        let digest = try await io.withPermit({
          try await runTransferIO {
            try digestFile(
              savedURL, telemetry: telemetry,
              device: telemetry?.register(savedURL, role: "Recovery"), isCache: true)
          }
        }),
        digest.size == source.size, digest.md5 == source.md5.lowercased()
      {
        let writer = try await cache.makeWriter(
          expectedSize: source.size, fileURL: savedURL, forceDisk: true, preserveFile: true)
        try writer.restoreRanges([0..<source.size])
        return OriginalSnapshot(
          input: .cached(try await writer.finish()), observed: digest, fromSavedOriginal: true)
      }
      if durable {
        try await runTransferIO { try removeOwnedFile(savedURL) }
        await cache.removedRetainedFile(savedURL)
      }
      let writer =
        cacheOnly
        ? nil
        : try await cache.makeWriter(
          expectedSize: source.size, fileURL: durable ? savedURL : nil,
          forceDisk: durable, preserveFile: durable)
      do {
        let digest = try await io.withPermit {
          try await Self.capture(
            source, candidate: candidate, writer: writer, telemetry: telemetry)
        }
        if digest?.size == source.size, digest?.md5 == source.md5.lowercased() {
          let input: PatchInput?
          if cacheOnly {
            input = nil
          } else if let writer {
            input = .cached(try await writer.finish())
          } else {
            input = nil
          }
          return OriginalSnapshot(input: input, observed: digest, fromSavedOriginal: false)
        }
        try? await writer?.abort()
        if durable { try await runTransferIO { try removeOwnedFile(savedURL) } }
        return OriginalSnapshot(input: nil, observed: digest, fromSavedOriginal: false)
      } catch {
        try? await writer?.abort()
        throw error
      }
    }
    tasks[key] = task
    return try await withTaskCancellationHandler {
      try await task.value
    } onCancel: {
      task.cancel()
    }
  }

  private static func capture(
    _ source: PlannedPatchSource, candidate: PlannedUpdateFile?, writer: CachedBinaryWriter?,
    telemetry: TransferTelemetry?
  ) async throws -> FileDigest? {
    let opened: (FileHandle, UInt64)? = try await runTransferIO {
      let handle: FileHandle
      do { handle = try FileHandle(forReadingFrom: source.fileURL) } catch {
        if isMissingFile(error) { return nil }
        throw error
      }
      return (handle, try handle.seekToEnd())
    }
    guard let (handle, size) = opened else { return nil }
    defer { transferIOQueue.async { try? handle.close() } }
    guard size == source.size || size == candidate?.size else {
      return FileDigest(size: size, md5: "")
    }
    try await runTransferIO { try handle.seek(toOffset: 0) }
    var hasher = Insecure.MD5()
    var offset: UInt64 = 0
    let device = telemetry?.register(source.fileURL, role: "Target") ?? ""
    while let data = try await runTransferIO({ try handle.read(upToCount: 1024 * 1024) }),
      !data.isEmpty
    {
      hasher.update(data: data)
      telemetry?.read(UInt64(data.count), device: device)
      if size == source.size {
        try await writer?.write(data, at: offset)
      }
      offset += UInt64(data.count)
    }
    return FileDigest(
      size: offset, md5: hasher.finalize().map { String(format: "%02x", $0) }.joined())
  }

  func consumed(_ source: PlannedPatchSource) async throws {
    let key = Self.key(source)
    references[key, default: 1] -= 1
    guard references[key] == 0 else { return }
    if let task = tasks.removeValue(forKey: key),
      let snapshot = try? await task.value, case .cached(let binary)? = snapshot.input
    {
      try await runTransferIO(checkCancellation: false) { try binary.remove() }
    }
    if !cacheOnly, diskSizes[key] != nil {
      let fileURL = directory.appendingPathComponent(key + ".original")
      try await runTransferIO(checkCancellation: false) { try removeOwnedFile(fileURL) }
      await cache.removedRetainedFile(fileURL)
      diskSizes.removeValue(forKey: key)
    }
  }

  func cancel() { for task in tasks.values { task.cancel() } }

  func requiresDisk(_ source: PlannedPatchSource) -> Bool {
    durableSources.contains(source.fileURL) || diskSizes[Self.key(source)] != nil
  }

  func additionalDiskBytes(_ source: PlannedPatchSource) -> UInt64 {
    source.size - min(source.size, diskSizes[Self.key(source)] ?? 0)
  }

  func close() async {
    for task in tasks.values { task.cancel() }
    for task in tasks.values { _ = try? await task.value }
    tasks.removeAll()
  }
}
