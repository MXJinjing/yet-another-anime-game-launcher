import ArgumentParser
import HYPAPIClient

struct LookupVersionCLI: AsyncParsableCommand {
  static let configuration = CommandConfiguration(
    commandName: "lookup-version",
    abstract: "Find all API-reported versions matching a supplied executable MD5.")

  @OptionGroup var options: HYPAPIOptions

  @Argument(help: "Game ID or biz.")
  var game: String

  @Option(help: "Executable MD5: 32 hexadecimal characters; no file is read or hashed.")
  var md5: String

  mutating func validate() throws {
    guard md5.utf8.count == 32,
      md5.utf8.allSatisfy({
        (48...57).contains($0) || (65...70).contains($0) || (97...102).contains($0)
      })
    else {
      throw ValidationError("MD5 must contain exactly 32 ASCII hexadecimal characters.")
    }
    md5 = md5.lowercased()
  }

  mutating func run() async throws {
    let client = options.client
    let config = try resolveHYPGame(game, in: try await client.getGameConfigs())
    let info = try await client.getGameScanInfo()
    let matches = info.gameScanInfo.filter { $0.gameID == config.game.id }
      .flatMap(\.gameExeList).filter { $0.md5.lowercased() == md5 }
    try options.output(matches)
  }
}
