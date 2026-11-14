import Foundation
import HYPAPIClient

final class Updater: Sendable {
  let baseGameDir: URL
  let maxCocurrentDownloads: Int
  let maxCocurrentWrites: Int

  internal init(
    baseGameDir: URL, maxCocurrentDownloads: Int, maxCocurrentWrites: Int
  ) throws {
    self.baseGameDir = baseGameDir
    self.maxCocurrentDownloads = maxCocurrentDownloads
    self.maxCocurrentWrites = maxCocurrentWrites
    guard maxCocurrentDownloads > 0 else {
      throw SophonClientError.UnknownError("MaxCocurrentDownloads should be a positive integer")
    }
    guard maxCocurrentWrites > 0 else {
      throw SophonClientError.UnknownError("MaxCocurrentWrites should be a positive integer")
    }
  }

  internal func makePlan(
    sourceVersion: String,
    targetVersion: String = "",
    installInfos: [(manifest: Manifest, chunkDownloadInfo: SophonDownloadInfo)],
    updateInfos: [(manifest: DiffManifest, diffDownloadInfo: SophonDownloadInfo)],
    ignoredFiles: Set<String> = [],
  ) throws -> UpdatePlan {
    let diffManifests = updateInfos.map(\.manifest)
    try checkManifests(installInfos.map(\.manifest))
    try checkDiffManifests(diffManifests, sourceVersion: sourceVersion)

    let installFilesByName = try makeInstallFiles(installInfos)
    // pick files that have patches for the target version
    // can be changed to install from scratch depending on validity of source file
    // or if the "patch" is not a hdiff file copy the content as a new file.
    let patchBundles = try makePatchBundles(
      sourceVersion: sourceVersion, updateInfos: updateInfos,
      installFilesByName: installFilesByName)
    let patchTargetURLs = Set(patchBundles.flatMap { $0.patches.map(\.target.fileURL) })
    // Keep full installation metadata for update targets and repair fallback.
    let installFiles = installFilesByName.values.filter { patchTargetURLs.contains($0.fileURL) }
      .sorted { $0.fileURL.path < $1.fileURL.path }
    let deleteFiles = makeDeleteFiles(
      sourceVersion: sourceVersion, manifests: diffManifests,
      retainedNames: Set(installFilesByName.keys))

    return excludingIgnoredFiles(
      from: UpdatePlan(
        sourceVersion: sourceVersion, targetVersion: targetVersion,
        patchBundles: patchBundles, installFiles: installFiles,
        deleteFiles: deleteFiles),
      ignoredFiles: ignoredFiles)
  }

  private func makeInstallFiles(
    _ installInfos: [(manifest: Manifest, chunkDownloadInfo: SophonDownloadInfo)]
  ) throws -> [String: PlannedUpdateFile] {
    var installFilesByName: [String: PlannedUpdateFile] = [:]
    for info in installInfos {
      for file in info.manifest.files where file.flags == FILE_FLAG_FILE {
        guard !file.filename.isEmpty else {
          throw SophonClientError.UnknownError("Invalid installation file: \(file.filename)")
        }
        let fileURL = baseGameDir.appendingPathComponent(file.filename)
        let installChunks = file.chunks.map { chunk in
          RequiredChunk(
            chunkID: chunk.chunkID,
            uncompressedMd5: chunk.md5,
            compressedMd5: chunk.compressedMd5,
            compressedSize: UInt64(chunk.compressedSize),
            uncompressedSize: UInt64(chunk.uncompressedSize),
            downloadInfo: info.chunkDownloadInfo,
            chunkApplicationInfos: [ChunkApplicationInfo(fileURL: fileURL, offset: chunk.offset)])
        }
        installFilesByName[file.filename.lowercased()] = PlannedUpdateFile(
          fileURL: fileURL, size: UInt64(file.size), md5: file.md5,
          installChunks: installChunks)
      }
    }
    return installFilesByName
  }

  private func makePatchBundles(
    sourceVersion: String,
    updateInfos: [(manifest: DiffManifest, diffDownloadInfo: SophonDownloadInfo)],
    installFilesByName: [String: PlannedUpdateFile]
  ) throws -> [PlannedPatchBundle] {
    var patchBundlesByID:
      [String: (
        patchSize: UInt64, patchHash: String, downloadInfo: SophonDownloadInfo,
        patches: [PlannedPatch]
      )] = [:]
    for info in updateInfos {
      for file in info.manifest.files {
        guard let patch = file.patches.first(where: { $0.key == sourceVersion }) else { continue }

        guard let target = installFilesByName[file.filename.lowercased()] else {
          throw SophonClientError.UnknownError(
            "Patch target is missing from installation manifests: \(file.filename)")
        }
        guard target.size == UInt64(file.size),
          target.md5.lowercased() == file.hash.lowercased()
        else {
          throw SophonClientError.UnknownError(
            "Conflicting target metadata for \(file.filename)")
        }
        var original: PlannedPatchSource?
        if !patch.info.originalName.isEmpty {
          original = PlannedPatchSource(
            fileURL: baseGameDir.appendingPathComponent(patch.info.originalName),
            size: UInt64(patch.info.originalSize), md5: patch.info.originalHash)
        }
        let patchID = patch.info.patchID
        let patchSize = UInt64(patch.info.patchSize)
        let patchHash = patch.info.patchName
        if let existing = patchBundlesByID[patchID] {
          guard existing.patchSize == patchSize,
            existing.patchHash.lowercased() == patchHash.lowercased(),
            existing.downloadInfo.urlPrefix == info.diffDownloadInfo.urlPrefix,
            existing.downloadInfo.urlSuffix == info.diffDownloadInfo.urlSuffix,
            existing.downloadInfo.compression == info.diffDownloadInfo.compression,
            existing.downloadInfo.encryption == info.diffDownloadInfo.encryption,
            existing.downloadInfo.password == info.diffDownloadInfo.password
          else {
            throw SophonClientError.UnknownError(
              "Conflicting metadata for patch bundle \(patchID)")
          }
        }
        let plannedPatch = PlannedPatch(
          patchOffset: UInt64(patch.info.patchOffset), patchLength: UInt64(patch.info.patchLength),
          original: original, target: target)
        patchBundlesByID[
          patchID, default: (patchSize, patchHash, info.diffDownloadInfo, [])
        ].patches.append(plannedPatch)
      }
    }

    return patchBundlesByID.map { patchID, bundle in
      PlannedPatchBundle(
        patchID: patchID, patchSize: bundle.patchSize, patchHash: bundle.patchHash,
        downloadInfo: bundle.downloadInfo,
        patches: bundle.patches.sorted { $0.patchOffset < $1.patchOffset })
    }.sorted { $0.patchID < $1.patchID }
  }

  private func makeDeleteFiles(
    sourceVersion: String, manifests: [DiffManifest], retainedNames: Set<String>
  ) -> [PlannedDeleteFile] {
    var deleteFiles: [PlannedDeleteFile] = []
    var deleteNames: Set<String> = []
    for manifest in manifests {
      for deletion in manifest.filesDelete where deletion.key == sourceVersion {
        for file in deletion.info.list {
          let name = file.filename.lowercased()
          // Never delete a file retained by the target installation.
          if retainedNames.contains(name) { continue }
          guard deleteNames.insert(name).inserted else { continue }
          deleteFiles.append(
            PlannedDeleteFile(
              fileURL: baseGameDir.appendingPathComponent(file.filename), size: UInt64(file.size)))
        }
      }
    }

    return deleteFiles
  }
}
