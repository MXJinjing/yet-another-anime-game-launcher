import Foundation
import HYPAPIClient
import Logging
import Puppy

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

public final class SophonClientv3: @unchecked Sendable {
  private let baseGameDir: URL
  private let gameID: String
  private let gameBiz: String
  private let logger: Logger
  private let puppy: Puppy
  private let installer: Installer
  private let updater: Updater
  private let downloadCache: DownloadCache
  private let predownloadCache: DownloadCache
  private let transferSettings: TransferSettings
  internal let manifestManager: CachedManifestManager
  private let gameLaunchConfig: GameLaunchConfig
  private let control: TransferControl?

  public convenience init(
    _ settings: SophonClientSettings,
    baseGameDir: URL, logger: Logger? = nil, control: TransferControl? = nil
  ) async throws {
    try await self.init(
      settings, baseGameDir: baseGameDir, logger: logger, control: control,
      metadataSession: .shared, payloadConfiguration: .ephemeral)
  }

  internal init(
    _ settings: SophonClientSettings, baseGameDir: URL, logger: Logger?,
    control: TransferControl?, metadataSession: URLSession,
    payloadConfiguration: URLSessionConfiguration
  )
    async throws
  {
    guard settings.maxRetries >= 0, settings.retryInterval >= 0,
      settings.maxCocurrentDownloads > 0, settings.transfer.entryLimit > 0,
      !settings.transfer.diskCacheEnabled || settings.transfer.diskLimit > 0
    else { throw SophonClientError.UnknownError("Invalid worker, retry, or cache settings") }
    self.baseGameDir = baseGameDir.standardizedFileURL.resolvingSymlinksInPath()
    self.gameID = settings.gameID
    self.control = control
    var transferSettings = settings.transfer
    if transferSettings.predownloadDirectory == nil, transferSettings.preserveState {
      transferSettings.predownloadDirectory = try await Self.savedUpdateState(
        at: self.baseGameDir, settings: transferSettings)?.predownloadDirectory
    }
    self.transferSettings = transferSettings
    var puppy = Puppy()
    if logger == nil, settings.logStdout {
      puppy.add(
        ConsoleLogger(
          "SophonClientv3.stdout",
          logFormat: SophonLogFormat(),
        ))
    }
    if logger == nil, let path = settings.logFile {
      puppy.add(
        try FileLogger(
          "SophonClientv3.file",
          logFormat: SophonLogFormat(),
          fileURL:
            URL(fileURLWithPath: path).absoluteURL, writeMode: .print),
      )
    }
    self.puppy = puppy
    self.logger =
      logger
      ?? Logger(label: "SophonClientv3") { [puppy] label in
        guard !puppy.loggers.isEmpty else {
          return SwiftLogNoOpLogHandler()
        }
        var handler = PuppyLogHandler(label: label, puppy: puppy)
        handler.logLevel = settings.logLevel
        return handler
      }
    self.manifestManager = try await CachedManifestManager(
      baseURL: settings.baseURL, sophonBaseURL: settings.sophonBaseURL,
      launcherID: settings.launcherID, gameID: settings.gameID,
      manifestCacheDir: settings.manifestCacheDir, maxRetries: settings.maxRetries,
      retryInterval: settings.retryInterval, session: metadataSession)
    self.predownloadCache = DownloadCache(
      directory: transferSettings.predownloadURL(gameDirectory: self.baseGameDir),
      diskLimit: UInt64(Int64.max), maxConcurrentDownloads: settings.maxCocurrentDownloads,
      maxRetries: settings.maxRetries, retryInterval: settings.retryInterval,
      configuration: payloadConfiguration, control: control)
    self.downloadCache = DownloadCache(
      directory: settings.transfer.cacheURL.appendingPathComponent("working")
        .appendingPathComponent(transferKey(self.baseGameDir.path))
        .appendingPathComponent("update/downloads"),
      diskLimit: settings.transfer.diskLimit,
      maxConcurrentDownloads: settings.maxCocurrentDownloads,
      maxRetries: settings.maxRetries, retryInterval: settings.retryInterval,
      cachedSource: self.predownloadCache, configuration: payloadConfiguration, control: control)
    self.installer = try Installer(
      baseGameDir: self.baseGameDir,
      maxCocurrentChecks: settings.maxCocurrentChecks,
      maxCocurrentDownloads: settings.maxCocurrentDownloads,
      maxCocurrentPostProcessors: settings.maxCocurrentPostProcessors,
      maxCocurrentWrites: settings.transfer.ioPolicy == .serialized
        ? 1 : settings.maxCocurrentWrites,
      maxRetries: settings.maxRetries,
      retryInterval: settings.retryInterval, maxCachedFileHandles: settings.maxCachedFileHandles,
      downloadCache: self.downloadCache, transferSettings: transferSettings, control: control)
    self.updater = try Updater(
      baseGameDir: self.baseGameDir, maxCocurrentDownloads: settings.maxCocurrentDownloads,
      maxCocurrentWrites: settings.maxCocurrentWrites)
    self.gameLaunchConfig = manifestManager.getGameLaunchConfig()
    self.gameBiz = gameLaunchConfig.game.biz
  }

