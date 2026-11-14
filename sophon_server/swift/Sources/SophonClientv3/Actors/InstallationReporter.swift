import Foundation
import Logging

public actor InstallationReporter: OperationReportingInternal {
  public typealias Event = InstallationEvent
  public typealias Progress = InstallationProgress
  internal let logger: Logger
  internal var progress = InstallationProgress()
  internal var subscribers: [UUID: AsyncStream<InstallationEvent>.Continuation] = [:]
  private var common = SophonMetricsState()
  private var verificationBytes = SophonMeter()
  private var verificationChunks = SophonMeter()
  private var verificationFiles = SophonMeter()
  private var trimming = SophonMeter()
  private var download = SophonMeter()
  private var processing = SophonMeter()
  private var readBytes: UInt64 = 0
  private var missingFiles: UInt64 = 0
  private var brokenFiles: UInt64 = 0
  private var trimFiles: UInt64 = 0
  private var downloadedChunks: UInt64 = 0
  private var processedBytes: UInt64 = 0
  private var retries: UInt64 = 0

  public init(logger: Logger) { self.logger = logger }

  internal func useResources(_ telemetry: TransferTelemetry) {
    common.resourceSource = { telemetry.snapshot() }
  }

  private func syncResources(at time: Double) {
    common.syncResources(at: time, scanReadBytes: readBytes)
    if let resources = common.resources {
      download.set(
        resources.downloadTotals["install"]?.receivedBytes ?? 0,
        at: time)
    }
  }

  public func snapshot() -> InstallationProgress {
    let time = common.now
    syncResources(at: time)
    let verification = SophonVerificationMetrics(
      bytes: verificationBytes.snapshot(at: time), chunks: verificationChunks.snapshot(at: time),
      files: verificationFiles.snapshot(at: time), missingFiles: missingFiles,
      brokenFiles: brokenFiles)
    var downloads = download.snapshot(at: time)
    let network = common.network.snapshot(at: time)
    if common.resources != nil, progress.outcome == nil {
      downloads.etaSeconds =
        downloads.remaining == 0
        ? 0
        : downloads.remaining.flatMap { remaining in
          network.rate.flatMap { $0 > 0 ? Double(remaining) / $0 : nil }
        }
    }
    let processed = processing.snapshot(at: time)
    let writes = common.write.snapshot(at: time)
    let trim = trimming.snapshot(at: time)
    let eta: Double?
    switch progress.phase {
    case .metadata:
      eta = sophonETA([
        common.manifests.snapshot(at: time).etaSeconds,
        common.planning.snapshot(at: time).etaSeconds,
      ])
    case .scanning: eta = verification.bytes.etaSeconds
    case .trimming: eta = trim.etaSeconds
    case .running: eta = sophonETA([downloads.etaSeconds, processed.etaSeconds, writes.etaSeconds])
    }
    progress.metrics = InstallationMetrics(
      common: common.snapshot(at: time, eta: progress.outcome == nil ? eta : nil),
      verification: verification, trimming: trim, download: downloads,
      downloadedChunks: downloadedChunks,
      processing: SophonProcessingMetrics(chunks: processed, bytes: processedBytes),
      retries: retries)
    return progress
  }

  public func record(_ event: InstallationEvent) {
    guard progress.outcome == nil else { return }
    let time = common.now
    switch event {
    case .metadataPlanned(let count):
      common.planManifests(installation: count, diff: 0, at: time)
    case .manifestPulled:
      common.manifestLoaded(isDiff: false, at: time)
    case .planningStarted:
      common.planning.start(at: time)
      common.planning.setTotal(1)
    case .planningCompleted:
      common.planning.advance(1, at: time)
      common.planning.finish(at: time)
    case .scanPlanned(let files, let chunks, let bytes):
      verificationBytes.setTotal(bytes)
      verificationChunks.setTotal(UInt64(chunks))
      verificationFiles.setTotal(UInt64(files))
      common.files.setTotal(UInt64(files))
    case .fileMissing(let path, let chunks, let bytes):
      progress.currentFile = path.lastPathComponent
      progress.currentFileBytes = 0
      progress.currentFileSize = bytes
      missingFiles += 1
      verificationChunks.advance(UInt64(chunks), at: time)
      verificationBytes.advance(bytes, at: time)
    case .fileChunkScanned(let path, _, _, let offset, let bytes, let expected):
      progress.currentFile = path.lastPathComponent
      progress.currentFileBytes = offset.addingReportingOverflow(bytes).partialValue
      progress.currentFileSize = nil
      verificationChunks.advance(1, at: time)
      verificationBytes.advance(expected, at: time)
      readBytes += bytes
      common.read.advance(bytes, at: time)
    case .fileScanned(_, let broken, let trim):
      verificationFiles.advance(1, at: time)
      if broken { brokenFiles += 1 }
      if trim { trimFiles += 1 }
    case .planned(let bytes, let writes, let chunks, let files):
      download.setTotal(bytes)
      common.write.setTotal(writes)
      processing.setTotal(UInt64(chunks))
      common.files.setTotal(UInt64(files))
    case .fileTrimmed: trimming.advance(1, at: time)
    case .chunkDownloaded(_, let bytes):
      if common.resourceSource == nil { download.advance(bytes, at: time) }
      downloadedChunks += 1
    case .retryScheduled(_, _, let reason):
      retries += 1
      logger.warning("Chunk download retry scheduled", metadata: ["reason": "\(reason)"])
    case .chunkPostProcessed(_, _, let bytes):
      processing.advance(1, at: time)
      processedBytes += bytes
    case .chunkWritten(let path, _, _, let bytes):
      progress.currentFile = path.lastPathComponent
      common.write.advance(bytes, at: time)
    case .fileCompleted: common.files.advance(1, at: time)
    case .phaseChanged(let next):
      if next != progress.phase {
        if progress.phase == .scanning {
          verificationBytes.finish(at: time)
          verificationChunks.finish(at: time)
          verificationFiles.finish(at: time)
        }
        common.changePhase(next.rawValue, at: time)
        progress.phase = next
        if next == .scanning {
          verificationBytes.start(at: time)
          verificationChunks.start(at: time)
          verificationFiles.start(at: time)
          common.read.start(at: time)
        } else if next == .trimming {
          trimming.start(at: time)
          trimming.setTotal(trimFiles)
        } else if next == .running {
          trimming.finish(at: time)
          download.start(at: time)
          processing.start(at: time)
          common.network.start(at: time)
          common.write.start(at: time)
        }
      }
      logger.info("Installation phase changed", metadata: ["phase": "\(next.rawValue)"])
    case .finished(let outcome):
      syncResources(at: time)
      common.finish(at: time)
      verificationBytes.finish(at: time)
      verificationChunks.finish(at: time)
      verificationFiles.finish(at: time)
      trimming.finish(at: time)
      download.finish(at: time)
      processing.finish(at: time)
      progress.outcome = outcome
      _ = snapshot()
      logger.info("Installation finished", metadata: ["outcome": "\(outcome)"])
    }
    for subscriber in subscribers.values { subscriber.yield(event) }
    if progress.outcome != nil {
      for subscriber in subscribers.values { subscriber.finish() }
      subscribers.removeAll()
    }
  }

  deinit { for subscriber in subscribers.values { subscriber.finish() } }
}
