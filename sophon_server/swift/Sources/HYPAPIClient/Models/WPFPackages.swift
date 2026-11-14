import Foundation

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

public struct WPFPackageInfo: Codable, Sendable {
  public var version: String
  public var url: URL
  public var md5: String
  public var size: Int64

  enum CodingKeys: CodingKey {
    case version
    case url
    case md5
    case size
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.version = try container.decode(String.self, forKey: .version)
    self.url = try parseURL(try container.decode(String.self, forKey: .url))
    self.md5 = try container.decode(String.self, forKey: .md5)
    self.size = try convert(try container.decode(String.self, forKey: .size))
  }
}

public struct WPFPackage: Codable, Sendable {
  public var game: GameType
  public var wpfPackage: WPFPackageInfo

  enum CodingKeys: String, CodingKey {
    case game
    case wpfPackage = "wpf_package"
  }
}

public struct WPFPackages: Codable, Sendable {
  public var wpfPackages: [WPFPackage]

  enum CodingKeys: String, CodingKey {
    case wpfPackages = "wpf_packages"
  }

  public func findBy(id gameID: String) -> [WPFPackageInfo] {
    var packages: [WPFPackageInfo] = []
    for package in wpfPackages {
      if package.game.id == gameID {
        packages.append(package.wpfPackage)
      }
    }
    return packages
  }

  public func findBy(biz gameBiz: String) -> [WPFPackageInfo] {
    var packages: [WPFPackageInfo] = []
    for package in wpfPackages {
      if package.game.biz == gameBiz {
        packages.append(package.wpfPackage)
      }
    }
    return packages
  }
}