  public func makeInstallationReporter(id: String = UUID().uuidString) -> InstallationReporter {
    var runLogger = logger
    runLogger[metadataKey: "game.id"] = "\(gameID)"
    runLogger[metadataKey: "operation.id"] = "\(id)"

    return InstallationReporter(logger: runLogger)
  }

  public func makeUpdateReporter(id: String = UUID().uuidString) -> UpdateReporter {
    var runLogger = logger
    runLogger[metadataKey: "game.id"] = "\(gameID)"
    runLogger[metadataKey: "operation.id"] = "\(id)"
    return UpdateReporter(logger: runLogger)
  }

  public func planUpdate(
    sourceVersion: String? = nil, mode: GameBranchCategoryScenario = .full,
    predownload: Bool = false, reporter: UpdateReporter? = nil
  ) async throws -> UpdatePlan {
    try await makeUpdatePlan(
      sourceVersion: sourceVersion, mode: mode, predownload: predownload,
      ignoredFiles: getIgnoredFiles(), reporter: reporter)
  }

  private func makeUpdatePlan(
    sourceVersion: String?, mode: GameBranchCategoryScenario,
    predownload: Bool, ignoredFiles: Set<String>, reporter: UpdateReporter?
  ) async throws -> UpdatePlan {
    let branch = try await selectedBranch(predownload: predownload)
    let sourceVersion = try await updateSourceVersion(sourceVersion)
    if sourceVersion == branch.tag {
      return UpdatePlan(
        sourceVersion: sourceVersion, targetVersion: branch.tag, patchBundles: [], installFiles: [],
        deleteFiles: [])
    }
    guard branch.diffTags.contains(sourceVersion) else {
      throw SophonClientError.UnsupportedManifestConfiguration(
        "No update from \(sourceVersion) to \(branch.tag) is available")
    }
    let fields = try await getRequiredMatchingFields(
      mode: mode, predownload: predownload, selectedBranch: branch)
    await reporter?.record(
      .metadataPlanned(installationManifests: fields.count, diffManifests: fields.count))
    let infos = try await manifestManager.getUpdateInfos(
      matchingFields: fields, branch: branch, reporter: reporter)
    await reporter?.record(.planningStarted)
    let plan = try updater.makePlan(
      sourceVersion: sourceVersion, targetVersion: branch.tag,
      installInfos: infos.install, updateInfos: infos.update, ignoredFiles: ignoredFiles)
    await reporter?.record(.planningCompleted)
    return plan
  }

  public func update(
    sourceVersion: String? = nil, mode: GameBranchCategoryScenario = .full,
    predownload: Bool = false, cacheOnly: Bool = false, reporter: UpdateReporter? = nil,
    expectedVersion: String? = nil
  ) async throws {
    let reporter = reporter ?? makeUpdateReporter()
    do {
      await reporter.record(.phaseChanged(.metadata))
      let branch = try await selectedBranch(predownload: predownload)
      if let expectedVersion, expectedVersion != branch.tag {
        throw SelectionError.version(expectedVersion, branch.tag)
      }
      let ignoredFiles = try getIgnoredFiles()
      let saved =
        transferSettings.preserveState
        ? try await Self.savedUpdateState(at: baseGameDir, settings: transferSettings) : nil
      let detectedSource: String?
      if let sourceVersion {
        detectedSource = sourceVersion
      } else if saved?.cacheOnly == true {
        detectedSource = try await detectInstalledVersion().version
      } else {
        detectedSource = nil
      }
      let plan: UpdatePlan
      if let saved, !saved.finished || saved.cacheOnly, saved.gameID == gameID,
        saved.mode == mode, saved.plan.targetVersion == branch.tag,
        saved.predownload == predownload || saved.cacheOnly,
        !saved.cacheOnly ? !cacheOnly : true,
        !saved.cacheOnly || detectedSource == nil || detectedSource == saved.plan.sourceVersion
      {
        guard sourceVersion == nil || sourceVersion == saved.plan.sourceVersion else {
          throw SophonClientError.UnknownError("The source version conflicts with the saved update")
        }
        plan = saved.plan
      } else {
        if let saved, !saved.finished, !saved.cacheOnly {
          throw SophonClientError.UnknownError(
            "Reconcile the unfinished update using the installation manifest")
        }
        plan = try await makeUpdatePlan(
          sourceVersion: detectedSource, mode: mode, predownload: predownload,
          ignoredFiles: ignoredFiles, reporter: reporter)
      }
      try await updater.execute(
        plan, settings: transferSettings,
        downloadCache: cacheOnly ? predownloadCache : downloadCache, installer: installer,
        reporter: reporter, cacheOnly: cacheOnly, gameID: gameID, mode: mode,
        predownload: predownload, ignoredFiles: ignoredFiles,
        finalize: { [self] in try writeGameConfig(version: plan.targetVersion) })
    } catch {
      await reporter.record(
        .finished(Task.isCancelled ? .cancelled : .failed(reason: error.localizedDescription)))
      throw error
    }
  }

