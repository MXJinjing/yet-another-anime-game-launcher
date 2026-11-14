import ArgumentParser
import Foundation
import HYPAPIClient
import Yams

struct HYPAPIOptions: ParsableArguments {
  @Flag(name: .customLong("cn"), help: "Use the CN API instead of the OS API.")
  var isCN = false

  @Option(
    name: [.customLong("format"), .customShort("f")],
    help: "Output format: yaml or json.", completion: .list(["yaml", "json"]))
  var outputFormat = "yaml"

  @Flag(name: .customLong("pretty"), help: "Pretty-print JSON output.")
  var prettyPrint = false

  mutating func validate() throws {
    outputFormat = outputFormat.lowercased()
    guard ["yaml", "json"].contains(outputFormat) else {
      throw SophonCLIError.InvalidOutputFormatError(outputFormat)
    }
  }

  var client: HYPAPIClient { HYPAPIClientManager.shared.getClient(isCN: isCN) }

  func output<Value: Encodable>(_ value: Value) throws {
    let text: String
    switch outputFormat.lowercased() {
    case "json":
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
      if prettyPrint { encoder.outputFormatting.insert(.prettyPrinted) }
      text = String(decoding: try encoder.encode(value), as: UTF8.self)
    case "yaml":
      let encoder = YAMLEncoder()
      encoder.options.allowUnicode = true
      encoder.options.sortKeys = true
      encoder.options.indent = 4
      text = try encoder.encode(value)
    default:
      throw SophonCLIError.InvalidOutputFormatError(outputFormat)
    }
    print(text, terminator: text.hasSuffix("\n") ? "" : "\n")
  }
}

internal final class HYPAPIClientManager: Sendable {
  public static let shared = HYPAPIClientManager()

  public let cnClient: HYPAPIClient
  public let osClient: HYPAPIClient

  private init() {
    cnClient = try! HYPAPIClient(
      baseURL: HYPAPI_CN_BASE_URL, sophonBaseURL: SOPHON_API_CN_BASE_URL,
      launcherID: HYPAPI_CN_LAUNCHER_ID)
    osClient = try! HYPAPIClient(
      baseURL: HYPAPI_OS_BASE_URL, sophonBaseURL: SOPHON_API_OS_BASE_URL,
      launcherID: HYPAPI_OS_LAUNCHER_ID)
  }

  public func getClient(isCN: Bool) -> HYPAPIClient {
    return isCN ? cnClient : osClient
  }
}

func resolveHYPGame(_ query: String, in configs: GameConfigs) throws -> GameLaunchConfig {
  if let exact = configs.findBy(id: query) { return exact }
  let matches = configs.launchConfigs.filter { $0.game.biz == query }
  guard let first = matches.first else {
    throw ValidationError("No game matches ID or biz '\(query)'.")
  }
  guard matches.count == 1 else {
    let ids = matches.map(\.game.id).sorted().joined(separator: ", ")
    throw ValidationError("Game biz '\(query)' is ambiguous. Specify an ID: \(ids)")
  }
  return first
}
