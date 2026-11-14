import Foundation
import HYPAPIClient

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

public struct ChunkApplicationInfo: Sendable, Codable {
  public let fileURL: URL
  public let offset: UInt64
}

public struct RequiredChunk: Sendable, Codable {
  public let chunkID: String
  public let uncompressedMd5: String
  public let compressedMd5: String
  public let compressedSize: UInt64
  public let uncompressedSize: UInt64
  public let downloadInfo: SophonDownloadInfo
  public var chunkApplicationInfos: [ChunkApplicationInfo]

  internal func getDownloadURL() throws -> URL {
    return try downloadInfo.buildDownloadURL(chunkID)
  }

  internal func downloadRequest() throws -> DownloadRequest {
    guard !downloadInfo.encryption, downloadInfo.password.isEmpty else {
      throw SophonClientError.UnsupportedManifestConfiguration("Encrypted chunks are not supported")
    }
    return DownloadRequest(
      chunkID: chunkID, url: try getDownloadURL(),
      md5: downloadInfo.compression ? compressedMd5 : uncompressedMd5,
      size: downloadInfo.compression ? compressedSize : uncompressedSize)
  }
}

struct DownloadedChunk: Sendable {
  let chunkID: String
  let md5: String
  let size: UInt64
  let data: CachedBinary
  let request: DownloadRequest
  let downloadInfo: SophonDownloadInfo
  let chunkApplicationInfos: [ChunkApplicationInfo]
}

struct ProcessedChunk: Sendable {
  let chunkID: String
  let data: CachedBinary
  let request: DownloadRequest
  let workspace: TransferWorkspace
  let chunkApplicationInfos: [ChunkApplicationInfo]
}

public struct InstallationPlan: Sendable, Codable {
  public let totalChunkCount: Int
  public let downloadSize: UInt64
  public let diskWriteSize: UInt64
  public let requiredChunks: [RequiredChunk]
  public let plannedFiles: [PlannedFile]
  var trimFiles: LazyFilterSequence<[PlannedFile]> {
    plannedFiles.lazy.filter { $0.needsTrimming }
  }
}

public struct PlannedFile: Sendable, Codable {
  public let fileURL: URL
  public let size: UInt64
  public let md5: String
  public let requiredChunkCount: Int
  public let needsTrimming: Bool
}

struct ScanJob: Sendable {
  let file: FileInfo
  let downloadInfo: SophonDownloadInfo
}

struct ScanResult: Sendable {
  let state: GameFileState
  let downloadInfo: SophonDownloadInfo
}