  private func selectedBranch(predownload: Bool) async throws -> GameSubBranch {
    let branches = try await manifestManager.apiClient.getGameBranches()
    guard let branch = branches.getGameSubBranch(id: gameID, predownload: predownload) else {
      if predownload { throw SophonClientError.PredownloadNotAvailableError }
      throw SophonClientError.UnknownError("The live branch is unavailable")
    }
    return branch
  }

  private func updateSourceVersion(_ override: String?) async throws -> String {
    if let override, !override.isEmpty { return override }
    if let version = try await detectInstalledVersion().version { return version }
    throw SophonClientError.UnknownError(
      "Cannot determine the installed version; supply --from or verify with install")
  }

  public func detectInstalledVersion() async throws -> InstalledVersion {
    let executable = baseGameDir.appendingPathComponent(gameLaunchConfig.exeFileName)
    async let records = manifestManager.apiClient.getGameScanInfo()
    let digest = try await runTransferIO { try digestFile(executable) }
    let install = try await Self.savedInstallationState(at: baseGameDir, settings: transferSettings)
    let update = try await Self.savedUpdateState(at: baseGameDir, settings: transferSettings)
    let completedVersion =
      update.flatMap {
        $0.gameID == gameID && $0.finished && !$0.cacheOnly ? $0.plan.targetVersion : nil
      } ?? install.flatMap { $0.gameID == gameID && $0.finished ? $0.version : nil }
    let scanInfo = try await records
    let detected = resolveInstalledVersion(
      md5: digest?.md5, gameID: gameID, records: scanInfo,
      completedVersion: completedVersion)
    guard detected.candidates.isEmpty, let digest else { return detected }
    let branch = try manifestManager.getGameSubbranch()
    let (manifest, _) = try await manifestManager.getSophonManifest(matchingField: "game")
    guard
      let file = manifest.files.first(where: {
        $0.filename == gameLaunchConfig.exeFileName && $0.flags == FILE_FLAG_FILE
      })
    else { return detected }
    return resolveInstalledVersion(
      md5: digest.md5, gameID: gameID, records: scanInfo, completedVersion: completedVersion,
      manifestExecutable: (version: branch.tag, md5: file.md5))
  }

  public func nextAction(installedVersionHint: String? = nil) async throws -> GameAction {
    let branches = try await manifestManager.apiClient.getGameBranches()
    guard let live = branches.getGameSubBranch(id: gameID, predownload: false) else {
      throw SophonClientError.UnknownError("The live branch is unavailable")
    }
    let future = branches.getGameSubBranch(id: gameID, predownload: true)
    let installation = try await Self.savedInstallationState(
      at: baseGameDir, settings: transferSettings)
    let update = try await Self.savedUpdateState(at: baseGameDir, settings: transferSettings)
    let ownInstall = installation.flatMap { $0.gameID == gameID ? $0 : nil }
    let ownUpdate = update.flatMap { $0.gameID == gameID ? $0 : nil }
    // Unfinished writes are authoritative even when the executable was updated before other files.
    let pendingWrite =
      ownInstall?.finished == false
      || (ownUpdate?.finished == false && ownUpdate?.cacheOnly == false)
    let installed: InstalledVersion
    if pendingWrite {
      installed = InstalledVersion(version: nil, executableMD5: nil, candidates: [])
    } else if let hint = installedVersionHint, !hint.isEmpty, hint != "0.0.0" {
      installed = InstalledVersion(version: hint, executableMD5: nil, candidates: [])
    } else {
      installed = try await detectInstalledVersion()
    }
    let futureCached: Bool
    if let state = ownUpdate, state.cacheOnly, state.finished,
      state.plan.sourceVersion == installed.version, state.plan.targetVersion == future?.tag
    {
      futureCached = try await cachedUpdateAvailable(state)
    } else {
      futureCached = false
    }
    return decideGameAction(
      installed: installed, live: live, future: future,
      installation: ownInstall, update: ownUpdate, futureCached: futureCached,
      voicePacks: try getInstalledVoicePacks().sorted(), enableLdiff: gameLaunchConfig.enableLdiff)
  }

