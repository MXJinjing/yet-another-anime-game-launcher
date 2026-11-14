import ArgumentParser
import HYPAPIClient

struct WPFPackagesCLI: AsyncParsableCommand {
  static let configuration = CommandConfiguration(
    commandName: "get-wpf-packages",
    abstract: "List WPF package metadata without downloading packages.",
    aliases: ["wpf-packages"])

  @OptionGroup var options: HYPAPIOptions

  @Argument(help: "Game ID or biz; omit to return all games.")
  var game: String?

  @Option(help: "Filter by an exact API version string.")
  var version: String?

  @Flag(help: "Output only package URLs as a YAML or JSON array.")
  var urlsOnly = false

  mutating func run() async throws {
    let client = options.client
    var packages = try await client.getWPFPackages()
    if let game {
      let config = try resolveHYPGame(game, in: try await client.getGameConfigs())
      packages.wpfPackages = packages.wpfPackages.filter { $0.game.id == config.game.id }
    }
    if let version {
      packages.wpfPackages = packages.wpfPackages.filter { $0.wpfPackage.version == version }
    }
    if urlsOnly {
      try options.output(packages.wpfPackages.map { $0.wpfPackage.url.absoluteString })
    } else {
      try options.output(packages)
    }
  }
}
