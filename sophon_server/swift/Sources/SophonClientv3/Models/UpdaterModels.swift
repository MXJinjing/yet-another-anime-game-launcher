import Foundation
import HYPAPIClient

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

public struct PlannedDeleteFile: Sendable, Codable {
  public let fileURL: URL
  public let size: UInt64
}

public struct PlannedPatchBundle: Sendable, Codable {
  public let patchID: String
  public let patchSize: UInt64
  public let patchHash: String  // Checksum of the complete bundle.
  public let downloadInfo: SophonDownloadInfo
  // File patches ordered by their offsets within the bundle.
  public let patches: [PlannedPatch]
}

public struct PlannedPatch: Sendable, Codable {
  public let patchOffset: UInt64
  public let patchLength: UInt64
  // No original means this payload can be applied without a source file.
  // Copy raw payloads or apply HDIFF payloads using empty input.
  public let original: PlannedPatchSource?
  public let target: PlannedUpdateFile
}

public struct PlannedPatchSource: Sendable, Codable {
  public let fileURL: URL
  public let size: UInt64
  public let md5: String
}

public struct PlannedUpdateFile: Sendable, Codable {
  public let fileURL: URL
  public let size: UInt64
  public let md5: String
  public let installChunks: [RequiredChunk]
}

public struct UpdatePlan: Sendable, Codable {
  public let sourceVersion: String
  public let targetVersion: String
  public let patchBundles: [PlannedPatchBundle]
  // Full installation metadata for update targets, used for repair fallback.
  public let installFiles: [PlannedUpdateFile]
  public let deleteFiles: [PlannedDeleteFile]
  public var patchSize: UInt64 {
    patchBundles.reduce(0) { $0 + $1.patchSize }
  }
  public var installSize: UInt64 {
    installFiles.reduce(0) { $0 + $1.size }
  }
  public var deleteSize: UInt64 {
    deleteFiles.reduce(0) { $0 + $1.size }
  }
}
