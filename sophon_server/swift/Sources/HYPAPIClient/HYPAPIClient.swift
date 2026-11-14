import Foundation

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

public final class HYPAPIClient: Sendable {
  private let baseURL: URL
  private let sophonBaseURL: URL
  private let launcherID: String
  private let session: URLSession
  private let maxRetries: Int
  private let retryInterval: Int

  public init(
    baseURL: String, sophonBaseURL: String, launcherID: String, maxRetries: Int = 10,
    retryInterval: Int = 5,
    session: URLSession = .shared
  ) throws {
    self.baseURL = try parseURL(baseURL)
    self.sophonBaseURL = try parseURL(sophonBaseURL)

    self.launcherID = launcherID
    self.session = session
    self.maxRetries = maxRetries
    self.retryInterval = retryInterval
  }

  private func _getAPIGetURL(_ route: String) -> URL {
    return baseURL.appendingPathComponent(route).appending(queryItems: [
      URLQueryItem(name: "launcher_id", value: launcherID)
    ])
  }

  private func _getSophonRequestURL(_ route: String, gameSubBranch: GameSubBranch) -> URL {
    return sophonBaseURL.appendingPathComponent(route).appending(queryItems: [
      URLQueryItem(name: "package_id", value: gameSubBranch.packageID),
      URLQueryItem(name: "branch", value: gameSubBranch.branch),
      URLQueryItem(name: "password", value: gameSubBranch.password),
    ])
  }

  private func _makeAPIRequest<ResponseType: Codable & Sendable>(
    _ endpointURL: URL, method: String = "GET"
  ) async throws -> ResponseType {
    var request = URLRequest(url: endpointURL)
    request.httpMethod = method
    request.setValue("application/json", forHTTPHeaderField: "Accept")

    var lastError: Error?

    for attempt in 0...maxRetries {
      do {
        let (data, response) = try await session.data(for: request)

        guard let response = response as? HTTPURLResponse else {
          throw APIClientError.InvalidHTTPResponse
        }

        guard (200..<300).contains(response.statusCode) else {
          throw APIClientError.BadStatusCode(response.statusCode)
        }
        //          print(String(data: data, encoding: .utf8)!)

        let apiResponse = try JSONDecoder().decode(
          HYPAPIResponse<ResponseType>.self,
          from: data
        )

        guard apiResponse.retcode == 0 else {
          throw APIClientError.APIError(apiResponse.retcode)
        }

        return apiResponse.data
      } catch {
        lastError = error

        if attempt < maxRetries {
          try await Task.sleep(for: .seconds(retryInterval))
        }
      }
    }

    throw lastError ?? APIClientError.InvalidHTTPResponse
  }

  public func getGames(language: String = "en-us") async throws -> Games {
    return try await _makeAPIRequest(
      _getAPIGetURL(GET_GAMES_ROUTE).appending(queryItems: [
        URLQueryItem(name: "language", value: language)
      ]))
  }

  public func getGameBranches() async throws -> GameBranches {
    return try await _makeAPIRequest(
      _getAPIGetURL(GET_GAME_BRANCHES_ROUTE))
  }

  public func getGameConfigs() async throws -> GameConfigs {
    return try await _makeAPIRequest(
      _getAPIGetURL(GET_GAME_CONFIGS_ROUTE))
  }

  public func getGameScanInfo() async throws -> GameScanInfos {
    return try await _makeAPIRequest(
      _getAPIGetURL(GET_GAME_SCAN_INFO_ROUTE))
  }

  public func getWPFPackages() async throws -> WPFPackages {
    return try await _makeAPIRequest(
      _getAPIGetURL(GET_WPF_PACKAGES_ROUTE))
  }

  public func getSophonBuildInfo(
    _ gameSubBranch: GameSubBranch, version: String? = nil
  ) async throws -> SophonBuildInfo {
    let url = _getSophonRequestURL(GET_SOPHON_BUILD_ROUTE, gameSubBranch: gameSubBranch)
    return try await _makeAPIRequest(
      version.map { url.appending(queryItems: [.init(name: "tag", value: $0)]) } ?? url)
  }

  public func getSophonPatchBuildInfo(_ gameSubBranch: GameSubBranch) async throws
    -> SophonPatchBuildInfo
  {
    return try await _makeAPIRequest(
      _getSophonRequestURL(GET_SOPHON_PATCH_BUILD_ROUTE, gameSubBranch: gameSubBranch),
      method: "POST")
  }
}
