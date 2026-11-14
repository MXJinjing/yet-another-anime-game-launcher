import Foundation

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

public struct SophonManifestInfo: Codable, Sendable {
  public var categoryID: String
  public var categoryName: String
  public var manifest: SophonManifestProperty
  public var chunkDownload: SophonDownloadInfo
  public var manifestDownload: SophonDownloadInfo
  public var matchingField: String
  public var stats: SophonManifestStats
  public var deduplicatedStats: SophonManifestStats

  enum CodingKeys: String, CodingKey {
    case categoryID = "category_id"
    case categoryName = "category_name"
    case manifest
    case chunkDownload = "chunk_download"
    case manifestDownload = "manifest_download"
    case matchingField = "matching_field"
    case stats
    case deduplicatedStats = "deduplicated_stats"
  }

  public func getManifestDownloadURL() throws -> URL {
    return try manifestDownload.buildDownloadURL(manifest.id)
  }
}

public struct SophonBuildInfo: Codable, Sendable {
  public var buildID: String
  public var tag: String
  public var manifests: [SophonManifestInfo]

  enum CodingKeys: String, CodingKey {
    case buildID = "build_id"
    case tag
    case manifests
  }

  public func find(_ matchingField: String) -> SophonManifestInfo? {
    for manifest in manifests {
      if manifest.matchingField == matchingField {
        return manifest
      }
    }
    return nil
  }
}
