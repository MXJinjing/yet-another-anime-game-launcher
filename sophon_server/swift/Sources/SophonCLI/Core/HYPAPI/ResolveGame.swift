import ArgumentParser
import Foundation
import HYPAPIClient

struct ResolveGameCLI: AsyncParsableCommand {
  static let configuration = CommandConfiguration(
    commandName: "resolve-game",
    abstract: "Resolve an ID, biz, or exact display name to all matching games.")

  @OptionGroup var options: HYPAPIOptions

  @Argument(help: "Exact game ID, biz, or case-insensitive display name.")
  var query: String

  @Option(help: "Display-name language; defaults to en-us or zh-cn with --cn.")
  var language: String?

  mutating func run() async throws {
    let games = try await options.client.getGames(
      language: language ?? (options.isCN ? "zh-cn" : "en-us"))
    let identities = gameIdentities(games)
    var matches = identities.filter { $0.id == query }
    if matches.isEmpty {
      matches = identities.filter { $0.biz == query }
    }
    if matches.isEmpty {
      matches = identities.filter { $0.name.caseInsensitiveCompare(query) == .orderedSame }
    }
    try options.output(matches)
  }
}
