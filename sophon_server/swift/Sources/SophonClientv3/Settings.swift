import Logging

public struct SophonClientSettings: Codable, Sendable {
  public let baseURL: String
  public let sophonBaseURL: String
  public var maxRetries: Int
  public var retryInterval: Int
  public let launcherID: String
  public let gameID: String
  public let manifestCacheDir: String
  public var logStdout: Bool
  public var logFile: String?
  public var logLevel: Logger.Level

  public var maxCocurrentChecks: Int
  public var maxCocurrentDownloads: Int
  public var maxCocurrentPostProcessors: Int
  public var maxCocurrentWrites: Int
  public var maxCachedFileHandles: Int
  public var transfer: TransferSettings

  public init(
    baseURL: String, sophonBaseURL: String, maxRetries: Int = 10, retryInterval: Int = 5,
    launcherID: String, gameID: String, manifestCacheDir: String,
    logStdout: Bool = true, logFile: String? = nil, logLevel: Logger.Level = .info,
    maxCocurrentChecks: Int = 8, maxCocurrentDownloads: Int = 8,
    maxCocurrentPostProcessors: Int = 4, maxCocurrentWrites: Int = 4,
    maxCachedFileHandles: Int = 512, transfer: TransferSettings = TransferSettings()
  ) {
    self.baseURL = baseURL
    self.sophonBaseURL = sophonBaseURL
    self.maxRetries = maxRetries
    self.retryInterval = retryInterval
    self.launcherID = launcherID
    self.gameID = gameID
    self.manifestCacheDir = manifestCacheDir
    self.logStdout = logStdout
    self.logFile = logFile
    self.logLevel = logLevel
    self.maxCocurrentChecks = maxCocurrentChecks
    self.maxCocurrentDownloads = maxCocurrentDownloads
    self.maxCocurrentPostProcessors = maxCocurrentPostProcessors
    self.maxCocurrentWrites = maxCocurrentWrites
    self.maxCachedFileHandles = maxCachedFileHandles
    self.transfer = transfer
  }

  private enum CodingKeys: String, CodingKey {
    case baseURL, sophonBaseURL, maxRetries, retryInterval, launcherID, gameID, manifestCacheDir
    case logStdout, logFile, logLevel
    case maxCocurrentChecks, maxCocurrentDownloads, maxCocurrentPostProcessors, maxCocurrentWrites
    case maxCachedFileHandles
    case transfer
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.init(
      baseURL: try container.decode(String.self, forKey: .baseURL),
      sophonBaseURL: try container.decode(String.self, forKey: .sophonBaseURL),
      launcherID: try container.decode(String.self, forKey: .launcherID),
      gameID: try container.decode(String.self, forKey: .gameID),
      manifestCacheDir: try container.decode(String.self, forKey: .manifestCacheDir))

    maxRetries = try container.decodeIfPresent(Int.self, forKey: .maxRetries) ?? maxRetries
    retryInterval = try container.decodeIfPresent(Int.self, forKey: .retryInterval) ?? retryInterval
    logStdout = try container.decodeIfPresent(Bool.self, forKey: .logStdout) ?? logStdout
    logFile = try container.decodeIfPresent(String.self, forKey: .logFile)
    logLevel =
      try container.decodeIfPresent(Logger.Level.self, forKey: .logLevel) ?? logLevel
    maxCocurrentChecks =
      try container.decodeIfPresent(Int.self, forKey: .maxCocurrentChecks) ?? maxCocurrentChecks
    maxCocurrentDownloads =
      try container.decodeIfPresent(Int.self, forKey: .maxCocurrentDownloads)
      ?? maxCocurrentDownloads
    maxCocurrentPostProcessors =
      try container.decodeIfPresent(Int.self, forKey: .maxCocurrentPostProcessors)
      ?? maxCocurrentPostProcessors
    maxCocurrentWrites =
      try container.decodeIfPresent(Int.self, forKey: .maxCocurrentWrites) ?? maxCocurrentWrites
    maxCachedFileHandles =
      try container.decodeIfPresent(Int.self, forKey: .maxCachedFileHandles) ?? maxCachedFileHandles
    transfer = try container.decodeIfPresent(TransferSettings.self, forKey: .transfer) ?? transfer
  }
}
