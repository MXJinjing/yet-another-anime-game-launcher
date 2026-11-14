import Foundation

public enum InstallationPhase: String, Codable, Sendable {
  case metadata
  case scanning
  case trimming
  case running
}

public enum InstallationOutcome: Codable, Sendable {
  case completed
  case failed(reason: String)
  case cancelled
}

public enum InstallationEvent: Encodable, Sendable {
  // metadata stage
  case planningStarted
  case planningCompleted
  case metadataPlanned(totalManifests: Int)
  case manifestPulled(matchingField: String, predownload: Bool)

  // scanning stage
  case scanPlanned(totalFiles: Int, totalChunks: Int, totalBytes: UInt64)
  case fileMissing(filePath: URL, chunkCount: Int, expectedBytes: UInt64)
  case fileChunkScanned(
    filePath: URL, chunkID: String, isBroken: Bool, offset: UInt64, bytes: UInt64,
    expectedBytes: UInt64)
  case fileScanned(filePath: URL, isBroken: Bool, needsTrimming: Bool)
  case planned(downloadBytes: UInt64, writeBytes: UInt64, totalChunk: Int, totalFile: Int)

  // trimming stage
  case fileTrimmed(filePath: URL)

  // download stage
  case chunkDownloaded(chunkID: String, bytes: UInt64)
  case retryScheduled(chunkID: String, attempt: Int, reason: String)
  case chunkPostProcessed(chunkID: String, compressed_bytes: UInt64, uncompressed_bytes: UInt64)
  case chunkWritten(filePath: URL, chunkID: String, offset: UInt64, bytes: UInt64)
  case fileCompleted(filePath: URL)

  // installation phase related
  case phaseChanged(InstallationPhase)
  case finished(InstallationOutcome)
}

public struct InstallationProgress: BaseProgress, Codable {
  public internal(set) var phase: InstallationPhase = .metadata
  public internal(set) var outcome: InstallationOutcome?
  public internal(set) var metrics = InstallationMetrics()
  public internal(set) var currentFile: String?
  public internal(set) var currentFileBytes: UInt64?
  public internal(set) var currentFileSize: UInt64?
  public init() {}
}
