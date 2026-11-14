public struct GameDisplay: Codable, Sendable {
  public var name: String
  public var language: String
}

public struct GameServerConfig: Codable, Sendable {
  public var gameID: String
  public var name: String
  public var description: String

  enum CodingKeys: String, CodingKey {
    case gameID = "game_id"
    case name = "i18n_name"
    case description = "i18n_description"
  }
}

public struct LauncherGame: Codable, Sendable {
  public var id: String
  public var biz: String
  public var display: GameDisplay
  public var gameServerConfigs: [GameServerConfig]?

  enum CodingKeys: String, CodingKey {
    case id, biz, display
    case gameServerConfigs = "game_server_configs"
  }
}

public struct Games: Codable, Sendable {
  public var games: [LauncherGame]
}
