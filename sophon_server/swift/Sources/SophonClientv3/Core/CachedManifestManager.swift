import Foundation
import HYPAPIClient
import SwiftProtobuf

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

final class CachedManifestManager: Sendable {
  private let gameID: String
  internal let apiClient: HYPAPIClient
  private let manifestCacheDir: URL
  private let session: URLSession
  private let maxRetries: Int
  private let retryInterval: Int

  private let gameLaunchConfig: GameLaunchConfig
  private let gameBranches: GameBranches

  internal init(
    baseURL: String, sophonBaseURL: String, launcherID: String, gameID: String,
    manifestCacheDir: String, maxRetries: Int = 10,
    retryInterval: Int = 5, session: URLSession = .shared
  ) async throws {
    self.session = session
    self.gameID = gameID
    self.maxRetries = maxRetries
    self.retryInterval = retryInterval
    self.apiClient = try HYPAPIClient(
      baseURL: baseURL, sophonBaseURL: sophonBaseURL, launcherID: launcherID,
      maxRetries: maxRetries, retryInterval: retryInterval, session: session)
    guard let temp = try await apiClient.getGameConfigs().findBy(id: gameID) else {
      throw SophonClientError.CannotFindValidGameError(gameID)
    }
    gameLaunchConfig = temp
    gameBranches = try await apiClient.getGameBranches()

    self.manifestCacheDir = URL(filePath: manifestCacheDir)

    var isDirectory: ObjCBool = false
    if FileManager.default.fileExists(atPath: self.manifestCacheDir.path, isDirectory: &isDirectory)
    {
      if !isDirectory.boolValue {
        throw SophonClientError.InvalidManifestCacheDirectory(
          self.manifestCacheDir.path, "Specified path is a file, not a directory")
      }
    } else {
      try FileManager.default.createDirectory(
        at: self.manifestCacheDir, withIntermediateDirectories: true)
    }
  }

  internal func getGameLaunchConfig() -> GameLaunchConfig {
    return gameLaunchConfig
  }

  internal func getGameSubbranch(predownload: Bool = false) throws -> GameSubBranch {
    guard let subBranch = gameBranches.getGameSubBranch(id: gameID, predownload: predownload) else {
      if predownload {
        throw SophonClientError.PredownloadNotAvailableError
      }
      throw SophonClientError.UnknownError("Failed to get sophon main branch contents.")
    }

    return subBranch
  }

  internal func checkCache(key: String) throws -> Data? {
    // key should be cache data md5
    let targetPath = self.manifestCacheDir.appendingPathComponent(key)

    var isDirectory: ObjCBool = false
    if FileManager.default.fileExists(atPath: targetPath.path, isDirectory: &isDirectory) {
      if isDirectory.boolValue {
        try FileManager.default.removeItem(at: targetPath)
        return nil
      }
      let data = try Data(contentsOf: targetPath)
      if md5Hex(data) != key {
        try FileManager.default.removeItem(at: targetPath)
        return nil
      }
      return data
    }
    return nil
  }

  internal func writeCache(key: String, data: Data) throws {
    // key should be cache data md5
    let targetPath = self.manifestCacheDir.appendingPathComponent(key)
    try data.write(to: targetPath, options: .atomic)
  }

