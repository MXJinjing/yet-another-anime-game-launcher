import Foundation

public enum UpdatePhase: String, Codable, Sendable {
  case metadata
  case caching
  case running
  case repairing
  case deleting
}

public enum UpdateOutcome: Codable, Sendable {
  case completed
  case failed(reason: String)
  case cancelled
}

public enum UpdateEvent: Encodable, Sendable {
  case metadataPlanned(installationManifests: Int, diffManifests: Int)
  case manifestPulled(kind: String, matchingField: String)
  case planningStarted
  case planningCompleted

  case planned(
    sourceVersion: String, targetVersion: String, patchBytes: UInt64, installBytes: UInt64,
    totalFiles: Int, deleteFiles: Int, deleteBytes: UInt64)
  case bundleDownloaded(patchID: String, bytes: UInt64)
  case patchDownloadsPlanned(bytes: UInt64)
  case fileStarted(fileURL: URL)
  case repairPlanned(downloadBytes: UInt64, writeBytes: UInt64)
  case repairDownloaded(bytes: UInt64)
  case repairWritten(bytes: UInt64)
  case fileNeedsRepair(fileURL: URL)
  case fileCompleted(fileURL: URL, bytes: UInt64, skipped: Bool)
  case fileCached(fileURL: URL)
  case fileDeleted(fileURL: URL, bytes: UInt64)
  case phaseChanged(UpdatePhase)
  case finished(UpdateOutcome)
}

public struct UpdateProgress: BaseProgress, Codable {
  public internal(set) var phase: UpdatePhase = .metadata
  public internal(set) var outcome: UpdateOutcome?
  public internal(set) var sourceVersion: String?
  public internal(set) var targetVersion: String?
  public internal(set) var metrics = UpdateMetrics()
  public internal(set) var currentFile: String?
  public init() {}
}
