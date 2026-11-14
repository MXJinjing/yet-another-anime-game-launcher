import Foundation
import HYPAPIClient
import SophonClientv3

indirect enum JSONValue: Codable, Sendable {
  case object([String: JSONValue])
  case array([JSONValue])
  case string(String)
  case integer(Int64)
  case unsigned(UInt64)
  case decimal(Double)
  case bool(Bool)
  case null
  case encoded(any Encodable & Sendable)

  init(from decoder: any Decoder) throws {
    let value = try decoder.singleValueContainer()
    if value.decodeNil() {
      self = .null
    } else if let object = try? value.decode([String: JSONValue].self) {
      self = .object(object)
    } else if let array = try? value.decode([JSONValue].self) {
      self = .array(array)
    } else if let string = try? value.decode(String.self) {
      self = .string(string)
    } else if let bool = try? value.decode(Bool.self) {
      self = .bool(bool)
    } else if let integer = try? value.decode(Int64.self) {
      self = .integer(integer)
    } else if let unsigned = try? value.decode(UInt64.self) {
      self = .unsigned(unsigned)
    } else {
      self = .decimal(try value.decode(Double.self))
    }
  }

  func encode(to encoder: any Encoder) throws {
    var value = encoder.singleValueContainer()
    switch self {
    case .object(let object): try value.encode(object)
    case .array(let array): try value.encode(array)
    case .string(let string): try value.encode(string)
    case .integer(let integer): try value.encode(integer)
    case .unsigned(let unsigned): try value.encode(unsigned)
    case .decimal(let decimal): try value.encode(decimal)
    case .bool(let bool): try value.encode(bool)
    case .null: try value.encodeNil()
    case .encoded(let payload): try payload.encode(to: encoder)
    }
  }

  var string: String? {
    if case .string(let value) = self { return value }
    return nil
  }
  var object: [String: JSONValue]? {
    if case .object(let value) = self { return value }
    return nil
  }
  var bool: Bool? {
    if case .bool(let value) = self { return value }
    return nil
  }

  static func value<T: Encodable>(_ value: T) throws -> JSONValue {
    try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(value))
  }
}

private struct RPCFailure: Error {
  let code: Int64
  let message: String
}

struct RPCOperationParameters: Decodable, Sendable {
  let game: String
  let directory: String
  let sourceVersion: String?
  let cn: Bool
  let mode: String
  let predownload: Bool
  let cacheOnly: Bool
  let voicePacks: [String]
  let downloads: Int
  let writes: Int
  let checks: Int
  let postProcessors: Int
  let maxRetries: Int
  let retryInterval: Int
  let maxCachedFileHandles: Int
  let region: String?
  let files: [String]
  let categories: [String]
  let version: String?
  let bytesPerSecond: UInt64
  let installedVersion: String?
  let quickVerify: Bool
  let transfer: TransferSettings

  enum CodingKeys: String, CodingKey {
    case game, directory, sourceVersion, cn, mode, predownload, cacheOnly, voicePacks, downloads,
      writes, checks, postProcessors, maxRetries, retryInterval, maxCachedFileHandles,
      region, files, categories, version, bytesPerSecond, installedVersion, quickVerify, transfer
  }

