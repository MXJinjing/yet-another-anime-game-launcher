import ArgumentParser
import HYPAPIClient

struct CompareBranchesCLI: AsyncParsableCommand {
  static let configuration = CommandConfiguration(
    commandName: "compare-branches",
    abstract: "Compare main and predownload tags and categories, not file contents.")

  @OptionGroup var options: HYPAPIOptions

  @Argument(help: "Game ID or biz.")
  var game: String

  mutating func run() async throws {
    try options.output(await compareBranches(game, client: options.client))
  }
}

func compareBranches(_ game: String, client: HYPAPIClient) async throws -> BranchComparison {
  let config = try resolveHYPGame(game, in: try await client.getGameConfigs())
  let branches = try await client.getGameBranches()
  guard let main = branches.getGameSubBranch(id: config.game.id, predownload: false) else {
    throw ValidationError("No main branch is available for game '\(config.game.id)'.")
  }
  guard let predownload = branches.getGameSubBranch(id: config.game.id, predownload: true) else {
    throw ValidationError("No predownload branch is available for game '\(config.game.id)'.")
  }
  let before = try indexCategories(main.categories)
  let after = try indexCategories(predownload.categories)
  let beforeKeys = Set(before.keys)
  let afterKeys = Set(after.keys)
  let changed = beforeKeys.intersection(afterKeys).sorted().compactMap { key -> CategoryChange? in
    guard let old = before[key], let new = after[key],
      old.categoryID != new.categoryID
        || Set(old.scenarios.map(\.rawValue)) != Set(new.scenarios.map(\.rawValue))
    else { return nil }
    return CategoryChange(before: old, after: new)
  }
  return BranchComparison(
    id: config.game.id, biz: config.game.biz, mainTag: main.tag,
    predownloadTag: predownload.tag,
    added: afterKeys.subtracting(beforeKeys).sorted().compactMap { after[$0] },
    removed: beforeKeys.subtracting(afterKeys).sorted().compactMap { before[$0] },
    changed: changed)
}

private func indexCategories(_ categories: [GameBranchCategory]) throws -> [String:
  GameBranchCategory]
{
  var result: [String: GameBranchCategory] = [:]
  for category in categories {
    let key = category.type.rawValue + ":" + category.matchingField
    guard result.updateValue(category, forKey: key) == nil else {
      throw ValidationError("Duplicate branch category '\(key)'.")
    }
  }
  return result
}

struct CategoryChange: Encodable, Sendable {
  let before: GameBranchCategory
  let after: GameBranchCategory
}

struct BranchComparison: Encodable, Sendable {
  let id: String
  let biz: String
  let mainTag: String
  let predownloadTag: String
  let added: [GameBranchCategory]
  let removed: [GameBranchCategory]
  let changed: [CategoryChange]
}
