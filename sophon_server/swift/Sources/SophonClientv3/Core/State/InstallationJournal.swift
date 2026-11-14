import Foundation
import HYPAPIClient

public struct SavedInstallationState: Codable, Sendable {
  public let gameID: String
  public let version: String
  public let mode: GameBranchCategoryScenario
  public let voicePacks: [String]
  public let predownload: Bool
  public let plan: InstallationPlan
  public internal(set) var completedApplications: Set<String>
  public internal(set) var trimmedFiles: Set<URL>
  public internal(set) var finished: Bool

  // Rebuild only the pending work from receipts, without opening installation files.
  internal func remainingPlan() -> InstallationPlan {
    var counts: [URL: Int] = [:]
    let chunks = plan.requiredChunks.compactMap { chunk -> RequiredChunk? in
      var remaining = chunk
      remaining.chunkApplicationInfos = chunk.chunkApplicationInfos.filter {
        !completedApplications.contains(
          InstallationJournal.key(chunkID: chunk.chunkID, application: $0))
      }
      guard !remaining.chunkApplicationInfos.isEmpty else { return nil }
      for application in remaining.chunkApplicationInfos {
        counts[application.fileURL, default: 0] += 1
      }
      return remaining
    }
    let files = plan.plannedFiles.compactMap { file -> PlannedFile? in
      let count = counts[file.fileURL, default: 0]
      let trim = file.needsTrimming && !trimmedFiles.contains(file.fileURL)
      guard count > 0 || trim else { return nil }
      return PlannedFile(
        fileURL: file.fileURL, size: file.size, md5: file.md5,
        requiredChunkCount: count, needsTrimming: trim)
    }
    return InstallationPlan(
      totalChunkCount: chunks.count,
      downloadSize: chunks.reduce(0) {
        $0 + ($1.downloadInfo.compression ? $1.compressedSize : $1.uncompressedSize)
      },
      diskWriteSize: chunks.reduce(0) {
        $0 + $1.uncompressedSize * UInt64($1.chunkApplicationInfos.count)
      },
      requiredChunks: chunks, plannedFiles: files)
  }
}

final class InstallationJournal: @unchecked Sendable {
  private struct Record: Codable {
    var application: String? = nil
    var trimmed: URL? = nil
    var finished: Bool? = nil
  }

  private let lock = NSLock()
  private let handle: FileHandle
  private let encoder = JSONEncoder()

  init(directory: URL, state: SavedInstallationState, resume: Bool = false) throws {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let events = directory.appendingPathComponent("events.jsonl")
    if !resume {
      try JSONEncoder().encode(state).write(
        to: directory.appendingPathComponent("plan.json"), options: .atomic)
      try Data().write(to: events, options: .atomic)
    }
    if !FileManager.default.fileExists(atPath: events.path) {
      guard FileManager.default.createFile(atPath: events.path, contents: nil) else {
        throw SophonClientError.UnknownError("Cannot create installation journal")
      }
    }
    handle = try FileHandle(forUpdating: events)
    let saved = try Data(contentsOf: events)
    let validLength = saved.lastIndex(of: 10).map { $0 + 1 } ?? 0
    try handle.truncate(atOffset: UInt64(validLength))
    try handle.seekToEnd()
  }

  static func directory(settings: TransferSettings, gameDirectory: URL) -> URL {
    settings.stateURL.appendingPathComponent(transferKey(gameDirectory.standardizedFileURL.path))
      .appendingPathComponent("install", isDirectory: true)
  }

  static func key(chunkID: String, application: ChunkApplicationInfo) -> String {
    transferKey("\(chunkID):\(application.fileURL.standardizedFileURL.path):\(application.offset)")
  }

  static func load(directory: URL) throws -> SavedInstallationState? {
    let data: Data
    do { data = try Data(contentsOf: directory.appendingPathComponent("plan.json")) } catch {
      if isMissingFile(error) { return nil }
      throw error
    }
    var state = try JSONDecoder().decode(SavedInstallationState.self, from: data)
    let events: Data
    do { events = try Data(contentsOf: directory.appendingPathComponent("events.jsonl")) } catch {
      if isMissingFile(error) { return state }
      throw error
    }
    for line in events.split(separator: 10, omittingEmptySubsequences: false).dropLast() {
      let record = try JSONDecoder().decode(Record.self, from: Data(line))
      if let application = record.application { state.completedApplications.insert(application) }
      if let trimmed = record.trimmed { state.trimmedFiles.insert(trimmed) }
      if record.finished == true { state.finished = true }
    }
    return state
  }

  func written(chunkID: String, application: ChunkApplicationInfo) throws {
    try append(Record(application: Self.key(chunkID: chunkID, application: application)))
  }

  func trimmed(_ fileURL: URL) throws { try append(Record(trimmed: fileURL)) }
  func complete() throws { try append(Record(finished: true)) }

  private func append(_ record: Record) throws {
    try lock.withLock {
      var bytes = try encoder.encode(record)
      bytes.append(10)
      try handle.write(contentsOf: bytes)
    }
  }

  deinit {
    let handle = handle
    transferIOQueue.async { try? handle.close() }
  }
}
