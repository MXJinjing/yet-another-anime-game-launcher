import Foundation

actor FileCompletionTracker {
  private struct FileProgress {
    let file: PlannedFile
    var remainingWrites: Int
  }
  private var files: [URL: FileProgress] = [:]

  init(plannedFiles: [PlannedFile]) throws {
    for file in plannedFiles where file.requiredChunkCount > 0 {
      let fileURL = file.fileURL.standardizedFileURL

      guard files[fileURL] == nil else {
        throw SophonClientError.DuplicateFileError(
          fileURL.path
        )
      }
      files[fileURL] = FileProgress(
        file: file,
        remainingWrites: file.requiredChunkCount
      )
    }
  }

  /// Returns PlannedFile when this was its final required write.
  func completeWrite(
    to fileURL: URL
  ) throws -> PlannedFile? {
    let fileURL = fileURL.standardizedFileURL
    guard var progress = files[fileURL] else {
      throw SophonClientError.UnknownError(
        "Unexpected write completion for \(fileURL.path)"
      )
    }
    guard progress.remainingWrites > 0 else {
      throw SophonClientError.UnknownError(
        "Too many writes completed for \(fileURL.path)"
      )
    }
    progress.remainingWrites -= 1

    if progress.remainingWrites == 0 {
      files.removeValue(forKey: fileURL)
      return progress.file
    }

    files[fileURL] = progress
    return nil
  }

  func ensureComplete() throws {
    guard files.isEmpty else {
      throw SophonClientError.UnknownError(
        "\(files.count) files still have unfinished writes"
      )
    }
  }
}
