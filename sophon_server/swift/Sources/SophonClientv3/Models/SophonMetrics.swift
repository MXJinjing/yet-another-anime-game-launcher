import Foundation

public struct DownloadByteProgress: Codable, Sendable {
  public let id: String
  public let category: String
  public let totalBytes: UInt64
  public internal(set) var receivedBytes: UInt64
  public internal(set) var retainedBytes: UInt64
  public internal(set) var transferredBytes: UInt64
}

public struct SophonMetric: Codable, Sendable {
  public internal(set) var completed: UInt64 = 0
  public internal(set) var total: UInt64?
  public internal(set) var remaining: UInt64?
  public internal(set) var percentage: Double?
  public internal(set) var elapsedSeconds: Double = 0
  public internal(set) var rate: Double?
  public internal(set) var averageRate: Double?
  public internal(set) var etaSeconds: Double?
  public internal(set) var isFinished = false
}

public struct SophonTiming: Codable, Sendable {
  public internal(set) var elapsedSeconds: Double = 0
  public internal(set) var stageElapsedSeconds: Double = 0
  public internal(set) var phaseDurations: [String: Double] = [:]
  public internal(set) var etaSeconds: Double?
}

public struct SophonMetadataMetrics: Codable, Sendable {
  public internal(set) var manifests = SophonMetric()
  public internal(set) var installationManifests = SophonMetric()
  public internal(set) var diffManifests = SophonMetric()
  public internal(set) var planning = SophonMetric()
}

public struct SophonDeviceMetrics: Codable, Sendable {
  public let id: String
  public let location: String
  public let roles: [String]
  public let cacheBytes: UInt64
  public let reservedCacheBytes: UInt64
  public let read: SophonMetric
  public let write: SophonMetric
}

public struct SophonIOMetrics: Codable, Sendable {
  public let read: SophonMetric
  public let write: SophonMetric
}

public struct SophonResourceMetrics: Codable, Sendable {
  public let memoryBytes: UInt64
  public let memoryLimit: UInt64
  public let diskLimit: UInt64
  public let diskReservedBytes: UInt64
  public let devices: [SophonDeviceMetrics]
  public let downloads: [DownloadByteProgress]
  public let memoryCache: SophonIOMetrics
  public let diskCache: SophonIOMetrics
  public let target: SophonIOMetrics
}

public struct SophonMetrics: Codable, Sendable {
  public internal(set) var timing = SophonTiming()
  public internal(set) var metadata = SophonMetadataMetrics()
  public internal(set) var network = SophonMetric()
  public internal(set) var read = SophonMetric()
  public internal(set) var write = SophonMetric()
  public internal(set) var files = SophonMetric()
  public internal(set) var resources: SophonResourceMetrics?
}

public struct SophonVerificationMetrics: Codable, Sendable {
  public internal(set) var bytes = SophonMetric()
  public internal(set) var chunks = SophonMetric()
  public internal(set) var files = SophonMetric()
  public internal(set) var missingFiles: UInt64 = 0
  public internal(set) var brokenFiles: UInt64 = 0
}

public struct SophonProcessingMetrics: Codable, Sendable {
  public internal(set) var chunks = SophonMetric()
  public internal(set) var bytes: UInt64 = 0
}

public struct InstallationMetrics: Codable, Sendable {
  public internal(set) var common = SophonMetrics()
  public internal(set) var verification = SophonVerificationMetrics()
  public internal(set) var trimming = SophonMetric()
  public internal(set) var download = SophonMetric()
  public internal(set) var downloadedChunks: UInt64 = 0
  public internal(set) var processing = SophonProcessingMetrics()
  public internal(set) var retries: UInt64 = 0
}

public struct SophonPatchMetrics: Codable, Sendable {
  public internal(set) var data = SophonMetric()
  public internal(set) var network = SophonMetric()
  public internal(set) var retainedBytes: UInt64 = 0
  public internal(set) var verifiedBytes: UInt64 = 0
  public internal(set) var bundlesReady: UInt64 = 0
}

public struct SophonRepairMetrics: Codable, Sendable {
  public internal(set) var download = SophonMetric()
  public internal(set) var write = SophonMetric()
  public internal(set) var files: UInt64 = 0
}

public struct SophonDeletionMetrics: Codable, Sendable {
  public internal(set) var files = SophonMetric()
  public internal(set) var bytes = SophonMetric()
}

public struct UpdateMetrics: Codable, Sendable {
  public internal(set) var common = SophonMetrics()
  public internal(set) var patch = SophonPatchMetrics()
  public internal(set) var repair = SophonRepairMetrics()
  public internal(set) var deletion = SophonDeletionMetrics()
  public internal(set) var skippedFiles: UInt64 = 0
  public internal(set) var cachedFiles: UInt64 = 0
}

