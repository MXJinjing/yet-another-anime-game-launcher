import Foundation

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

public struct SophonPatchManifestInfo: Codable, Sendable {
  public var categoryID: String
  public var categoryName: String
  public var manifest: SophonManifestProperty
  public var diffDownload: SophonDownloadInfo
  public var manifestDownload: SophonDownloadInfo
  public var matchingField: String
  public var stats: [String: SophonManifestStats]

  enum CodingKeys: String, CodingKey {
    case categoryID = "category_id"
    case categoryName = "category_name"
    case manifest
    case diffDownload = "diff_download"
    case manifestDownload = "manifest_download"
    case matchingField = "matching_field"
    case stats
  }

  public func getManifestDownloadURL() throws -> URL {
    return try manifestDownload.buildDownloadURL(manifest.id)
  }
}

public struct SophonPatchBuildInfo: Codable, Sendable {
  public var buildID: String
  public var patchID: String
  public var tag: String
  public var manifests: [SophonPatchManifestInfo]

  enum CodingKeys: String, CodingKey {
    case buildID = "build_id"
    case patchID = "patch_id"
    case tag
    case manifests
  }

  public func find(_ matchingField: String) -> SophonPatchManifestInfo? {
    for manifest in manifests {
      if manifest.matchingField == matchingField {
        return manifest
      }
    }
    return nil
  }
}
