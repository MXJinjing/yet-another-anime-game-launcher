import Foundation

#if canImport(Darwin)
  import Darwin
#elseif canImport(Glibc)
  import Glibc
#endif

struct StorageByteProgress: Sendable {
  let id: String
  let location: String
  var roles: [String]
  var readBytes: UInt64 = 0
  var writtenBytes: UInt64 = 0
  var cacheBytes: UInt64 = 0
  var reservedCacheBytes: UInt64 = 0
}

struct TransferDownloadTotals: Sendable {
  var receivedBytes: UInt64 = 0
  var retainedBytes: UInt64 = 0
  var transferredBytes: UInt64 = 0
}

struct CacheByteProgress: Sendable {
  var readBytes: UInt64 = 0
  var writtenBytes: UInt64 = 0
}

struct TransferResourceProgress: Sendable {
  let memoryBytes: UInt64
  let memoryLimit: UInt64
  let diskLimit: UInt64
  let devices: [StorageByteProgress]
  let downloads: [DownloadByteProgress]
  let memoryCache: CacheByteProgress
  let diskCache: CacheByteProgress

  let downloadTotals: [String: TransferDownloadTotals]

  var receivedBytes: UInt64 { downloadTotals["patch"]?.receivedBytes ?? 0 }
  var retainedBytes: UInt64 { downloadTotals["patch"]?.retainedBytes ?? 0 }
  var transferredBytes: UInt64 { downloadTotals["patch"]?.transferredBytes ?? 0 }

}

// I/O callbacks update live counters. Reporters read them on demand without a publishing timer.
final class TransferTelemetry: @unchecked Sendable {
  private let lock = NSLock()
  private let memoryLimit: UInt64
  private let diskLimit: UInt64
  private var memoryBytes: UInt64 = 0
  private var memoryCache = CacheByteProgress()
  private var diskCache = CacheByteProgress()
  private var devices: [String: StorageByteProgress] = [:]
  private var locations: [String: String] = [:]
  private var downloads: [String: DownloadByteProgress] = [:]
  private var patchIDs: Set<String> = []
  private var downloadTotals: [String: TransferDownloadTotals] = [:]

  init(memoryLimit: UInt64, diskLimit: UInt64) {
    self.memoryLimit = memoryLimit
    self.diskLimit = diskLimit
  }

  @discardableResult
  func register(_ url: URL, role: String) -> String {
    let path = url.standardizedFileURL.resolvingSymlinksInPath().path
    if let known = lock.withLock({ locations[path] }) {
      lock.withLock {
        if !devices[known]!.roles.contains(role) { devices[known]!.roles.append(role) }
      }
      return known
    }
    let (id, location) = Self.storage(at: url)
    lock.withLock {
      locations[path] = id
      if devices[id] == nil {
        devices[id] = StorageByteProgress(id: id, location: location, roles: [])
      }
      if !devices[id]!.roles.contains(role) { devices[id]!.roles.append(role) }
    }
    return id
  }

  func read(_ bytes: UInt64, device: String) {
    lock.withLock { devices[device]?.readBytes += bytes }
  }

  func write(_ bytes: UInt64, device: String) {
    lock.withLock { devices[device]?.writtenBytes += bytes }
  }

  func cacheRead(_ bytes: UInt64, inMemory: Bool, device: String = "") {
    lock.withLock {
      if inMemory {
        memoryCache.readBytes += bytes
      } else {
        diskCache.readBytes += bytes
        devices[device]?.readBytes += bytes
      }
    }
  }

  func cacheWrite(_ bytes: UInt64, inMemory: Bool, device: String = "") {
    lock.withLock {
      if inMemory {
        memoryCache.writtenBytes += bytes
      } else {
        diskCache.writtenBytes += bytes
        devices[device]?.writtenBytes += bytes
      }
    }
  }

