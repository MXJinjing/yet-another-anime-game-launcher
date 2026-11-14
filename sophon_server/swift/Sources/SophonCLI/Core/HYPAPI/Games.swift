import ArgumentParser
import Foundation
import HYPAPIClient

struct GamesCLI: AsyncParsableCommand {
  static let configuration = CommandConfiguration(
    commandName: "get-games", abstract: "List game names, biz values, IDs, and servers.",
    aliases: ["games"])

  @OptionGroup var options: HYPAPIOptions

  @Option(help: "Filter by name, biz, ID, or server label.")
  var search: String?

  @Option(help: "Display language; defaults to en-us for OS and zh-cn for CN.")
  var language: String?

  mutating func run() async throws {
    let games = try await options.client.getGames(
      language: language ?? (options.isCN ? "zh-cn" : "en-us"))
    var identities = gameIdentities(games)
    if let search {
      identities = identities.filter {
        [$0.name, $0.biz, $0.id, $0.server ?? ""].contains {
          $0.localizedCaseInsensitiveContains(search)
        }
      }
    }
    try options.output(identities)
  }
}

struct GameIdentity: Encodable {
  let name: String
  let biz: String
  let id: String
  let server: String?
}

func gameIdentities(_ response: Games) -> [GameIdentity] {
  var identities: [String: GameIdentity] = [:]
  for game in response.games {
    identities[game.id] = GameIdentity(
      name: game.display.name, biz: game.biz, id: game.id, server: nil)
    for server in game.gameServerConfigs ?? [] {
      identities[server.gameID] = GameIdentity(
        name: game.display.name, biz: game.biz, id: server.gameID,
        server: server.description.trimmingCharacters(in: .whitespacesAndNewlines))
    }
  }
  return identities.values.sorted { $0.id < $1.id }
}
