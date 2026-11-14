import ArgumentParser
import HYPAPIClient

struct GameInfoCLI: AsyncParsableCommand {
  static let configuration = CommandConfiguration(
    commandName: "game-info",
    abstract: "Summarize a game's identity, capabilities, and available branches.")

  @OptionGroup var options: HYPAPIOptions

  @Argument(help: "Game ID or biz.")
  var game: String

  @Option(help: "Display-name language; defaults to en-us or zh-cn with --cn.")
  var language: String?

  mutating func run() async throws {
    try options.output(
      await gameInfo(
        game, client: options.client, language: language ?? (options.isCN ? "zh-cn" : "en-us")))
  }
}

func gameInfo(_ game: String, client: HYPAPIClient, language: String) async throws -> GameInfo {
  async let catalog = client.getGames(language: language)
  async let launchConfigs = client.getGameConfigs()
  async let gameBranches = client.getGameBranches()
  let (games, configs, branches) = try await (catalog, launchConfigs, gameBranches)
  let config = try resolveHYPGame(game, in: configs)
  let identity = gameIdentities(games).first { $0.id == config.game.id }
  let branch = branches.gameBranches.first { $0.game.id == config.game.id }
  return GameInfo(
    id: config.game.id, biz: config.game.biz, name: identity?.name, server: identity?.server,
    capabilities: GameCapabilities(
      enableLdiff: config.enableLdiff, enableScenarioPkg: config.enableScenarioPkg,
      enableWriteVerifyResult: config.enableWriteVerifyResult),
    main: BranchInfo(branch?.main), predownload: BranchInfo(branch?.preDownload))
}

struct GameInfo: Encodable, Sendable {
  let id: String
  let biz: String
  let name: String?
  let server: String?
  let capabilities: GameCapabilities
  let main: BranchInfo
  let predownload: BranchInfo
}

struct GameCapabilities: Encodable, Sendable {
  let enableLdiff: Bool
  let enableScenarioPkg: Bool
  let enableWriteVerifyResult: Bool
}

struct BranchInfo: Encodable, Sendable {
  let available: Bool
  let tag: String?
  let updateFromVersions: [String]
  let audioMatchingFields: [String]

  init(_ branch: GameSubBranch?) {
    available = branch != nil
    tag = branch?.tag
    updateFromVersions = (branch?.diffTags ?? []).sorted()
    audioMatchingFields = Set(
      (branch?.categories ?? []).filter { $0.type == .audio }.map(\.matchingField)
    ).sorted()
  }
}
