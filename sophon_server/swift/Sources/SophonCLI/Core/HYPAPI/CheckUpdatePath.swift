import ArgumentParser
import HYPAPIClient

struct CheckUpdatePathCLI: AsyncParsableCommand {
  static let configuration = CommandConfiguration(
    commandName: "check-update-path",
    abstract: "Check whether branch metadata advertises a direct update from a version.")

  @OptionGroup var options: HYPAPIOptions

  @Argument(help: "Game ID or biz.")
  var game: String

  @Option(help: "Exact source version tag.")
  var fromVersion: String

  @Flag(help: "Check the predownload branch instead of the main branch.")
  var predownload = false

  mutating func validate() throws {
    guard !fromVersion.isEmpty else {
      throw ValidationError("The source version must not be empty.")
    }
  }

  mutating func run() async throws {
    let client = options.client
    let config = try resolveHYPGame(game, in: try await client.getGameConfigs())
    let branches = try await client.getGameBranches()
    guard let branch = branches.getGameSubBranch(id: config.game.id, predownload: predownload)
    else {
      throw ValidationError(
        "No \(predownload ? "predownload" : "main") branch is available for game '\(config.game.id)'."
      )
    }
    let status =
      fromVersion == branch.tag
      ? "already-current"
      : branch.diffTags.contains(fromVersion) ? "direct-update-advertised" : "not-advertised"
    try options.output(
      UpdatePath(
        id: config.game.id, biz: config.game.biz, fromVersion: fromVersion,
        targetVersion: branch.tag,
        predownload: predownload, status: status))
  }
}

private struct UpdatePath: Encodable {
  let id: String
  let biz: String
  let fromVersion: String
  let targetVersion: String
  let predownload: Bool
  let status: String
}
