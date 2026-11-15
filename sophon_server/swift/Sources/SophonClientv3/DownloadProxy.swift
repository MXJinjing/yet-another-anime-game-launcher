import Foundation

#if os(macOS)
  import Network
#elseif canImport(FoundationNetworking)
  import FoundationNetworking
#endif

/// The launcher and aria2 use an HTTP proxy for both HTTP and HTTPS destinations.
public struct DownloadProxy: Sendable {
  let host: String
  let port: Int
  private let user: String?
  private let password: String?

  public init(_ address: String) throws {
    let input = address.trimmingCharacters(in: .whitespacesAndNewlines)
    let url = input.contains("://") ? input : "http://" + input
    guard let parts = URLComponents(string: url),
      let scheme = parts.scheme?.lowercased(), ["http", "https"].contains(scheme),
      let host = parts.host, !host.isEmpty,
      host.rangeOfCharacter(from: .whitespacesAndNewlines) == nil,
      parts.path.isEmpty || parts.path == "/", parts.query == nil, parts.fragment == nil,
      (1...65535).contains(parts.port ?? 80)
    else {
      throw DownloadProxyError.invalidAddress
    }
    #if os(macOS)
      if parts.user != nil {
        guard #available(macOS 14.0, *) else {
          throw DownloadProxyError.authenticationUnavailable
        }
      }
    #else
      throw DownloadProxyError.unavailable
    #endif
    self.host = host.trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
    port = parts.port ?? 80
    user = parts.user
    password = parts.password
  }

  func configuration() -> URLSessionConfiguration {
    let config = URLSessionConfiguration.ephemeral
    #if os(macOS)
      if #available(macOS 14.0, *), let user {
        let endpoint = NWEndpoint.hostPort(
          host: NWEndpoint.Host(host), port: NWEndpoint.Port(integerLiteral: UInt16(port)))
        var proxy = ProxyConfiguration(httpCONNECTProxy: endpoint)
        proxy.applyCredential(username: user, password: password ?? "")
        proxy.allowFailover = false
        config.proxyConfigurations = [proxy]
        return config
      }
    #endif
    config.connectionProxyDictionary = [
      "HTTPEnable": 1, "HTTPProxy": host, "HTTPPort": port,
      "HTTPSEnable": 1, "HTTPSProxy": host, "HTTPSPort": port,
    ]
    return config
  }

  public func makeMetadataSession() -> URLSession {
    URLSession(configuration: configuration())
  }
}

private enum DownloadProxyError: LocalizedError {
  case invalidAddress, authenticationUnavailable, unavailable

  var errorDescription: String? {
    switch self {
    case .invalidAddress: "Invalid HTTP download proxy. Enter a host and optional port."
    case .authenticationUnavailable:
      "HTTP download proxy authentication requires macOS 14 or later."
    case .unavailable: "HTTP download proxy is only available on macOS."
    }
  }
}
