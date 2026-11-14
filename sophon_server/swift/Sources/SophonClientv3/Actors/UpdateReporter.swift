import Foundation
import Logging

public actor UpdateReporter: OperationReportingInternal {
  public typealias Event = UpdateEvent
  public typealias Progress = UpdateProgress
  internal let logger: Logger
  internal var progress = UpdateProgress()
  internal var subscribers: [UUID: AsyncStream<UpdateEvent>.Continuation] = [:]
  private var common = SophonMetricsState()
  private var patchData = SophonMeter()
  private var patchNetwork = SophonMeter()
  private var repairDownload = SophonMeter()
  private var repairWrite = SophonMeter()
  private var deleteFiles = SophonMeter()
  private var deleteBytes = SophonMeter()
  private var verifiedBytes: UInt64 = 0
  private var bundles: UInt64 = 0
  private var repairFiles: UInt64 = 0
  private var skipped: UInt64 = 0
  private var cached: UInt64 = 0

  public init(logger: Logger) { self.logger = logger }

  internal func useResources(_ telemetry: TransferTelemetry) {
    common.resourceSource = { telemetry.snapshot() }
  }

  private func syncResources(at time: Double) {
    common.syncResources(at: time)
    if let resources = common.resources {
      patchData.set(resources.receivedBytes, at: time)
      patchNetwork.set(resources.transferredBytes, at: time)
      if repairDownload.total != nil {
        repairDownload.set(
          resources.downloadTotals["install"]?.receivedBytes ?? 0, at: time)
      }
    }
  }

  public func snapshot() -> UpdateProgress {
    let time = common.now
    syncResources(at: time)
    var data = patchData.snapshot(at: time)
    let network = patchNetwork.snapshot(at: time)
    if progress.outcome == nil {
      data.etaSeconds =
        data.remaining == 0
        ? 0
        : data.remaining.flatMap { remaining in
          network.rate.flatMap { $0 > 0 ? Double(remaining) / $0 : nil }
        }
    }
    let files = common.files.snapshot(at: time)
    let repair = SophonRepairMetrics(
      download: repairDownload.snapshot(at: time), write: repairWrite.snapshot(at: time),
      files: repairFiles)
    let deletion = SophonDeletionMetrics(
      files: deleteFiles.snapshot(at: time), bytes: deleteBytes.snapshot(at: time))
    let eta: Double?
    switch progress.phase {
    case .metadata:
      eta = sophonETA([
        common.manifests.snapshot(at: time).etaSeconds,
        common.planning.snapshot(at: time).etaSeconds,
      ])
    case .caching, .running:
      let fileETA =
        files.remaining == 0
        ? 0
        : files.remaining.flatMap { remaining in
          files.averageRate.flatMap { $0 > 0 ? Double(remaining) / $0 : nil }
        }
      eta = sophonETA([data.etaSeconds, fileETA])
    case .repairing: eta = sophonETA([repair.download.etaSeconds, repair.write.etaSeconds])
    case .deleting: eta = deletion.files.etaSeconds
    }
    progress.metrics = UpdateMetrics(
      common: common.snapshot(at: time, eta: progress.outcome == nil ? eta : nil),
      patch: SophonPatchMetrics(
        data: data, network: network, retainedBytes: common.resources?.retainedBytes ?? 0,
        verifiedBytes: verifiedBytes, bundlesReady: bundles),
      repair: repair, deletion: deletion, skippedFiles: skipped, cachedFiles: cached)
    return progress
  }

  public func record(_ event: UpdateEvent) {
    guard progress.outcome == nil else { return }
    let time = common.now
    switch event {
    case .metadataPlanned(let install, let diff):
      common.planManifests(installation: install, diff: diff, at: time)
    case .manifestPulled(let kind, _):
      common.manifestLoaded(isDiff: kind == "diff", at: time)
    case .planningStarted:
      common.planning.start(at: time)
      common.planning.setTotal(1)
    case .planningCompleted:
      common.planning.advance(1, at: time)
      common.planning.finish(at: time)
    case .planned(
      let source, let target, let bytes, let writes, let files, let deletes, let deletionBytes):
      progress.sourceVersion = source
      progress.targetVersion = target
      patchData.setTotal(bytes)
      common.write.setTotal(writes)
      common.files.setTotal(UInt64(files))
      deleteFiles.setTotal(UInt64(deletes))
      deleteBytes.setTotal(deletionBytes)
    case .patchDownloadsPlanned(let bytes): patchData.setTotal(bytes)
    case .bundleDownloaded(_, let bytes):
      verifiedBytes += bytes
      bundles += 1
      if common.resourceSource == nil { patchData.advance(bytes, at: time) }
    case .fileStarted(let path): progress.currentFile = path.lastPathComponent
    case .repairPlanned(let download, let write):
      repairDownload.setTotal(download)
      repairWrite.setTotal(write)
      repairDownload.start(at: time)
      repairWrite.start(at: time)
    case .repairDownloaded(let bytes):
      if common.resourceSource == nil { repairDownload.advance(bytes, at: time) }
    case .repairWritten(let bytes): repairWrite.advance(bytes, at: time)
    case .fileNeedsRepair: repairFiles += 1
    case .fileCompleted(_, let bytes, let isSkipped):
      common.files.advance(1, at: time)
      if isSkipped {
        skipped += 1
        if let total = common.write.total { common.write.setTotal(total - min(total, bytes)) }
      } else {
        common.write.advance(bytes, at: time)
      }
    case .fileCached:
      cached += 1
      common.files.advance(1, at: time)
    case .fileDeleted(_, let bytes):
      deleteFiles.advance(1, at: time)
      deleteBytes.advance(bytes, at: time)
    case .phaseChanged(let next):
      guard next != progress.phase else { break }
      if progress.phase == .running || progress.phase == .caching {
        syncResources(at: time)
        patchData.finish(at: time)
        patchNetwork.finish(at: time)
      } else if progress.phase == .repairing {
        syncResources(at: time)
        repairDownload.finish(at: time)
        repairWrite.finish(at: time)
      }
      common.changePhase(next.rawValue, at: time)
      progress.phase = next
      if next == .running || next == .caching {
        patchData.start(at: time)
        patchNetwork.start(at: time)
        common.network.start(at: time)
        common.files.start(at: time)
        common.write.start(at: time)
        if next == .caching {
          common.write.setTotal(0)
          deleteFiles.setTotal(0)
          deleteBytes.setTotal(0)
        }
      } else if next == .deleting {
        deleteFiles.start(at: time)
        deleteBytes.start(at: time)
      }
    case .finished(let outcome):
      syncResources(at: time)
      common.finish(at: time)
      patchData.finish(at: time)
      patchNetwork.finish(at: time)
      repairDownload.finish(at: time)
      repairWrite.finish(at: time)
      deleteFiles.finish(at: time)
      deleteBytes.finish(at: time)
      progress.outcome = outcome
      _ = snapshot()
      logger.info("Update finished", metadata: ["outcome": "\(outcome)"])
    }
    for subscriber in subscribers.values { subscriber.yield(event) }
    if progress.outcome != nil {
      for subscriber in subscribers.values { subscriber.finish() }
      subscribers.removeAll()
    }
  }

  deinit { for subscriber in subscribers.values { subscriber.finish() } }
}
