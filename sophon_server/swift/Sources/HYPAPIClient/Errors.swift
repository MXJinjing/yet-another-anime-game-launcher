import Foundation

enum APIClientError: Error {
  case InvalidHTTPResponse
  case BadStatusCode(_ statusCode: Int)
  case APIError(_ retCode: Int)
}

enum ValidationError: Error {
  case StringConversionError(_ badString: String)
  case InvalidURL(_ invalidURL: String)
  case InvalidRetCode(_ invalidRetCode: Int)
}

extension APIClientError: LocalizedError {
  var errorDescription: String? {
    switch self {
    case .InvalidHTTPResponse:
      return "The HYP API returned a non-HTTP response."
    case .BadStatusCode(let statusCode):
      return "HYP API request failed with HTTP status \(statusCode)."
    case .APIError(let retCode):
      return "HYP API request failed with error code \(retCode)."
    }
  }
}

extension ValidationError: LocalizedError {
  var errorDescription: String? {
    switch self {
    case .StringConversionError(let value):
      return "Cannot convert '\(value)' to the required type."
    case .InvalidURL(let url):
      return "Invalid URL: \(url)"
    case .InvalidRetCode(let code):
      return "Invalid API return code: \(code)"
    }
  }
}
