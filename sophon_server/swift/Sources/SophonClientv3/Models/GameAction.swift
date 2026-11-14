import Foundation
import HYPAPIClient

public struct InstalledVersion: Codable, Sendable {
  public let version: String?
  public let executableMD5: String?
  public let candidates: [String]
}

public enum GameActionKind: String, Codable, Sendable {
  case resumeInstall
  case resumeUpdate
  case install
  case update
  case cacheUpdate
  case none
}

public struct GameAction: Codable, Sendable {
  public let action: GameActionKind
  public let sourceVersion: String?
  public let targetVersion: String
  public let predownload: Bool
  public let cacheOnly: Bool
  public let mode: GameBranchCategoryScenario
  public let voicePacks: [String]
  public let reason: String

  internal init(
    _ action: GameActionKind, source: String? = nil, target: String,
    predownload: Bool = false, cacheOnly: Bool = false,
    mode: GameBranchCategoryScenario = .full, voicePacks: [String] = [], reason: String
  ) {
    self.action = action
    sourceVersion = source
    targetVersion = target
    self.predownload = predownload
    self.cacheOnly = cacheOnly
    self.mode = mode
    self.voicePacks = voicePacks
    self.reason = reason
  }
}

internal func resolveInstalledVersion(
  md5: String?, gameID: String, records: GameScanInfos, completedVersion: String?,
  manifestExecutable: (version: String, md5: String)? = nil
) -> InstalledVersion {
  var candidates = Set(
    records.gameScanInfo.filter { $0.gameID == gameID }.flatMap(\.gameExeList)
      .filter { $0.md5.lowercased() == md5?.lowercased() }.map(\.version)
  ).sorted()
  if candidates.isEmpty, let md5, !md5.isEmpty, let manifestExecutable,
    !manifestExecutable.version.isEmpty,
    md5.lowercased() == manifestExecutable.md5.lowercased()
  {
    candidates = [manifestExecutable.version]
  }
  let version =
    candidates.count == 1
    ? candidates.first
    : completedVersion.flatMap { candidates.contains($0) ? $0 : nil }
  return InstalledVersion(version: version, executableMD5: md5, candidates: candidates)
}

internal func decideGameAction(
  installed: InstalledVersion, live: GameSubBranch, future: GameSubBranch?,
  installation: SavedInstallationState?, update: SavedUpdateState?, futureCached: Bool,
  voicePacks: [String] = []
) -> GameAction {
  if let installation, !installation.finished {
    if installation.version == live.tag {
      return GameAction(
        .resumeInstall, target: live.tag, predownload: false,
        mode: installation.mode,
        voicePacks: Array(Set(installation.voicePacks + voicePacks)).sorted(),
        reason: "Resume the saved installation plan")
    }
    return GameAction(
      .install, target: live.tag, voicePacks: voicePacks,
      reason:
        "The unfinished installation targets an obsolete version; verify against the live manifest")
  }
  if let update, !update.finished, !update.cacheOnly {
    if update.plan.targetVersion == live.tag {
      return GameAction(
        .resumeUpdate, source: update.plan.sourceVersion, target: live.tag,
        mode: update.mode, voicePacks: voicePacks,
        reason: "Resume the saved update plan")
    }
    return GameAction(
      .install, target: live.tag, voicePacks: voicePacks,
      reason: "The unfinished update contains mixed versions; reconcile against the live manifest")
  }
  guard let source = installed.version else {
    return GameAction(
      .install, target: live.tag, voicePacks: voicePacks,
      reason:
        "The executable version is unknown or ambiguous; verify using the installation manifest")
  }
  if let update, !update.finished, update.cacheOnly, update.plan.sourceVersion == source,
    update.plan.targetVersion == (update.predownload ? future?.tag : live.tag)
  {
    return GameAction(
      .resumeUpdate, source: source, target: update.plan.targetVersion,
      predownload: update.predownload, cacheOnly: true, mode: update.mode, voicePacks: voicePacks,
      reason: "Resume the saved cache-only update")
  }
  if source != live.tag {
    if source == future?.tag {
      return GameAction(
        .none, source: source, target: source, voicePacks: voicePacks,
        reason: "The future version is already installed")
    }
    if live.diffTags.contains(source) {
      return GameAction(
        .update, source: source, target: live.tag, voicePacks: voicePacks,
        reason: "A direct update to the live version is available")
    }
    return GameAction(
      .install, source: source, target: live.tag, voicePacks: voicePacks,
      reason: "No direct update is advertised; use the installation manifest")
  }
  if let future, future.tag != live.tag, future.diffTags.contains(source),
    !futureCached
  {
    return GameAction(
      .cacheUpdate, source: source, target: future.tag,
      predownload: true, cacheOnly: true, voicePacks: voicePacks,
      reason: "Cache the available future update")
  }
  return GameAction(
    .none, source: source, target: live.tag, voicePacks: voicePacks,
    reason: futureCached
      ? "The live version is installed and the future update is cached"
      : "The live version is installed")
}
