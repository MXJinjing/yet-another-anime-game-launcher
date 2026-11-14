import Foundation

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

func convert<To: LosslessStringConvertible>(_ from: String) throws -> To {
  guard let temp = To(from) else {
    throw ValidationError.StringConversionError(from)
  }
  return temp
}

func parseURL(_ urlString: String) throws -> URL {
  guard let temp = URL(string: urlString) else {
    throw ValidationError.InvalidURL(urlString)
  }
  return temp
}
