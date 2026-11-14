import Foundation

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

public struct SophonManifestProperty: Codable, Sendable {
  public var id: String
  public var checksum: String
  public var compressedSize: Int64
  public var uncompressedSize: Int64

  enum CodingKeys: String, CodingKey {
    case id
    case checksum
    case compressedSize = "compressed_size"
    case uncompressedSize = "uncompressed_size"
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.id = try container.decode(String.self, forKey: .id)
    self.checksum = try container.decode(String.self, forKey: .checksum)
    self.compressedSize = try convert(try container.decode(String.self, forKey: .compressedSize))
    self.uncompressedSize = try convert(
      try container.decode(String.self, forKey: .uncompressedSize))
  }
}

public struct SophonDownloadInfo: Codable, Sendable {
  public var encryption: Bool
  public var password: String
  public var compression: Bool
  public var urlPrefix: String
  public var urlSuffix: String

  enum CodingKeys: String, CodingKey {
    case encryption
    case password
    case compression
    case urlPrefix = "url_prefix"
    case urlSuffix = "url_suffix"
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    if let flag = try? container.decode(Bool.self, forKey: .encryption) {
      self.encryption = flag
    } else {
      self.encryption = try container.decode(Int.self, forKey: .encryption) != 0
    }
    self.password = try container.decode(String.self, forKey: .password)
    if let flag = try? container.decode(Bool.self, forKey: .compression) {
      self.compression = flag
    } else {
      self.compression = try container.decode(Int.self, forKey: .compression) != 0
    }
    self.urlPrefix = try container.decode(String.self, forKey: .urlPrefix)
    let _ = try parseURL(urlPrefix)
    self.urlSuffix = try container.decode(String.self, forKey: .urlSuffix)
  }

  public func buildDownloadURL(_ target: String) throws -> URL {
    let url = try parseURL(urlPrefix).appendingPathComponent(target)
    let lastComponent = url.lastPathComponent + urlSuffix
    return url.deletingLastPathComponent().appendingPathComponent(lastComponent)
  }
}

public struct SophonManifestStats: Codable, Sendable {
  public var compressedSize: Int64
  public var uncompressedSize: Int64
  public var fileCount: Int
  public var chunkCount: Int

  enum CodingKeys: String, CodingKey {
    case compressedSize = "compressed_size"
    case uncompressedSize = "uncompressed_size"
    case fileCount = "file_count"
    case chunkCount = "chunk_count"
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.compressedSize = try convert(try container.decode(String.self, forKey: .compressedSize))
    self.uncompressedSize = try convert(
      try container.decode(String.self, forKey: .uncompressedSize))
    self.fileCount = try convert(try container.decode(String.self, forKey: .fileCount))
    self.chunkCount = try convert(try container.decode(String.self, forKey: .chunkCount))
  }
}