  private func _getManifest<Message: SwiftProtobuf.Message>(
    manifest: SophonManifestProperty, downloadInfo: SophonDownloadInfo, refresh: Bool = false
  ) async throws -> Message {
    let url = try downloadInfo.buildDownloadURL(manifest.id)
    let md5Target = manifest.checksum
    let isCompressed = downloadInfo.compression
    let isEncrypted = downloadInfo.encryption
    let password = downloadInfo.password
    guard manifest.compressedSize >= 0, manifest.uncompressedSize >= 0 else {
      throw SophonClientError.UnsupportedManifestConfiguration("Invalid manifest size")
    }
    let compressedSize = UInt64(manifest.compressedSize)
    let uncompressedSize = UInt64(manifest.uncompressedSize)
    guard md5Target.utf8.count == 32,
      md5Target.utf8.allSatisfy({
        (48...57).contains($0) || (97...102).contains($0)
      })
    else { throw SophonClientError.UnsupportedManifestConfiguration("Invalid manifest checksum") }

    guard let cachedData = refresh ? nil : try checkCache(key: md5Target) else {
      var request = URLRequest(url: url)
      request.httpMethod = "GET"

      if isEncrypted || !password.isEmpty {
        throw SophonClientError.UnsupportedManifestConfiguration(
          "Encrypted sophon manifest not supported")
      }

      var lastError: Error?

      for attempt in 0...maxRetries {
        do {
          let (downloadData, response) = try await session.data(for: request)

          guard let response = response as? HTTPURLResponse else {
            throw SophonClientError.InvalidHTTPResponse
          }
          guard (200..<300).contains(response.statusCode) else {
            throw SophonClientError.InvalidHTTPStatus(response.statusCode)
          }

          let data: Data
          if isCompressed {
            guard UInt64(downloadData.count) == compressedSize else {
              throw SophonClientError.SizeMismatch(
                expected: compressedSize, actual: UInt64(downloadData.count))
            }
            data = try decompressZstd(downloadData, uncompressedSize: Int(uncompressedSize))
          } else {
            guard UInt64(downloadData.count) == uncompressedSize else {
              throw SophonClientError.SizeMismatch(
                expected: uncompressedSize, actual: UInt64(downloadData.count))
            }
            data = downloadData
          }

          let checksum = md5Hex(data)
          guard checksum == md5Target else {
            throw SophonClientError.InvalidChecksumError(expected: checksum, actual: md5Target)
          }

          try writeCache(key: md5Target, data: data)
          return try Message(serializedBytes: data)
        } catch {
          lastError = error

          if attempt < maxRetries {
            try await Task.sleep(for: .seconds(retryInterval))
          }
        }
      }

      throw lastError
        ?? SophonClientError.UnknownError(
          "Downloading manifest failed with an error but there is no error")
    }

    return try Message(serializedBytes: cachedData)
  }