// Sampling is driven by work updates and snapshot reads, never by an owned timer.
struct SophonMeter: Sendable {
  var value: UInt64 = 0
  var total: UInt64?
  private var started: Double = 0
  private var baseline: UInt64 = 0
  private var ended: Double?
  private var samples: [(time: Double, value: UInt64)] = [(0, 0)]

  mutating func start(at time: Double) {
    started = time
    baseline = value
    ended = nil
    samples = [(time, value)]
  }

  mutating func setTotal(_ count: UInt64) { total = count }

  mutating func advance(_ count: UInt64, at time: Double) { set(value + count, at: time) }

  mutating func set(_ count: UInt64, at time: Double) {
    if count < value {
      start(at: time)
      baseline = count
      samples = [(time, count)]
    }
    value = count
    sample(at: time)
  }

  private mutating func sample(at time: Double) {
    guard ended == nil else { return }
    while samples.count > 1, samples[1].time <= time - 5 { samples.removeFirst() }
    samples[0].time = max(samples[0].time, time - 5)
    // Bounded time bins keep high event rates from allocating a sample per event.
    if let last = samples.last, time - last.time < 0.05 { return }
    samples.append((time, value))
    if samples.count > 256 { samples.removeFirst(samples.count - 256) }
  }

  mutating func finish(at time: Double) {
    guard ended == nil else { return }
    sample(at: time)
    ended = time
  }

  mutating func snapshot(at time: Double) -> SophonMetric {
    let time = ended ?? time
    sample(at: time)
    let elapsed = max(0, time - started)
    let interval = samples.first.map { time - $0.time } ?? 0
    let rate = interval >= 0.25 ? Double(value - min(value, samples[0].value)) / interval : nil
    let average = elapsed >= 0.25 ? Double(value - min(value, baseline)) / elapsed : nil
    let remaining = total.map { $0 - min($0, value) }
    let eta: Double? =
      remaining == 0
      ? 0
      : ended != nil
        ? nil
        : remaining.flatMap { remaining in
          rate.flatMap { $0 > 0 ? Double(remaining) / $0 : nil }
        }
    return SophonMetric(
      completed: value, total: total, remaining: remaining,
      percentage: total.map { $0 == 0 ? 100 : min(100, Double(value) / Double($0) * 100) },
      elapsedSeconds: elapsed, rate: rate, averageRate: average, etaSeconds: eta,
      isFinished: ended != nil)
  }
}

struct SophonMetricsState: Sendable {
  private let origin = ContinuousClock.now
  private var phase = "metadata"
  private var phaseStart: Double = 0
  private var ended: Double?
  private var durations: [String: Double] = [:]
  var manifests = SophonMeter()
  var installationManifests = SophonMeter()
  var diffManifests = SophonMeter()
  var planning = SophonMeter()
  var network = SophonMeter()
  var read = SophonMeter()
  var write = SophonMeter()
  var files = SophonMeter()
  var resources: TransferResourceProgress?
  var resourceSource: (@Sendable () -> TransferResourceProgress)?
  private var deviceReads: [String: SophonMeter] = [:]
  private var deviceWrites: [String: SophonMeter] = [:]
  private var memoryCacheRead = SophonMeter()
  private var memoryCacheWrite = SophonMeter()
  private var diskCacheRead = SophonMeter()
  private var diskCacheWrite = SophonMeter()
  private var targetRead = SophonMeter()
  private var targetWrite = SophonMeter()

  var now: Double {
    if let ended { return ended }
    let duration = origin.duration(to: .now).components
    return Double(duration.seconds) + Double(duration.attoseconds) / 1e18
  }

  mutating func planManifests(installation: Int, diff: Int, at time: Double) {
    manifests.start(at: time)
    installationManifests.start(at: time)
    diffManifests.start(at: time)
    manifests.setTotal(UInt64(installation + diff))
    installationManifests.setTotal(UInt64(installation))
    diffManifests.setTotal(UInt64(diff))
    if installation + diff == 0 { manifests.finish(at: time) }
    if installation == 0 { installationManifests.finish(at: time) }
    if diff == 0 { diffManifests.finish(at: time) }
  }

  mutating func manifestLoaded(isDiff: Bool, at time: Double) {
    manifests.advance(1, at: time)
    if manifests.value == manifests.total { manifests.finish(at: time) }
    if isDiff {
      diffManifests.advance(1, at: time)
      if diffManifests.value == diffManifests.total { diffManifests.finish(at: time) }
    } else {
      installationManifests.advance(1, at: time)
      if installationManifests.value == installationManifests.total {
        installationManifests.finish(at: time)
      }
    }
  }