  private func cachedUpdateAvailable(_ state: SavedUpdateState) async throws -> Bool {
    for bundle in state.plan.patchBundles {
      if try await !downloadCache.contains(bundle.downloadRequest()) { return false }
    }
    for file in state.plan.installFiles where state.files[file.fileURL.path] == .cachedRepair {
      for chunk in file.installChunks {
        if try await !downloadCache.contains(chunk.downloadRequest()) { return false }
      }
    }
    return true
  }

  public func hasUnfinishedWrite() async throws -> Bool {
    let installation = try await Self.savedInstallationState(
      at: baseGameDir, settings: transferSettings)
    let update = try await Self.savedUpdateState(at: baseGameDir, settings: transferSettings)
    return (installation?.gameID == gameID && installation?.finished == false)
      || (update?.gameID == gameID && update?.finished == false && update?.cacheOnly == false)
  }

  public static func savedUpdateState(
    at directory: URL, settings: TransferSettings = TransferSettings()
  ) async throws -> SavedUpdateState? {
    let path = UpdateJournal.directory(
      settings: settings, gameDirectory: directory.standardizedFileURL.resolvingSymlinksInPath())
    return try await runTransferIO { try UpdateJournal.load(directory: path) }
  }

  public static func savedInstallationState(
    at directory: URL, settings: TransferSettings = TransferSettings()
  ) async throws -> SavedInstallationState? {
    let path = InstallationJournal.directory(
      settings: settings, gameDirectory: directory.standardizedFileURL.resolvingSymlinksInPath())
    return try await runTransferIO { try InstallationJournal.load(directory: path) }
  }

  public func flushLogs() async {
    for backend in puppy.loggers {
      await withCheckedContinuation { continuation in
        backend.flush { continuation.resume() }
      }
    }
  }

  private func getInstalledVoicePacks() throws -> Set<String> {
    guard !gameLaunchConfig.audioPkgScanDir.isEmpty else { return [] }
    let audioPkgFile = baseGameDir.appendingPathComponent(gameLaunchConfig.audioPkgScanDir)

    var codes: Set<String> = []
    if FileManager.default.fileExists(atPath: audioPkgFile.path) {
      let contents = try String(contentsOf: audioPkgFile, encoding: .utf8)
      for line in contents.split(whereSeparator: \.isNewline) {
        let name = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { continue }
        if let code = AUDIO_LANG_TO_CODE[name] {
          codes.insert(code)
        } else if AUDIO_LANG_TO_CODE.values.contains(name.lowercased()) {
          codes.insert(name.lowercased())
        } else {
          throw SophonClientError.UnknownError("Audio language \(name) is not supported")
        }
      }
    }
    if gameBiz.hasPrefix("hkrpg_") || gameBiz.hasPrefix("nap_") {
      for (name, code) in AUDIO_LANG_TO_CODE
      where FileManager.default.fileExists(
        atPath: baseGameDir.appendingPathComponent("Audio_\(name)_pkg_version").path)
      {
        codes.insert(code)
      }
    }
    return codes
  }

