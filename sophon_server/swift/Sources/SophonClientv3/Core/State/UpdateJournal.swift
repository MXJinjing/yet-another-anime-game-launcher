import Foundation
import HYPAPIClient

public enum UpdateFileStage: String, Codable, Sendable {
  case writing
  case repair
  case completed
  case cachedPatch
  case cachedRepair
}

public struct SavedUpdateState: Codable, Sendable {
  public let gameID: String
  public let mode: GameBranchCategoryScenario
  public let predownload: Bool
  public let cacheOnly: Bool
  public let predownloadDirectory: String?
  public let plan: UpdatePlan
  public let files: [String: UpdateFileStage]
  public let finished: Bool
}

final class UpdateJournal: @unchecked Sendable {
  private struct Record: Codable {
    let path: String?
    let stage: UpdateFileStage?
    var finished: Bool? = nil
  }

  private let lock = NSLock()
  private let handle: FileHandle
  private let encoder = JSONEncoder()
  private var files: [String: UpdateFileStage]
  let plan: UpdatePlan

  init(
    directory: URL, plan: UpdatePlan, gameID: String = "", mode: GameBranchCategoryScenario = .full,
    predownload: Bool = false, cacheOnly: Bool = false, predownloadDirectory: String? = nil,
    ignoredFiles: Set<String> = []
  ) throws {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let planURL = directory.appendingPathComponent("plan.json")
    let eventsURL = directory.appendingPathComponent("events.jsonl")
    let saved = try Self.load(directory: directory)
    let canResume =
      saved.map {
        $0.gameID == gameID && $0.mode == mode && $0.plan.sourceVersion == plan.sourceVersion
          && $0.plan.targetVersion == plan.targetVersion
          && ($0.predownload == predownload || $0.cacheOnly)
          && (!$0.cacheOnly ? !cacheOnly : true)
      } ?? false
    if let saved, !saved.finished, !saved.cacheOnly, !canResume {
      throw SophonClientError.UnknownError(
        "An unfinished update must be resumed or reconciled before starting another")
    }
    let selectedPlan: UpdatePlan
    if let saved, canResume, !saved.finished || saved.cacheOnly {
      selectedPlan = saved.plan
      files = saved.files
    } else {
      selectedPlan = plan
      files = [:]
    }
    self.plan = excludingIgnoredFiles(from: selectedPlan, ignoredFiles: ignoredFiles)
    // Reset receipts before the new snapshot. A kill between these writes can repeat work,
    // but cannot carry an old finished record into a new execution mode.
    try Data().write(to: eventsURL, options: .atomic)
    let state = SavedUpdateState(
      gameID: gameID, mode: mode, predownload: predownload, cacheOnly: cacheOnly,
      predownloadDirectory: predownloadDirectory,
      plan: self.plan, files: files, finished: false)
    try JSONEncoder().encode(state).write(to: planURL, options: .atomic)
    handle = try FileHandle(forUpdating: eventsURL)
    let events = try Data(contentsOf: eventsURL)
    let validLength = events.lastIndex(of: 10).map { $0 + 1 } ?? 0
    try handle.truncate(atOffset: UInt64(validLength))
    try handle.seekToEnd()
  }

  static func directory(settings: TransferSettings, gameDirectory: URL) -> URL {
    settings.stateURL.appendingPathComponent(transferKey(gameDirectory.standardizedFileURL.path))
      .appendingPathComponent("update", isDirectory: true)
  }

  static func load(directory: URL) throws -> SavedUpdateState? {
    let planURL = directory.appendingPathComponent("plan.json")
    let eventsURL = directory.appendingPathComponent("events.jsonl")
    let data: Data
    do { data = try Data(contentsOf: planURL) } catch {
      if isMissingFile(error) { return nil }
      throw error
    }
    let initial = try JSONDecoder().decode(SavedUpdateState.self, from: data)
    let events: Data
    do { events = try Data(contentsOf: eventsURL) } catch {
      if isMissingFile(error) { return initial }
      throw error
    }
    var files = initial.files
    var finished = initial.finished
    for line in events.split(separator: 10, omittingEmptySubsequences: false).dropLast() {
      let record = try JSONDecoder().decode(Record.self, from: Data(line))
      if let path = record.path, let stage = record.stage { files[path] = stage }
      if record.finished == true { finished = true }
    }
    return SavedUpdateState(
      gameID: initial.gameID, mode: initial.mode, predownload: initial.predownload,
      cacheOnly: initial.cacheOnly, predownloadDirectory: initial.predownloadDirectory,
      plan: initial.plan, files: files, finished: finished)
  }

  func stage(of fileURL: URL) -> UpdateFileStage? {
    lock.withLock { files[fileURL.path] }
  }

  func record(_ fileURL: URL, stage: UpdateFileStage) throws {
    try lock.withLock {
      try append(Record(path: fileURL.path, stage: stage))
      files[fileURL.path] = stage
    }
  }

  func complete() throws {
    try lock.withLock {
      try append(Record(path: nil, stage: nil, finished: true))
    }
  }

  private func append(_ record: Record) throws {
    var bytes = try encoder.encode(record)
    bytes.append(10)
    try handle.write(contentsOf: bytes)
  }

  deinit {
    let handle = handle
    transferIOQueue.async { try? handle.close() }
  }
}
