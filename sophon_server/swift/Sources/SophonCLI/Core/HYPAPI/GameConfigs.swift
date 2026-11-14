import ArgumentParser
import HYPAPIClient

struct GameConfigsCLI: AsyncParsableCommand {
  static let configuration = CommandConfiguration(
    commandName: "get-game-configs", abstract: "Get game configurations, optionally by ID or biz.",
    aliases: ["game-configs", "configs"])

  @OptionGroup var options: HYPAPIOptions

  @Argument(help: "Game ID or biz; omit to return all games.")
  var game: String?

  mutating func run() async throws {
    var configs = try await options.client.getGameConfigs()
    if let game {
      configs.launchConfigs = [try resolveHYPGame(game, in: configs)]
    }
    try options.output(configs)
  }
}