  mutating func changePhase(_ next: String, at time: Double) {
    guard next != phase else { return }
    durations[phase, default: 0] += time - phaseStart
    if phase == "metadata" {
      manifests.finish(at: time)
      installationManifests.finish(at: time)
      diffManifests.finish(at: time)
    }
    phase = next
    phaseStart = time
  }

  mutating func syncResources(at time: Double, scanReadBytes: UInt64 = 0) {
    guard let source = resourceSource else { return }
    let value = source()
    resources = value
    memoryCacheRead.set(value.memoryCache.readBytes, at: time)
    memoryCacheWrite.set(value.memoryCache.writtenBytes, at: time)
    diskCacheRead.set(value.diskCache.readBytes, at: time)
    diskCacheWrite.set(value.diskCache.writtenBytes, at: time)
    network.set(value.downloadTotals.values.reduce(0) { $0 + $1.transferredBytes }, at: time)
    read.set(scanReadBytes + value.devices.reduce(0) { $0 + $1.readBytes }, at: time)
    targetRead.set(read.value - min(read.value, value.diskCache.readBytes), at: time)
    let written = value.devices.reduce(UInt64(0)) { $0 + $1.writtenBytes }
    targetWrite.set(written - min(written, value.diskCache.writtenBytes), at: time)
    for device in value.devices {
      deviceReads[device.id, default: SophonMeter()].set(device.readBytes, at: time)
      deviceWrites[device.id, default: SophonMeter()].set(device.writtenBytes, at: time)
    }
  }

  mutating func finish(at time: Double) {
    guard ended == nil else { return }
    ended = time
    durations[phase, default: 0] += time - phaseStart
    resourceSource = nil
    manifests.finish(at: time)
    installationManifests.finish(at: time)
    diffManifests.finish(at: time)
    planning.finish(at: time)
    network.finish(at: time)
    read.finish(at: time)
    write.finish(at: time)
    files.finish(at: time)
    memoryCacheRead.finish(at: time)
    memoryCacheWrite.finish(at: time)
    diskCacheRead.finish(at: time)
    diskCacheWrite.finish(at: time)
    targetRead.finish(at: time)
    targetWrite.finish(at: time)
    for key in deviceReads.keys { deviceReads[key]?.finish(at: time) }
    for key in deviceWrites.keys { deviceWrites[key]?.finish(at: time) }
  }

  mutating func snapshot(at time: Double, eta: Double?) -> SophonMetrics {
    let resources = resources.map { value in
      SophonResourceMetrics(
        memoryBytes: value.memoryBytes, memoryLimit: value.memoryLimit, diskLimit: value.diskLimit,
        diskReservedBytes: value.devices.reduce(0) { $0 + $1.reservedCacheBytes },
        devices: value.devices.map { device in
          SophonDeviceMetrics(
            id: device.id, location: device.location, roles: device.roles,
            cacheBytes: device.cacheBytes, reservedCacheBytes: device.reservedCacheBytes,
            read: deviceReads[device.id, default: SophonMeter()].snapshot(at: time),
            write: deviceWrites[device.id, default: SophonMeter()].snapshot(at: time))
        }, downloads: value.downloads,
        memoryCache: SophonIOMetrics(
          read: memoryCacheRead.snapshot(at: time), write: memoryCacheWrite.snapshot(at: time)),
        diskCache: SophonIOMetrics(
          read: diskCacheRead.snapshot(at: time), write: diskCacheWrite.snapshot(at: time)),
        target: SophonIOMetrics(
          read: targetRead.snapshot(at: time), write: targetWrite.snapshot(at: time)))
    }
    return SophonMetrics(
      timing: SophonTiming(
        elapsedSeconds: time, stageElapsedSeconds: max(0, time - phaseStart),
        phaseDurations: durations, etaSeconds: eta),
      metadata: SophonMetadataMetrics(
        manifests: manifests.snapshot(at: time),
        installationManifests: installationManifests.snapshot(at: time),
        diffManifests: diffManifests.snapshot(at: time), planning: planning.snapshot(at: time)),
      network: network.snapshot(at: time), read: read.snapshot(at: time),
      write: write.snapshot(at: time), files: files.snapshot(at: time), resources: resources)
  }
}

func sophonETA(_ estimates: [Double?]) -> Double? {
  estimates.allSatisfy { $0 != nil } ? estimates.compactMap { $0 }.max() : nil
}