  private func writeInstalledVoicePacks(_ additional: Set<String>) throws {
    guard !additional.isEmpty, !gameLaunchConfig.audioPkgScanDir.isEmpty else { return }
    let languages = try getInstalledVoicePacks().union(additional).sorted().map { code in
      guard let name = AUDIO_LANG_TO_CODE.first(where: { $0.value == code })?.key else {
        throw SophonClientError.UnknownVoicePackError(code)
      }
      return name
    }
    let file = baseGameDir.appendingPathComponent(gameLaunchConfig.audioPkgScanDir)
    try FileManager.default.createDirectory(
      at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
    try (languages.joined(separator: "\n") + "\n").write(
      to: file, atomically: true, encoding: .utf8)
  }

  private func writeGameConfig(version: String) throws {
    let file = baseGameDir.appendingPathComponent("config.ini")
    let contents: String
    do {
      contents = try String(contentsOf: file, encoding: .utf8)
    } catch {
      if !isMissingFile(error) { throw error }
      contents = ""
    }
    let newline = contents.contains("\r\n") ? "\r\n" : "\n"
    let bom = contents.hasPrefix("\u{feff}") ? "\u{feff}" : ""
    var lines = String(contents.dropFirst(bom.count))
      .replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
    if let start = lines.firstIndex(where: {
      $0.trimmingCharacters(in: .whitespaces).lowercased().hasPrefix("[general]")
    }) {
      let end =
        lines.indices.dropFirst(start + 1).first {
          lines[$0].trimmingCharacters(in: .whitespaces).hasPrefix("[")
        } ?? lines.count
      var found = false
      for index in (start + 1)..<end {
        guard let equal = lines[index].firstIndex(of: "="),
          lines[index][..<equal].trimmingCharacters(in: .whitespaces).lowercased() == "game_version"
        else { continue }
        lines[index] = String(lines[index][...equal]) + version
        found = true
      }
      if !found { lines.insert("game_version=\(version)", at: start + 1) }
    } else {
      if lines.last == "" { lines.removeLast() }
      lines += ["[General]", "game_version=\(version)", ""]
    }
    let updated = bom + lines.joined(separator: newline)
    if updated != contents {
      try updated.write(to: file, atomically: true, encoding: .utf8)
    }
  }

  private func decodeResCategory() throws -> Set<ResCategory> {
    if gameLaunchConfig.resCategoryDir.isEmpty { return [] }
    let resCategoryDir = baseGameDir.appendingPathComponent(gameLaunchConfig.resCategoryDir)
    var isDirectory: ObjCBool = false
    guard
      FileManager.default.fileExists(atPath: resCategoryDir.path, isDirectory: &isDirectory)
        && !isDirectory.boolValue
    else {
      return []
    }

    let decoder = JSONDecoder()
    var items: Set<ResCategory> = []
    var ids: Set<String> = []

    let contents = try String(contentsOf: resCategoryDir, encoding: .utf8)
    for line in contents.split(whereSeparator: \.isNewline) {
      let trimmedLine = line.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !trimmedLine.isEmpty else { continue }

      if let data = trimmedLine.data(using: .utf8) {
        let item = try decoder.decode(ResCategory.self, from: data)
        guard ids.insert(item.category).inserted else {
          throw SophonClientError.UnknownError(
            "Duplicate resource category: \(item.category)"
          )
        }
        items.insert(item)
      }
    }
    return items
  }

  private func getIgnoredFiles() throws -> Set<String> {
    try readDownloadBlacklist(gameLaunchConfig, baseGameDir: baseGameDir)
  }

  private func getRemovedMatchingFields() async throws -> Set<String> {
    var items: Set<String> = []
    for category in try decodeResCategory() {
      if category.isDelete {
        items.insert(category.category)
      }
    }
    return items
  }

  private func getRequiredMatchingFields(
    mode: GameBranchCategoryScenario, additionalVoicePackMatchingFields: Set<String> = [],
    predownload: Bool = false, selectedBranch: GameSubBranch? = nil
  ) async throws -> Set<String> {
    let packageScenarioSupported = gameLaunchConfig.enableScenarioPkg
    if !packageScenarioSupported && mode != .full {
      throw SophonClientError.GameScenarioUnsupportedError(gameID: gameID, gameBiz: gameBiz)
    }

    let branch: GameSubBranch
    if let selectedBranch {
      branch = selectedBranch
    } else {
      branch = try manifestManager.getGameSubbranch(predownload: predownload)
    }
    let resources = branch.getGameBranchCategories(
      categoryScenario: mode,
      categoryType: .resource
    )

    // compute which resource category to install
    let deleted = try await getRemovedMatchingFields()
    var resourceMatchingFields: Set<String> = []
    for branchCategory in resources {
      if !deleted.contains(branchCategory.matchingField) {
        resourceMatchingFields.insert(branchCategory.matchingField)
      }
    }
    guard !resourceMatchingFields.isEmpty else {
      throw SophonClientError.UnknownError(
        "No resource manifests are available for the requested installation mode."
      )
    }

    // compute which voice packs to install
    let availableVoicePacks = Set(
      branch.categories
        .filter { $0.type == .audio }
        .map(\.matchingField)
    )
    let voicePackMatchingFields = try getInstalledVoicePacks().union(
      additionalVoicePackMatchingFields)
    for matchingField in voicePackMatchingFields {
      guard availableVoicePacks.contains(matchingField) else {
        throw SophonClientError.UnknownVoicePackError(matchingField)
      }
    }

    guard resourceMatchingFields.intersection(voicePackMatchingFields).isEmpty else {
      throw SophonClientError.UnknownError(
        "voice pack matching field overlaps with resource matching fields")
    }
    return resourceMatchingFields.union(voicePackMatchingFields)
  }

  public func install(
    mode: GameBranchCategoryScenario, additionalVoicePackMatchingFields: Set<String> = [],
    predownload: Bool = false,
    reporter: InstallationReporter? = nil, quickVerify: Bool = false,
    expectedVersion: String? = nil
  ) async throws {
    // if reporter is not provided, create a new InstallationReporter instance
    // logging will not work if reporter does not exist
    let reporter: InstallationReporter =
      reporter ?? makeInstallationReporter()

    do {
      try Task.checkCancellation()
      await reporter.record(.phaseChanged(.metadata))
      let operationLock = try await runTransferIO { [baseGameDir] in
        try TransferFileLock(baseGameDir.appendingPathComponent(".sophon-operation.lock"))
      }
      defer { withExtendedLifetime(operationLock) {} }
      let ignoredFiles = try getIgnoredFiles()
      let updateDirectory = UpdateJournal.directory(
        settings: transferSettings, gameDirectory: baseGameDir)
      let update = try await runTransferIO { try UpdateJournal.load(directory: updateDirectory) }
      let branch = try await selectedBranch(predownload: predownload)
      let liveTarget = branch.tag
      if let expectedVersion, expectedVersion != liveTarget {
        throw SelectionError.version(expectedVersion, liveTarget)
      }
      guard
        update?.finished != false || update?.cacheOnly == true
          || update?.plan.targetVersion != liveTarget
      else {
        throw SophonClientError.UnknownError(
          "Resume the unfinished update before starting an installation")
      }
      let directory = InstallationJournal.directory(
        settings: transferSettings, gameDirectory: baseGameDir)
      if !transferSettings.preserveState {
        try await runTransferIO { try removeOwnedFile(directory) }
      }
      let saved =
        transferSettings.preserveState
        ? try await runTransferIO { try InstallationJournal.load(directory: directory) } : nil
      let plan: InstallationPlan
      let journal: InstallationJournal?
      if let saved, !saved.finished, saved.version == liveTarget {
        let installedVoicePacks = try getInstalledVoicePacks()
        guard saved.gameID == gameID, saved.mode == mode,
          Set(saved.voicePacks).union(installedVoicePacks)
            == additionalVoicePackMatchingFields.union(installedVoicePacks)
        else {
          throw SophonClientError.UnknownError(
            "Resume the unfinished installation with the same options, or use stateless verification"
          )
        }
        plan = excludingIgnoredFiles(from: saved.remainingPlan(), ignoredFiles: ignoredFiles)
        journal = try await runTransferIO {
          try InstallationJournal(directory: directory, state: saved, resume: true)
        }
        await reporter.record(
          .planned(
            downloadBytes: plan.downloadSize, writeBytes: plan.diskWriteSize,
            totalChunk: plan.totalChunkCount, totalFile: plan.plannedFiles.count))
      } else {
        plan = try await makeInstallationPlan(
          mode: mode, voicePacks: additionalVoicePackMatchingFields, predownload: predownload,
          branch: branch, ignoredFiles: ignoredFiles, reporter: reporter, quickVerify: quickVerify)
        if transferSettings.preserveState {
          let state = SavedInstallationState(
            gameID: gameID, version: liveTarget, mode: mode,
            voicePacks: additionalVoicePackMatchingFields.sorted(),
            predownload: predownload, plan: plan, completedApplications: [], trimmedFiles: [],
            finished: false)
          journal = try await runTransferIO {
            try InstallationJournal(directory: directory, state: state)
          }
        } else {
          journal = nil
        }
      }

      // A live installation plan reconciles an obsolete partially applied update.
      if let update, !update.finished, !update.cacheOnly, update.plan.targetVersion != liveTarget {
        try await runTransferIO { try removeOwnedFile(updateDirectory) }
      }
      try Task.checkCancellation()
      try await installer.install(
        plan, reporter: reporter, journal: journal, finishReport: false)
      try writeInstalledVoicePacks(additionalVoicePackMatchingFields)
      try await runTransferIO(checkCancellation: false) { [self] in
        try writeGameConfig(version: liveTarget)
        try journal?.complete()
      }
      await reporter.record(.finished(.completed))
    } catch {
      if error is CancellationError || Task.isCancelled {
        await reporter.record(.finished(.cancelled))
      } else {
        await reporter.record(
          .finished(.failed(reason: error.localizedDescription))
        )
      }

      throw error
    }

  }

  private func makeInstallationPlan(
    mode: GameBranchCategoryScenario, voicePacks: Set<String>, predownload: Bool,
    branch: GameSubBranch, ignoredFiles: Set<String>, reporter: InstallationReporter,
    quickVerify: Bool
  ) async throws -> InstallationPlan {
    let matchingFields = try await getRequiredMatchingFields(
      mode: mode, additionalVoicePackMatchingFields: voicePacks, predownload: predownload,
      selectedBranch: branch)
    await reporter.record(.metadataPlanned(totalManifests: matchingFields.count))
    let infos = try await manifestManager.getInstallInfos(
      matchingFields: matchingFields, branch: branch, predownload: predownload, reporter: reporter)
    await reporter.record(.planningStarted)
    let plan = try await installer.scan(
      installInfos: infos, ignoredFiles: ignoredFiles, reporter: reporter, quickVerify: quickVerify)
    await reporter.record(.planningCompleted)
    return plan
  }
}

extension SophonClientv3 {
  public func onlineBuild() async throws -> (
    version: String, installSize: Int64, updatableVersions: [String], predownloadVersion: String?,
    predownloadFrom: [String]?
  ) {
    let main = try manifestManager.getGameSubbranch()
    let resources = main.getGameBranchCategories(categoryScenario: .full, categoryType: .resource)
    let build = try? await manifestManager.exactBuild(version: nil)
    let installSize = resources.reduce(Int64(0)) { total, category in
      let stats = build?.find(category.matchingField)?.stats
      let amount = max(0, stats?.uncompressedSize ?? 0, stats?.compressedSize ?? 0)
      return total.addingReportingOverflow(amount).overflow ? Int64.max : total + amount
    }
    let future = try? manifestManager.getGameSubbranch(predownload: true)
    return (
      main.tag, installSize, main.diffTags, future?.tag,
      gameLaunchConfig.enableLdiff ? future?.diffTags : nil
    )
  }

