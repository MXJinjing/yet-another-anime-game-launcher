import ArgumentParser
import Foundation
import HYPAPIClient
import Yams

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

struct SophonBuildCLI: AsyncParsableCommand {
  static let configuration = CommandConfiguration(
    commandName: "get-sophon-build",
    abstract: "Parse Sophon (patch) manifest",
    aliases: ["get-build", "build"],
  )
  @Argument(
    help: "Game ID or Game Biz.",
    completion: .list(AVAILABLE_GAME_BIZS),
  )
  var gameIDOrBiz: String

  @Flag(
    name: [.customLong("cn")],
    help: "Wether to use the CN API endpoint or the OS API endpoint. Default is false (OS).",
  )
  var isCN: Bool = false

  @Flag(
    name: [.customLong("predownload")],
    help:
      "Whether to fetch the predownload manifest or the normal manifest. Default is false (normal).",
  )
  var predownload: Bool = false

  @Option(
    name: [.customLong("output"), .customShort("o")],
    help:
      "Output file path to save the manifest. If not specified, the manifest will be printed to stdout.",
    completion: .directory,
    transform: { URL(filePath: $0) },
  )
  var outputFile: URL?

  @Flag(
    name: [.customLong("pretty")],
    help: "Whether to pretty print the manifest JSON. Default is false (compact).",
  )
  var prettyPrint: Bool = false

  @Flag(
    name: [.customLong("patch")],
    help: "Wether to fetch the patch manifest or the normal manifest. Default is false (normal).",
  )
  var isPatch: Bool = false

  @Option(
    name: [.customLong("format"), .customShort("f")],
    help: "Output format. Default is yaml.",
    completion: .list(["json", "yaml"]),
  )
  var outputFormat: String = "yaml"

  mutating func run() async throws {
    // TODO: refactor this so that multiple commands share base class
    let client = HYPAPIClientManager.shared.getClient(isCN: isCN)
    let gameBranches = try await client.getGameBranches()

    var temp = gameBranches.getGameSubBranch(biz: gameIDOrBiz, predownload: predownload)
    if temp == nil {
      temp = gameBranches.getGameSubBranch(id: gameIDOrBiz, predownload: predownload)
    }
    guard let gameSubBranch = temp else {
      throw SophonCLIError.FailedToFetchGameBranchError(
        gameIDOrBiz: gameIDOrBiz, predownload: predownload)
    }

    var data: Data
    switch outputFormat.lowercased() {
    case "json":
      let encoder = JSONEncoder()
      let defaultFormatting: JSONEncoder.OutputFormatting = [.sortedKeys, .withoutEscapingSlashes]
      encoder.outputFormatting = defaultFormatting.union(
        prettyPrint ? [.prettyPrinted] : []
      )

      if isPatch {
        let info = try await client.getSophonPatchBuildInfo(gameSubBranch)
        data = try encoder.encode(info)
      } else {
        let info = try await client.getSophonBuildInfo(gameSubBranch)
        data = try encoder.encode(info)
      }
    case "yaml":
      let encoder = YAMLEncoder()
      encoder.options.allowUnicode = true
      encoder.options.sortKeys = true
      encoder.options.indent = 4

      if isPatch {
        let info = try await client.getSophonPatchBuildInfo(gameSubBranch)
        data = Data(try encoder.encode(info).utf8)
      } else {
        let info = try await client.getSophonBuildInfo(gameSubBranch)
        data = Data(try encoder.encode(info).utf8)
      }
    default:
      throw SophonCLIError.InvalidOutputFormatError(outputFormat)
    }

    if let outputFile = outputFile {
      try data.write(to: outputFile)
    } else {
      print(String(data: data, encoding: .utf8)!)
    }
  }
}