  func exactBuild(version: String?) async throws -> SophonBuildInfo {
    if let version,
      version.range(of: #"^[0-9]+\.[0-9]+\.[0-9]+$"#, options: .regularExpression) == nil
    {
      throw SelectionError.invalid(version)
    }
    let build = try await apiClient.getSophonBuildInfo(getGameSubbranch(), version: version)
    if let version, version != build.tag { throw SelectionError.version(version, build.tag) }
    guard !build.manifests.isEmpty else { throw SelectionError.missing(build.tag) }
    return build
  }

  func selectedManifest(
    _ build: SophonBuildInfo, category: String, refresh: Bool = false
  ) async throws -> (Manifest, SophonDownloadInfo) {
    let matches = build.manifests.filter { $0.matchingField == category }
    guard matches.count == 1, let info = matches.first else {
      throw SelectionError.missing(category)
    }
    let manifest: Manifest = try await _getManifest(
      manifest: info.manifest, downloadInfo: info.manifestDownload, refresh: refresh)
    guard !manifest.files.isEmpty else { throw SelectionError.missing(category) }
    return (manifest, info.chunkDownload)
  }

  internal func getSophonManifest(
    matchingField: String, predownload: Bool = false,
    reporter: InstallationReporter? = nil
  ) async throws
    -> (Manifest, SophonDownloadInfo)
  {
    // returns manifest and sophon chunk download info
    await reporter?.record(.phaseChanged(.metadata))
    let sophonBuildInfo = try await apiClient.getSophonBuildInfo(
      getGameSubbranch(predownload: predownload))
    guard let sophonManifestInfo = sophonBuildInfo.find(matchingField) else {
      throw SophonClientError.InvalidManifestMatchingFieldError(matchingField)
    }

    let manifest: Manifest = try await _getManifest(
      manifest: sophonManifestInfo.manifest, downloadInfo: sophonManifestInfo.manifestDownload)
    await reporter?.record(.manifestPulled(matchingField: matchingField, predownload: predownload))
    return (manifest, sophonManifestInfo.chunkDownload)
  }

  internal func getSophonPatchManifest(
    matchingField: String, predownload: Bool = false
  ) async throws -> (DiffManifest, SophonDownloadInfo) {
    let sophonPatchBuildInfo = try await apiClient.getSophonPatchBuildInfo(
      getGameSubbranch(predownload: predownload))
    guard let sophonPatchManifestInfo = sophonPatchBuildInfo.find(matchingField) else {
      throw SophonClientError.InvalidManifestMatchingFieldError(matchingField)
    }

    let manifest: DiffManifest = try await _getManifest(
      manifest: sophonPatchManifestInfo.manifest,
      downloadInfo: sophonPatchManifestInfo.manifestDownload)
    return (manifest, sophonPatchManifestInfo.diffDownload)
  }

  internal func getUpdateInfos(
    matchingFields: Set<String>, branch: GameSubBranch, reporter: UpdateReporter? = nil
  ) async throws -> (
    install: [(manifest: Manifest, chunkDownloadInfo: SophonDownloadInfo)],
    update: [(manifest: DiffManifest, diffDownloadInfo: SophonDownloadInfo)]
  ) {
    async let installation = apiClient.getSophonBuildInfo(branch)
    async let update = apiClient.getSophonPatchBuildInfo(branch)
    let builds = try await (installation, update)
    return try await withThrowingTaskGroup(
      of: (Manifest, SophonDownloadInfo, DiffManifest, SophonDownloadInfo).self
    ) { group in
      for field in matchingFields {
        guard let installInfo = builds.0.find(field), let updateInfo = builds.1.find(field) else {
          throw SophonClientError.InvalidManifestMatchingFieldError(field)
        }
        group.addTask { [self] in
          let installation: Manifest = try await _getManifest(
            manifest: installInfo.manifest, downloadInfo: installInfo.manifestDownload)
          await reporter?.record(.manifestPulled(kind: "install", matchingField: field))
          let update: DiffManifest = try await _getManifest(
            manifest: updateInfo.manifest, downloadInfo: updateInfo.manifestDownload)
          await reporter?.record(.manifestPulled(kind: "diff", matchingField: field))
          return (installation, installInfo.chunkDownload, update, updateInfo.diffDownload)
        }
      }
      var install: [(Manifest, SophonDownloadInfo)] = []
      var update: [(DiffManifest, SophonDownloadInfo)] = []
      for try await result in group {
        install.append((result.0, result.1))
        update.append((result.2, result.3))
      }
      return (install, update)
    }
  }

  internal func getInstallInfos(
    matchingFields: Set<String>, branch: GameSubBranch, predownload: Bool,
    reporter: InstallationReporter
  ) async throws -> [(Manifest, SophonDownloadInfo)] {
    let build = try await apiClient.getSophonBuildInfo(branch)
    return try await withThrowingTaskGroup(of: (Manifest, SophonDownloadInfo).self) { group in
      for field in matchingFields {
        guard let info = build.find(field) else {
          throw SophonClientError.InvalidManifestMatchingFieldError(field)
        }
        group.addTask { [self] in
          let manifest: Manifest = try await _getManifest(
            manifest: info.manifest, downloadInfo: info.manifestDownload)
          await reporter.record(.manifestPulled(matchingField: field, predownload: predownload))
          return (manifest, info.chunkDownload)
        }
      }
      var infos: [(Manifest, SophonDownloadInfo)] = []
      for try await info in group { infos.append(info) }
      return infos
    }
  }
}
