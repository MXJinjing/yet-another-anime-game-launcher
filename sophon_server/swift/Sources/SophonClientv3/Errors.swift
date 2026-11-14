import Foundation

enum SophonClientError: Error {
  case CannotFindValidGameError(_ gameBiz: String)
  case InvalidGameBranchError(_ gameBiz: String, _ gameBranch: String)
  case InvalidManifestCacheDirectory(_ manifestCacheDir: String, _ reason: String)
  case InvalidManifestMatchingFieldError(_ matchingField: String)
  case InvalidHTTPResponse
  case InvalidHTTPStatus(_ code: Int)
  case SizeMismatch(expected: UInt64, actual: UInt64)
  case ZstdError(_ errString: String)
  case UnsupportedManifestConfiguration(_ reason: String)
  case UnknownError(_ reason: String)
  case PredownloadNotAvailableError
  case InvalidChecksumError(expected: String, actual: String)
  case DuplicateFileError(_ fileName: String)
  case UnknownVoicePackError(_ matchingField: String)
  case GameScenarioUnsupportedError(gameID: String, gameBiz: String)
}

extension SophonClientError: LocalizedError {
  var errorDescription: String? {
    switch self {
    case .CannotFindValidGameError(let gameBiz):
      return "No valid game was found for '\(gameBiz)'."
    case .InvalidGameBranchError(let gameBiz, let gameBranch):
      return "Invalid branch '\(gameBranch)' for game '\(gameBiz)'."
    case .InvalidManifestCacheDirectory(let directory, let reason):
      return "Invalid manifest cache directory '\(directory)': \(reason)"
    case .InvalidManifestMatchingFieldError(let matchingField):
      return "No manifest was found for matching field '\(matchingField)'."
    case .InvalidHTTPResponse:
      return "The server returned a non-HTTP response."
    case .InvalidHTTPStatus(let code):
      return "Download request failed with HTTP status \(code)."
    case .SizeMismatch(let expected, let actual):
      return "Size mismatch: expected \(expected) bytes, got \(actual) bytes."
    case .ZstdError(let message):
      return "Zstandard decompression failed: \(message)"
    case .UnsupportedManifestConfiguration(let reason):
      return "Unsupported manifest configuration: \(reason)"
    case .UnknownError(let reason):
      return reason
    case .PredownloadNotAvailableError:
      return "Predownload is not available for this game."
    case .InvalidChecksumError(let expected, let actual):
      return "Checksum mismatch: expected '\(expected)', got '\(actual)'."
    case .DuplicateFileError(let fileName):
      return "Duplicate file: \(fileName)"
    case .UnknownVoicePackError(let matchingField):
      return "Unknown voice pack: \(matchingField)"
    case .GameScenarioUnsupportedError(let gameID, let gameBiz):
      return
        "Partial download (full/base install) not supported for gameID: \(gameID), gameBiz: \(gameBiz)"
    }
  }
}