  init(from decoder: any Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    game = try values.decode(String.self, forKey: .game)
    directory = try values.decode(String.self, forKey: .directory)
    sourceVersion = try values.decodeIfPresent(String.self, forKey: .sourceVersion)
    cn = try values.decodeIfPresent(Bool.self, forKey: .cn) ?? false
    mode = try values.decodeIfPresent(String.self, forKey: .mode) ?? "full"
    predownload = try values.decodeIfPresent(Bool.self, forKey: .predownload) ?? false
    cacheOnly = try values.decodeIfPresent(Bool.self, forKey: .cacheOnly) ?? false
    voicePacks = try values.decodeIfPresent([String].self, forKey: .voicePacks) ?? []
    downloads = try values.decodeIfPresent(Int.self, forKey: .downloads) ?? 8
    writes = try values.decodeIfPresent(Int.self, forKey: .writes) ?? 4
    checks = try values.decodeIfPresent(Int.self, forKey: .checks) ?? 8
    postProcessors = try values.decodeIfPresent(Int.self, forKey: .postProcessors) ?? 4
    maxRetries = try values.decodeIfPresent(Int.self, forKey: .maxRetries) ?? 10
    retryInterval = try values.decodeIfPresent(Int.self, forKey: .retryInterval) ?? 5
    maxCachedFileHandles =
      try values.decodeIfPresent(Int.self, forKey: .maxCachedFileHandles) ?? 512
    region = try values.decodeIfPresent(String.self, forKey: .region)
    files = try values.decodeIfPresent([String].self, forKey: .files) ?? []
    categories = try values.decodeIfPresent([String].self, forKey: .categories) ?? ["game"]
    version = try values.decodeIfPresent(String.self, forKey: .version)
    bytesPerSecond = try values.decodeIfPresent(UInt64.self, forKey: .bytesPerSecond) ?? 0
    installedVersion = try values.decodeIfPresent(String.self, forKey: .installedVersion)
    quickVerify = try values.decodeIfPresent(Bool.self, forKey: .quickVerify) ?? false
    transfer =
      try values.decodeIfPresent(TransferSettings.self, forKey: .transfer) ?? TransferSettings()
    guard ["full", "base"].contains(mode), downloads > 0, writes > 0,
      checks > 0, postProcessors > 0, maxRetries >= 0, retryInterval >= 0,
      maxCachedFileHandles >= (transfer.ioPolicy == .serialized ? 1 : writes),
      transfer.entryLimit > 0, !transfer.diskCacheEnabled || transfer.diskLimit > 0,
      !directory.isEmpty, region.map({ ["os", "cn", "bb"].contains($0) }) ?? true
    else {
      throw RPCFailure(
        code: -32602, message: "Invalid scenario, worker/cache count, or retry settings")
    }
  }
}

private struct RPCRateParameters: Decodable {
  let operationID: String?
  let bytesPerSecond: UInt64
}

private struct RPCManifestParameters: Decodable {
  let game: String
  let region: String?
  let version: String?
  let category: String?
  let path: String?
  let pattern: String?
  let recursive: Bool?
  let offset: Int?
  let limit: Int?
  let refresh: Bool?
}

private struct RPCStateParameters: Decodable {
  let directory: String
  let transfer: TransferSettings?
  let operation: String?
}

