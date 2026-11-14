import ArgumentParser
import HYPAPIClient

struct GameBranchesCLI: AsyncParsableCommand {
  static let configuration = CommandConfiguration(
    commandName: "get-game-branches", abstract: "Get main and predownload branch metadata.",
    aliases: ["game-branches", "branches"])

  @OptionGroup var options: HYPAPIOptions

  @Argument(help: "Game ID or biz; omit to return all games.")
  var game: String?

  mutating func run() async throws {
    let client = options.client
    var branches = try await client.getGameBranches()
    if let game {
      let config = try resolveHYPGame(game, in: try await client.getGameConfigs())
      branches.gameBranches = branches.gameBranches.filter { $0.game.id == config.game.id }
    }
    try options.output(branches)
  }
}