  public func usesDiffUpdate(from source: String?, predownload: Bool) async throws -> Bool {
    let branch = try await selectedBranch(predownload: predownload)
    guard gameLaunchConfig.enableLdiff else { return false }
    return try await branch.diffTags.contains(updateSourceVersion(source))
  }

  public func cacheInstallation(
    mode: GameBranchCategoryScenario, reporter: InstallationReporter, expectedVersion: String? = nil
  ) async throws {
    do {
      let branch = try await selectedBranch(predownload: true)
      if let expectedVersion, expectedVersion != branch.tag {
        throw SelectionError.version(expectedVersion, branch.tag)
      }
      let operationLock = try await runTransferIO { [baseGameDir] in
        try TransferFileLock(baseGameDir.appendingPathComponent(".sophon-operation.lock"))
      }
      defer { withExtendedLifetime(operationLock) {} }
      let plan = try await makeInstallationPlan(
        mode: mode, voicePacks: [], predownload: true, branch: branch,
        ignoredFiles: getIgnoredFiles(), reporter: reporter, quickVerify: false)
      try await installer.cacheChunks(plan, cache: predownloadCache, reporter: reporter)
      await reporter.record(.finished(.completed))
    } catch {
      await reporter.record(
        .finished(Task.isCancelled ? .cancelled : .failed(reason: error.localizedDescription)))
      throw error
    }
  }

