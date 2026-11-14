public struct GameExecutableInfo: Codable, Sendable {
  public var version: String
  public var md5: String
}

public struct GameScanInfo: Codable, Sendable {
  public var gameID: String
  public var gameExeList: [GameExecutableInfo]

  enum CodingKeys: String, CodingKey {
    case gameID = "game_id"
    case gameExeList = "game_exe_list"
  }
}

public struct GameScanInfos: Codable, Sendable {
  public var gameScanInfo: [GameScanInfo]

  enum CodingKeys: String, CodingKey {
    case gameScanInfo = "game_scan_info"
  }

  public func getVersion(id gameID: String, md5: String) -> String? {
    for scanInfo in gameScanInfo {
      if scanInfo.gameID == gameID {
        for exeInfo in scanInfo.gameExeList {
          if exeInfo.md5 == md5 { return exeInfo.version }
        }
      }
    }
    return nil
  }
}
