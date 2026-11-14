import ArgumentParser
import HYPAPIClient

struct GameScanInfoCLI: AsyncParsableCommand {
  static let configuration = CommandConfiguration(
    commandName: "get-game-scan-info",
    abstract: "List API-reported executable versions and hashes.",
    aliases: ["game-scan-info", "scan-info"])

  @OptionGroup var options: HYPAPIOptions

  @Argument(help: "Game ID or biz; omit to return all games.")
  var game: String?

  @Option(help: "Filter by an exact API version string.")
  var version: String?

  mutating func run() async throws {
    let client = options.client
    var info = try await client.getGameScanInfo()
    if let game {
      let config = try resolveHYPGame(game, in: try await client.getGameConfigs())
      info.gameScanInfo = info.gameScanInfo.filter { $0.gameID == config.game.id }
    }
    if let version {
      for index in info.gameScanInfo.indices {
        info.gameScanInfo[index].gameExeList = info.gameScanInfo[index].gameExeList.filter {
          $0.version == version
        }
      }
      info.gameScanInfo.removeAll { $0.gameExeList.isEmpty }
    }
    try options.output(info)
  }
}