  func reserve(_ bytes: UInt64, inMemory: Bool, device: String) {
    lock.withLock {
      if inMemory { memoryBytes += bytes } else { devices[device]?.reservedCacheBytes += bytes }
    }
  }

  func release(_ bytes: UInt64, inMemory: Bool, device: String) {
    lock.withLock {
      if inMemory {
        memoryBytes -= min(memoryBytes, bytes)
      } else if let value = devices[device]?.reservedCacheBytes {
        devices[device]?.reservedCacheBytes -= min(value, bytes)
      }
    }
  }

  func stored(_ bytes: UInt64, device: String) {
    lock.withLock { devices[device]?.cacheBytes += bytes }
  }

  func removed(_ bytes: UInt64, device: String) {
    lock.withLock {
      if let value = devices[device]?.cacheBytes {
        devices[device]?.cacheBytes -= min(value, bytes)
      }
    }
  }

  // Called under the lock; aggregate updates avoid scanning every installation chunk.
  private func storeDownload(_ value: DownloadByteProgress) {
    if let old = downloads[value.id] {
      downloadTotals[old.category]!.receivedBytes -= old.receivedBytes
      downloadTotals[old.category]!.retainedBytes -= old.retainedBytes
    }
    downloads[value.id] = value
    downloadTotals[value.category, default: TransferDownloadTotals()].receivedBytes +=
      value.receivedBytes
    downloadTotals[value.category]!.retainedBytes += value.retainedBytes
    if value.category == "patch" { patchIDs.insert(value.id) } else { patchIDs.remove(value.id) }
  }

  func planDownload(_ id: String, size: UInt64, retained: UInt64, category: String = "patch") {
    lock.withLock {
      storeDownload(
        DownloadByteProgress(
          id: id, category: category, totalBytes: size, receivedBytes: min(size, retained),
          retainedBytes: min(size, retained),
          transferredBytes: downloads[id]?.category == category
            ? downloads[id]!.transferredBytes : 0))
    }
  }

  func receive(_ bytes: UInt64, committed: UInt64, id: String) {
    lock.withLock {
      guard var value = downloads[id] else { return }
      value.transferredBytes += bytes
      value.receivedBytes = min(value.totalBytes, committed)
      downloadTotals[value.category]!.transferredBytes += bytes
      storeDownload(value)
    }
  }

  func resetDownload(_ id: String) {
    lock.withLock {
      guard var value = downloads[id] else { return }
      value.receivedBytes = 0
      value.retainedBytes = 0
      storeDownload(value)
    }
  }

  func ready(_ id: String) {
    lock.withLock {
      guard var value = downloads[id] else { return }
      value.receivedBytes = value.totalBytes
      storeDownload(value)
    }
  }

  func snapshot() -> TransferResourceProgress {
    lock.withLock {
      TransferResourceProgress(
        memoryBytes: memoryBytes, memoryLimit: memoryLimit, diskLimit: diskLimit,
        devices: devices.values.sorted { $0.id < $1.id },
        downloads: patchIDs.compactMap { downloads[$0] }.sorted { $0.id < $1.id },
        memoryCache: memoryCache, diskCache: diskCache,
        downloadTotals: downloadTotals)
    }
  }

  private static func storage(at url: URL) -> (String, String) {
    var current = url.standardizedFileURL.resolvingSymlinksInPath()
    #if canImport(Darwin) || canImport(Glibc)
      var info = stat()
      while stat(current.path, &info) != 0, current.path != "/" {
        current.deleteLastPathComponent()
      }
      let device = info.st_dev
      var mount = current
      while mount.path != "/" {
        let parent = mount.deletingLastPathComponent()
        var parentInfo = stat()
        guard stat(parent.path, &parentInfo) == 0, parentInfo.st_dev == device else { break }
        mount = parent
      }
      return (String(describing: device), mount.path)
    #else
      let volume = try? current.resourceValues(forKeys: [.volumeURLKey])
      let root = volume?.volume ?? current
      return (root.path, root.path)
    #endif
  }
}