actor RPCDispatcher {
  private(set) var stopping = false
  private let settings: RPCSessionSettings
  private let notify: (@Sendable (RPCNotification) async throws -> Void)?
  private var transferControls: [String: TransferControl] = [:]
  private var operations: [String: Task<Void, Never>] = [:]
  private var status: [String: JSONValue] = [:]
  private var progressSources: [String: @Sendable () async -> JSONValue] = [:]
  private var feeds: [String: any RPCEventDelivery] = [:]
  private var terminalNotifications: [String: Task<Void, Never>] = [:]
  private var directories: [String: String] = [:]
  private var completed: [String] = []

  init(
    settings: RPCSessionSettings, notify: (@Sendable (RPCNotification) async throws -> Void)? = nil
  ) {
    self.settings = settings
    self.notify = notify
  }

  func handle(_ data: Data) async -> Data? {
    let value: JSONValue
    do { value = try JSONDecoder().decode(JSONValue.self, from: data) } catch {
      return encode(failure(id: .null, code: -32700, message: "Parse error"))
    }
    if case .array(let requests) = value {
      guard !requests.isEmpty, requests.count <= 128 else {
        return encode(
          failure(id: .null, code: -32600, message: "A batch must contain 1 to 128 requests"))
      }
      let responses = await withTaskGroup(of: JSONValue?.self) { group in
        for request in requests { group.addTask { await self.process(request) } }
        var responses: [JSONValue] = []
        for await response in group { if let response { responses.append(response) } }
        return responses
      }
      return responses.isEmpty ? nil : encode(.array(responses))
    }
    return await process(value).flatMap(encode)
  }

  private func process(_ value: JSONValue) async -> JSONValue? {
    guard let request = value.object,
      request["jsonrpc"]?.string == "2.0", let method = request["method"]?.string
    else { return failure(id: .null, code: -32600, message: "Invalid request") }
    let id = request["id"]
    if let id {
      switch id {
      case .string, .integer, .unsigned, .decimal, .null: break
      default: return failure(id: .null, code: -32600, message: "Invalid request ID")
      }
    }
    let params = request["params"] ?? .object([:])
    switch params {
    case .object, .array: break
    default: return failure(id: id ?? .null, code: -32600, message: "Parameters must be structured")
    }
    do {
      let result = try await dispatch(method, params: params)
      guard let id else { return nil }
      return .object(["jsonrpc": .string("2.0"), "id": id, "result": result])
    } catch {
      guard let id else { return nil }
      if let error = error as? RPCFailure {
        return failure(id: id, code: error.code, message: error.message)
      }
      if error is DecodingError {
        return failure(id: id, code: -32602, message: "Invalid parameters")
      }
      return failure(id: id, code: -32000, message: error.localizedDescription)
    }
  }

  private func dispatch(_ method: String, params: JSONValue) async throws -> JSONValue {
    settings.logger?.debug("RPC request", metadata: ["method": "\(method)"])
    switch method {
    case "rpc.discover":
      return .object([
        "methods": .array(
          [
            "rpc.discover", "rpc.shutdown", "api.games", "api.configs", "api.branches",
            "api.scanInfo", "api.wpfPackages",
            "api.resolveGame", "api.gameInfo", "api.lookupVersion", "api.compareBranches",
            "api.checkUpdatePath",
            "api.sophonBuild", "api.sophonPatchBuild", "update.plan", "update.start",
            "game.nextAction", "game.version", "install.start", "state.inspect", "operation.status",
            "operation.wait", "operation.cancel", "operation.pause", "operation.resume",
            "operation.limit", "repair.start", "files.list", "files.download", "game.online",
            "files.build",
          ].map(JSONValue.string))
      ])
    case "rpc.shutdown":
      await shutdown()
      return .bool(true)
    case "install.start", "update.start", "repair.start", "files.download":
      let operation = try decode(RPCOperationParameters.self, params)
      if method == "files.download",
        operation.version == nil || operation.files.isEmpty || operation.categories.isEmpty
      {
        throw RPCFailure(
          code: -32602, message: "Version, categories and explicit file paths are required")
      }
      return try start(method, params: operation)
    case "game.online", "files.list", "files.build":
      return try await manifestRPC(method, params: params)
    case "operation.pause", "operation.resume":
      let id = try operationID(params)
      guard let control = transferControls[id] else {
        throw RPCFailure(code: -32001, message: "Unknown active operation")
      }
      control.setPaused(method == "operation.pause")
      return .bool(true)
    case "operation.limit":
      let limit = try decode(RPCRateParameters.self, params)
      if let id = limit.operationID {
        transferControls[id]?.setRate(limit.bytesPerSecond)
      } else {
        for control in transferControls.values { control.setRate(limit.bytesPerSecond) }
      }
      return .bool(true)
    case "update.plan":
      let params = try decode(RPCOperationParameters.self, params)
      let client = try await client(params)
      return try .value(
        await client.planUpdate(
          sourceVersion: params.sourceVersion, mode: params.mode == "base" ? .base : .full,
          predownload: params.predownload))
    case "game.nextAction", "game.version":
      let parameters = try decode(RPCOperationParameters.self, params)
      let client = try await client(parameters)
      if method == "game.version" { return try .value(await client.detectInstalledVersion()) }
      return try .value(await client.nextAction())
    case "state.inspect":
      let params = try decode(RPCStateParameters.self, params)
      if params.operation == "install" {
        return try .value(
          await SophonClientv3.savedInstallationState(
            at: URL(fileURLWithPath: params.directory),
            settings: params.transfer ?? TransferSettings()))
      }
      guard params.operation == nil || params.operation == "update" else {
        throw RPCFailure(code: -32602, message: "operation must be update or install")
      }
      return try .value(
        await SophonClientv3.savedUpdateState(
          at: URL(fileURLWithPath: params.directory),
          settings: params.transfer ?? TransferSettings()))
    case "operation.status":
      let id = try operationID(params)
      return try await currentStatus(id)
    case "operation.wait":
      let id = try operationID(params)
      guard status[id] != nil else { throw RPCFailure(code: -32001, message: "Unknown operation") }
      if let task = operations[id] { await task.value }
      return try await currentStatus(id)
    case "operation.cancel":
      let id = try operationID(params)
      guard let task = operations[id] else {
        throw RPCFailure(code: -32001, message: "Unknown operation")
      }
      transferControls[id]?.cancel()
      task.cancel()
      return .bool(true)
    case "api.games", "api.configs", "api.branches", "api.scanInfo", "api.wpfPackages",
      "api.resolveGame", "api.gameInfo", "api.lookupVersion", "api.compareBranches",
      "api.checkUpdatePath",
      "api.sophonBuild", "api.sophonPatchBuild":
      return try await api(method, params: params)
    default: throw RPCFailure(code: -32601, message: "Method not found")
    }
  }

  private func start(_ method: String, params: RPCOperationParameters) throws -> JSONValue {
    guard !stopping else { throw RPCFailure(code: -32003, message: "RPC server is stopping") }
    let path = URL(fileURLWithPath: params.directory).standardizedFileURL.resolvingSymlinksInPath()
      .path
    guard !directories.values.contains(path) else {
      throw RPCFailure(code: -32002, message: "An operation is already using this game directory")
    }
    let id = UUID().uuidString
    directories[id] = path
    status[id] = .object(["operationID": .string(id), "status": .string("starting")])
    let control = TransferControl(bytesPerSecond: params.bytesPerSecond)
    transferControls[id] = control
    operations[id] = Task { await run(id: id, method: method, params: params, control: control) }
    return .object(["operationID": .string(id)])
  }

  private func run(
    id: String, method: String, params: RPCOperationParameters, control: TransferControl
  ) async {
    var client: SophonClientv3?
    do {
      let operationClient = try await self.client(params, control: control)
      client = operationClient
      status[id] = .object(["operationID": .string(id), "status": .string("running")])
      let mode: GameBranchCategoryScenario = params.mode == "base" ? .base : .full
      switch method {
      case "files.download":
        let reporter = operationClient.makeInstallationReporter(id: id)
        await subscribe(id, kind: "install", reporter: reporter)
        try await operationClient.downloadFiles(
          version: params.version ?? "", categories: params.categories, files: params.files,
          reporter: reporter)
      case "install.start", "repair.start":
        var expected: String?
        if method == "repair.start", let installed = params.installedVersion,
          !installed.isEmpty, installed != "0.0.0"
        {
          let online = try await operationClient.onlineBuild()
          if installed != online.version {
            guard online.updatableVersions.contains(installed) else {
              throw RPCFailure(
                code: -32000, message: "No repair manifest for installed version \(installed)")
            }
            let update = operationClient.makeUpdateReporter(id: id)
            try await operationClient.update(sourceVersion: installed, mode: mode, reporter: update)
          }
          expected = online.version
        }
        let reporter = operationClient.makeInstallationReporter(id: id)
        await subscribe(id, kind: "install", reporter: reporter)
        if method == "repair.start" {
          try await operationClient.verifyLive(
            mode: mode, installedVersion: expected, quick: params.quickVerify, reporter: reporter)
        } else {
          try await operationClient.install(
            mode: mode, additionalVoicePackMatchingFields: Set(params.voicePacks),
            predownload: params.predownload, reporter: reporter)
        }
      default:
        let reporter = operationClient.makeUpdateReporter(id: id)
        await subscribe(id, kind: "update", reporter: reporter)
        try await operationClient.update(
          sourceVersion: params.sourceVersion, mode: mode, predownload: params.predownload,
          cacheOnly: params.cacheOnly, reporter: reporter)
      }
      await finish(id, outcome: "completed")
    } catch {
      await finish(
        id, outcome: Task.isCancelled ? "cancelled" : "failed", error: error.localizedDescription)
    }
    await client?.flushLogs()
    directories.removeValue(forKey: id)
    operations.removeValue(forKey: id)
    transferControls.removeValue(forKey: id)
  }

  private func subscribe<Reporter: OperationReporting>(
    _ id: String, kind: String, reporter: Reporter
  ) async where Reporter.Event: Encodable, Reporter.Progress: Encodable {
    progressSources[id] = { .encoded(await reporter.snapshot()) }
    guard let notify else { return }
    let status: @Sendable () async -> JSONValue = { [weak self] in await self?.status[id] ?? .null }
    let onDrained: @Sendable () async -> Void = { [weak self] in await self?.deliveryFinished(id) }
    if settings.progressSnapshotsOnly {
      feeds[id] = await RPCSnapshotFeed(
        reporter: reporter, operationID: id, kind: kind, status: status, send: notify,
        onDrained: onDrained)
    } else {
      feeds[id] = await RPCProgressFeed(
        reporter: reporter, operationID: id, kind: kind, status: status, send: notify,
        onDrained: onDrained)
    }
  }

  private func currentStatus(_ id: String) async throws -> JSONValue {
    guard var value = status[id]?.object else {
      throw RPCFailure(code: -32001, message: "Unknown operation")
    }
    if let source = progressSources[id] {
      let progress = await source()
      value = status[id]?.object ?? value
      value["progress"] = progress
    }
    return .object(value)
  }

  private func finish(_ id: String, outcome: String, error: String? = nil) async {
    var value = (try? await currentStatus(id))?.object ?? [:]
    value["status"] = .string(outcome)
    if let error { value["error"] = .string(error) }
    status[id] = .object(value)
    progressSources.removeValue(forKey: id)
    completed.append(id)
    while completed.count > 128 { status.removeValue(forKey: completed.removeFirst()) }
    if let feed = feeds[id] {
      await feed.finish(.object(value))
    } else if let notify {
      let terminal = JSONValue.object(value)
      terminalNotifications[id] = Task { [weak self] in
        try? await notify(
          RPCNotification(
            .object([
              "jsonrpc": .string("2.0"), "method": .string("operation.finished"),
              "params": terminal,
            ])))
        await self?.deliveryFinished(id)
      }
    }
  }

  private func deliveryFinished(_ id: String) {
    feeds.removeValue(forKey: id)
    terminalNotifications.removeValue(forKey: id)
  }

  func drainNotifications() async {
    let deliveries = Array(feeds.values)
    let terminal = Array(terminalNotifications.values)
    for delivery in deliveries { await delivery.drain() }
    for task in terminal { await task.value }
  }

  func shutdown() async {
    stopping = true
    let tasks = Array(operations.values)
    for control in transferControls.values { control.cancel() }
    for task in tasks { task.cancel() }
    for task in tasks { await task.value }
  }

  private func client(
    _ params: RPCOperationParameters, control: TransferControl? = nil
  ) async throws -> SophonClientv3 {
    return try await makeOperationClient(
      game: params.game, directory: params.directory,
      cn: params.region.map { $0 != "os" } ?? params.cn,
      transfer: params.transfer, downloads: params.downloads, writes: params.writes,
      checks: params.checks, postProcessors: params.postProcessors,
      maxRetries: params.maxRetries, retryInterval: params.retryInterval,
      maxCachedFileHandles: params.maxCachedFileHandles,
      manifestCacheDir: settings.manifestCacheDir, logger: settings.logger, control: control,
      launcherID: params.region == "bb" ? "umfgRO5gh5" : nil)
  }

  private func manifestRPC(_ method: String, params: JSONValue) async throws -> JSONValue {
    let request = try decode(RPCManifestParameters.self, params)
    if method == "files.list",
      request.version == nil || (request.offset ?? 0) < 0
        || !(1...1000).contains(request.limit ?? 100)
    {
      throw RPCFailure(code: -32602, message: "A version and valid pagination are required")
    }
    let region = request.region ?? "os"
    guard ["os", "cn", "bb"].contains(region) else {
      throw RPCFailure(code: -32602, message: "Unsupported region")
    }
    let client = try await makeOperationClient(
      game: request.game, directory: FileManager.default.temporaryDirectory.path,
      cn: region != "os", transfer: TransferSettings(),
      maxRetries: 2, retryInterval: 1, manifestCacheDir: settings.manifestCacheDir,
      logger: settings.logger, launcherID: region == "bb" ? "umfgRO5gh5" : nil)
    switch method {
    case "game.online":
      let info = try await client.onlineBuild()
      return .object([
        "version": .string(info.version), "installSize": .integer(info.installSize),
        "updatableVersions": .array(info.updatableVersions.map(JSONValue.string)),
        "predownloadVersion": info.predownloadVersion.map(JSONValue.string) ?? .null,
      ])
    case "files.build":
      let build = try await client.versionBuild(request.version)
      return .object([
        "version": .string(build.tag),
        "categories": .array(
          build.manifests.map { info in
            .object([
              "category": .string(info.matchingField), "manifestID": .string(info.manifest.id),
              "downloadSize": .integer(info.stats.compressedSize),
              "totalSize": .integer(info.stats.uncompressedSize),
            ])
          }),
      ])
    default:
      guard let version = request.version else {
        throw RPCFailure(code: -32602, message: "version is required")
      }
      return try .value(
        await client.listFiles(
          version: version, category: request.category ?? "game", path: request.path ?? ".",
          pattern: request.pattern, recursive: request.recursive ?? false,
          offset: request.offset ?? 0, limit: request.limit ?? 100,
          refresh: request.refresh ?? false))
    }
  }

  private func api(_ method: String, params: JSONValue) async throws -> JSONValue {
    guard let values = params.object else {
      throw RPCFailure(code: -32602, message: "Expected named parameters")
    }
    let cn = values["cn"]?.bool ?? false
    let api = HYPAPIClientManager.shared.getClient(isCN: cn)
    let language = values["language"]?.string ?? (cn ? "zh-cn" : "en-us")
    switch method {
    case "api.games", "api.resolveGame":
      var identities = gameIdentities(try await api.getGames(language: language))
      if method == "api.resolveGame" {
        guard let query = values["query"]?.string ?? values["game"]?.string else {
          throw RPCFailure(code: -32602, message: "query is required")
        }
        let byID = identities.filter { $0.id == query }
        let byBiz = identities.filter { $0.biz == query }
        identities =
          !byID.isEmpty
          ? byID
          : !byBiz.isEmpty
            ? byBiz
            : identities.filter {
              $0.name.caseInsensitiveCompare(query) == .orderedSame
            }
      } else if let search = values["search"]?.string {
        identities = identities.filter {
          [$0.name, $0.biz, $0.id, $0.server ?? ""].contains {
            $0.localizedCaseInsensitiveContains(search)
          }
        }
      }
      return try .value(identities)
    case "api.configs":
      var configs = try await api.getGameConfigs()
      if let game = values["game"]?.string {
        configs.launchConfigs = [try resolveHYPGame(game, in: configs)]
      }
      return try .value(configs)
    case "api.branches":
      var branches = try await api.getGameBranches()
      if let game = values["game"]?.string {
        let config = try resolveHYPGame(game, in: await api.getGameConfigs())
        branches.gameBranches = branches.gameBranches.filter { $0.game.id == config.game.id }
      }
      return try .value(branches)
    case "api.scanInfo":
      var info = try await api.getGameScanInfo()
      if let game = values["game"]?.string {
        let config = try resolveHYPGame(game, in: await api.getGameConfigs())
        info.gameScanInfo = info.gameScanInfo.filter { $0.gameID == config.game.id }
      }
      if let version = values["version"]?.string {
        for index in info.gameScanInfo.indices {
          info.gameScanInfo[index].gameExeList = info.gameScanInfo[index].gameExeList.filter {
            $0.version == version
          }
        }
        info.gameScanInfo.removeAll { $0.gameExeList.isEmpty }
      }
      return try .value(info)
    case "api.wpfPackages":
      var packages = try await api.getWPFPackages()
      if let game = values["game"]?.string {
        let config = try resolveHYPGame(game, in: await api.getGameConfigs())
        packages.wpfPackages = packages.wpfPackages.filter { $0.game.id == config.game.id }
      }
      if let version = values["version"]?.string {
        packages.wpfPackages = packages.wpfPackages.filter { $0.wpfPackage.version == version }
      }
      if values["urlsOnly"]?.bool == true {
        return try .value(packages.wpfPackages.map { $0.wpfPackage.url.absoluteString })
      }
      return try .value(packages)
    default:
      guard let game = values["game"]?.string else {
        throw RPCFailure(code: -32602, message: "game is required")
      }
      if method == "api.gameInfo" {
        return try .value(await gameInfo(game, client: api, language: language))
      }
      if method == "api.compareBranches" {
        return try .value(await compareBranches(game, client: api))
      }
      let config = try resolveHYPGame(game, in: await api.getGameConfigs())
      if method == "api.lookupVersion" {
        guard let md5 = values["md5"]?.string, md5.utf8.count == 32,
          md5.utf8.allSatisfy({
            (48...57).contains($0) || (65...70).contains($0) || (97...102).contains($0)
          })
        else {
          throw RPCFailure(code: -32602, message: "md5 must contain 32 hexadecimal characters")
        }
        let info = try await api.getGameScanInfo()
        return try .value(
          info.gameScanInfo.filter { $0.gameID == config.game.id }
            .flatMap(\.gameExeList).filter { $0.md5.lowercased() == md5.lowercased() })
      }
      let branches = try await api.getGameBranches()
      guard
        let branch = branches.getGameSubBranch(
          id: config.game.id, predownload: values["predownload"]?.bool ?? false)
      else {
        throw RPCFailure(code: -32000, message: "Requested branch is unavailable")
      }
      if method == "api.checkUpdatePath" {
        guard let version = values["sourceVersion"]?.string, !version.isEmpty else {
          throw RPCFailure(code: -32602, message: "sourceVersion is required")
        }
        return .object([
          "id": .string(config.game.id), "biz": .string(config.game.biz),
          "fromVersion": .string(version), "targetVersion": .string(branch.tag),
          "predownload": .bool(values["predownload"]?.bool ?? false),
          "status": .string(
            version == branch.tag
              ? "already-current"
              : branch.diffTags.contains(version) ? "direct-update-advertised" : "not-advertised"),
        ])
      }
      if method == "api.sophonPatchBuild" {
        return try .value(await api.getSophonPatchBuildInfo(branch))
      }
      return try .value(await api.getSophonBuildInfo(branch))
    }
  }

  private func decode<T: Decodable>(_ type: T.Type, _ params: JSONValue) throws -> T {
    try JSONDecoder().decode(type, from: JSONEncoder().encode(params))
  }

  private func operationID(_ params: JSONValue) throws -> String {
    guard let id = params.object?["operationID"]?.string else {
      throw RPCFailure(code: -32602, message: "operationID is required")
    }
    return id
  }

  private func failure(id: JSONValue, code: Int64, message: String) -> JSONValue {
    .object([
      "jsonrpc": .string("2.0"), "id": id,
      "error": .object(["code": .integer(code), "message": .string(message)]),
    ])
  }

  private func encode(_ value: JSONValue) -> Data? { try? JSONEncoder().encode(value) }
}