  public func verifyLive(
    mode: GameBranchCategoryScenario, installedVersion: String?, quick: Bool,
    reporter: InstallationReporter
  ) async throws {
    try await install(
      mode: mode, reporter: reporter, quickVerify: quick,
      expectedVersion: installedVersion)
  }

  public func versionBuild(_ version: String?) async throws -> SophonBuildInfo {
    try await manifestManager.exactBuild(version: version)
  }

  public func listFiles(
    version: String, category: String = "game", path: String = ".", pattern: String? = nil,
    recursive: Bool = false, offset: Int = 0, limit: Int = 100, refresh: Bool = false
  ) async throws -> ManifestListing {
    let build = try await manifestManager.exactBuild(version: version)
    let (manifest, _) = try await manifestManager.selectedManifest(
      build, category: category, refresh: refresh)
    return try ManifestIndex(manifest).listing(
      version: build.tag, category: category, path: path, pattern: pattern,
      recursive: recursive, offset: offset, limit: limit)
  }

  public func downloadFiles(
    version: String, categories: [String], files: [String],
    reporter: InstallationReporter? = nil
  ) async throws {
    let reporter = reporter ?? makeInstallationReporter()
    do {
      let wanted = Set(try files.map(manifestPath))
      guard !wanted.isEmpty, !categories.isEmpty,
        wanted.allSatisfy({
          !($0.split(separator: "/").first ?? "").lowercased().hasPrefix(".sophon")
        }),
        baseGameDir.path != "/", baseGameDir != FileManager.default.homeDirectoryForCurrentUser
      else {
        throw SelectionError.invalid(
          "explicit files, categories and a dedicated directory are required")
      }
      let build = try await manifestManager.exactBuild(version: version)
      let fields = Set(categories)
      await reporter.record(.metadataPlanned(totalManifests: fields.count))
      var inputs: [(manifest: Manifest, chunkDownloadInfo: SophonDownloadInfo)] = []
      var chosen: [String: FileInfo] = [:]
      for field in fields.sorted() {
        let (manifest, info) = try await manifestManager.selectedManifest(build, category: field)
        var selection = Manifest()
        for file in manifest.files
        where wanted.contains(file.filename) && file.flags == FILE_FLAG_FILE {
          let key = file.filename.lowercased()
          if let previous = chosen[key] {
            guard previous.filename == file.filename, previous.md5 == file.md5,
              previous.size == file.size
            else { throw SelectionError.invalid("conflicting entries for \(file.filename)") }
            continue
          }
          _ = try selectedFileURL(root: baseGameDir, path: file.filename)
          chosen[key] = file
          selection.files.append(file)
        }
        if !selection.files.isEmpty { inputs.append((selection, info)) }
        await reporter.record(.manifestPulled(matchingField: field, predownload: false))
      }
      let missing = wanted.subtracting(chosen.values.map(\.filename))
      guard missing.isEmpty else {
        throw SelectionError.missing(missing.sorted().joined(separator: ", "))
      }
      try await control?.checkpoint()
      let root = baseGameDir
      let operationLock = try await runTransferIO {
        try TransferFileLock(root.appendingPathComponent(".sophon-operation.lock"))
      }
      defer { withExtendedLifetime(operationLock) {} }
      let stage = root.appendingPathComponent(
        ".sophon-selection-\(UUID().uuidString)", isDirectory: true)
      try FileManager.default.createDirectory(at: stage, withIntermediateDirectories: false)
      defer { try? FileManager.default.removeItem(at: stage) }
      let worker = try Installer(
        baseGameDir: stage, maxCocurrentChecks: installer.maxCocurrentChecks,
        maxCocurrentDownloads: installer.maxCocurrentDownloads,
        maxCocurrentPostProcessors: installer.maxCocurrentPostProcessors,
        maxCocurrentWrites: installer.maxCocurrentWrites,
        maxRetries: installer.downloader.maxRetries,
        retryInterval: installer.downloader.retryInterval,
        maxCachedFileHandles: installer.maxCachedFileHandles, downloadCache: downloadCache,
        transferSettings: transferSettings, control: control)
      await reporter.record(.planningStarted)
      let plan = try await worker.scan(installInfos: inputs, reporter: reporter)
      await reporter.record(.planningCompleted)
      try await worker.install(plan, reporter: reporter, finishReport: false)
      let staged = chosen.values.sorted { $0.filename < $1.filename }
      for file in staged {
        try await control?.checkpoint()
        try await runTransferIO {
          let source = stage.appendingPathComponent(file.filename)
          guard let digest = try digestFile(source),
            digest.size == UInt64(file.size), digest.md5 == file.md5.lowercased()
          else { throw SelectionError.invalid("verification failed for \(file.filename)") }
        }
      }
      try Task.checkCancellation()
      for file in staged {
        let source = stage.appendingPathComponent(file.filename)
        let target = try selectedFileURL(root: root, path: file.filename)
        try FileManager.default.createDirectory(
          at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        // Staging is on the destination volume, so rename replaces each verified file atomically.
        guard rename(source.path, target.path) == 0 else {
          throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
        }
      }
      await reporter.record(.finished(.completed))
    } catch {
      if Task.isCancelled || error is CancellationError {
        await reporter.record(.finished(.cancelled))
      } else {
        await reporter.record(.finished(.failed(reason: error.localizedDescription)))
      }
      throw error
    }
  }
}
