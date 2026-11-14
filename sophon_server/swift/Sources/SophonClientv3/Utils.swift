import Crypto
import Foundation
import HYPAPIClient
import libzstd

func md5Hex(_ data: Data) -> String {
  Insecure.MD5.hash(data: data)
    .map { String(format: "%02x", $0) }
    .joined()
}

func decompressZstd(
  _ compressed: Data,
  uncompressedSize: Int
) throws -> Data {
  var output = Data(count: uncompressedSize)

  let written = output.withUnsafeMutableBytes { dst in
    compressed.withUnsafeBytes { src in
      ZSTD_decompress(
        dst.baseAddress,
        dst.count,
        src.baseAddress,
        src.count
      )
    }
  }

  guard ZSTD_isError(written) == 0 else {
    throw SophonClientError.ZstdError(
      String(cString: ZSTD_getErrorName(written))
    )
  }

  guard written == uncompressedSize else {
    throw SophonClientError.SizeMismatch(
      expected: UInt64(uncompressedSize), actual: UInt64(written))
  }

  return output
}

func checkFileInfo(_ file: FileInfo) throws {
  if file.flags == FILE_FLAG_DIRECTORY {
    guard file.md5.isEmpty, file.size == 0, file.chunks.isEmpty else {
      throw SophonClientError.UnknownError(
        "directory has strange attributes: md5: \(file.md5), size: \(file.size), chunk count: \(file.chunks.count)"
      )
    }
    return
  }
  guard file.flags == FILE_FLAG_FILE else {
    throw SophonClientError.UnknownError(
      "Unknown file flag: \(file.flags)"
    )
  }

  guard file.size > 0,
    !file.md5.isEmpty,
    !file.chunks.isEmpty
  else {
    throw SophonClientError.UnknownError(
      """
      Invalid regular file
      size: \(file.size)
      md5: \(file.md5)
      chunk count: \(file.chunks.count)
      """
    )
  }
}

func checkManifests(_ manifests: [Manifest]) throws {
  var fileNameSet = Set<String>()
  for manifest in manifests {
    for file in manifest.files {
      try checkFileInfo(file)
      guard file.flags == FILE_FLAG_FILE else {
        continue
      }

      // windows NTFS is case insensitive
      let fileName = file.filename.lowercased()
      if !fileNameSet.insert(fileName).inserted {
        throw SophonClientError.DuplicateFileError(
          fileName
        )
      }
    }
  }
}

func checkDiffManifests(_ manifests: [DiffManifest], sourceVersion: String) throws {
  guard !sourceVersion.isEmpty else {
    throw SophonClientError.UnknownError("Source version should not be empty")
  }

  var fileNameSet = Set<String>()
  var deleteSizesByName: [String: Int64] = [:]
  for manifest in manifests {
    for file in manifest.files {
      let patches = file.patches.filter { $0.key == sourceVersion }
      guard patches.count <= 1 else {
        throw SophonClientError.UnknownError(
          "Multiple patches for \(file.filename) from version \(sourceVersion)")
      }
      guard let patch = patches.first else { continue }
      guard patch.hasInfo else {
        throw SophonClientError.UnknownError("Missing patch info for \(file.filename)")
      }
      guard !file.filename.isEmpty, file.size >= 0, !file.hash.isEmpty else {
        throw SophonClientError.UnknownError("Invalid target metadata for \(file.filename)")
      }
      guard fileNameSet.insert(file.filename.lowercased()).inserted else {
        throw SophonClientError.DuplicateFileError(file.filename)
      }

      guard !patch.info.patchID.isEmpty, patch.info.patchSize >= 0,
        patch.info.patchOffset >= 0, patch.info.patchLength >= 0,
        patch.info.patchOffset <= patch.info.patchSize,
        patch.info.patchLength <= patch.info.patchSize - patch.info.patchOffset,
        patch.info.patchLength > 0 || file.size == 0
      else {
        throw SophonClientError.UnknownError("Invalid patch metadata for \(file.filename)")
      }
      if !patch.info.originalName.isEmpty {
        guard patch.info.originalSize >= 0, !patch.info.originalHash.isEmpty else {
          throw SophonClientError.UnknownError("Invalid original metadata for \(file.filename)")
        }
      }
    }

    for deletion in manifest.filesDelete where deletion.key == sourceVersion {
      guard deletion.hasInfo else {
        throw SophonClientError.UnknownError(
          "Missing deletion info for version \(sourceVersion)")
      }
      for file in deletion.info.list {
        guard !file.filename.isEmpty, file.size >= 0 else {
          throw SophonClientError.UnknownError("Invalid deletion metadata for \(file.filename)")
        }
        let name = file.filename.lowercased()
        if let size = deleteSizesByName[name], size != file.size {
          throw SophonClientError.UnknownError(
            "Conflicting deletion sizes for \(file.filename)")
        }
        deleteSizesByName[name] = file.size
      }
    }
  }
}

// Comparison only: preserve the original case when opening or writing files.
func ignoredFileKey(_ fileURL: URL) -> String {
  let path = fileURL.path.replacingOccurrences(of: "\\", with: "/")
  return URL(fileURLWithPath: path).standardizedFileURL.path.lowercased()
}

func readDownloadBlacklist(_ config: GameLaunchConfig, baseGameDir: URL) throws -> Set<String> {
  guard config.enableResourceBlacklist == true, let path = config.blacklistDir, !path.isEmpty else {
    return []
  }
  let file = baseGameDir.appendingPathComponent(path.replacingOccurrences(of: "\\", with: "/"))
  let contents: String
  do {
    contents = try String(contentsOf: file, encoding: .utf8)
  } catch {
    if isMissingFile(error) { return [] }
    throw error
  }

  struct Entry: Decodable { let fileName: String? }
  let decoder = JSONDecoder()
  let dataDirectory =
    URL(fileURLWithPath: config.exeFileName).deletingPathExtension().lastPathComponent.lowercased()
    + "_data"
  var ignoredFiles: Set<String> = []
  for (index, line) in contents.split(
    omittingEmptySubsequences: false, whereSeparator: \.isNewline)
    .enumerated()
  {
    let line = line.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !line.isEmpty else { continue }
    let entry: Entry
    do {
      entry = try decoder.decode(Entry.self, from: Data(line.utf8))
    } catch {
      throw SophonClientError.UnknownError(
        "Invalid download blacklist at line \(index + 1): \(error)")
    }
    guard let filename = entry.fileName else { continue }
    let path = filename.replacingOccurrences(of: "\\", with: "/")
    var components = path.split(separator: "/").map(String.init)
    guard !path.isEmpty, !path.hasPrefix("/"), !components.contains(".."),
      components.first?.contains(":") != true
    else { throw SophonClientError.UnknownError("Invalid blacklist filename: \(filename)") }
    ignoredFiles.insert(ignoredFileKey(baseGameDir.appendingPathComponent(path)))
    guard components.count > 2, components[0].lowercased() == dataDirectory else { continue }
    switch components[1].lowercased() {
    case "persistent": components[1] = "StreamingAssets"
    case "streamingassets": components[1] = "Persistent"
    default: continue
    }
    ignoredFiles.insert(
      ignoredFileKey(baseGameDir.appendingPathComponent(components.joined(separator: "/"))))
  }
  return ignoredFiles
}

func excludingIgnoredFiles(
  from plan: InstallationPlan, ignoredFiles: Set<String>
) -> InstallationPlan {
  guard !ignoredFiles.isEmpty else { return plan }
  let chunks = plan.requiredChunks.compactMap { chunk -> RequiredChunk? in
    var chunk = chunk
    chunk.chunkApplicationInfos.removeAll { ignoredFiles.contains(ignoredFileKey($0.fileURL)) }
    return chunk.chunkApplicationInfos.isEmpty ? nil : chunk
  }
  return InstallationPlan(
    totalChunkCount: chunks.count,
    downloadSize: chunks.reduce(0) {
      $0 + ($1.downloadInfo.compression ? $1.compressedSize : $1.uncompressedSize)
    },
    diskWriteSize: chunks.reduce(0) {
      $0 + $1.uncompressedSize * UInt64($1.chunkApplicationInfos.count)
    },
    requiredChunks: chunks,
    plannedFiles: plan.plannedFiles.filter { !ignoredFiles.contains(ignoredFileKey($0.fileURL)) })
}

func excludingIgnoredFiles(from plan: UpdatePlan, ignoredFiles: Set<String>) -> UpdatePlan {
  guard !ignoredFiles.isEmpty else { return plan }
  let bundles = plan.patchBundles.compactMap { bundle -> PlannedPatchBundle? in
    let patches = bundle.patches.filter {
      !ignoredFiles.contains(ignoredFileKey($0.target.fileURL))
    }
    guard !patches.isEmpty else { return nil }
    return PlannedPatchBundle(
      patchID: bundle.patchID, patchSize: bundle.patchSize, patchHash: bundle.patchHash,
      downloadInfo: bundle.downloadInfo, patches: patches)
  }
  return UpdatePlan(
    sourceVersion: plan.sourceVersion, targetVersion: plan.targetVersion, patchBundles: bundles,
    installFiles: plan.installFiles.filter { !ignoredFiles.contains(ignoredFileKey($0.fileURL)) },
    deleteFiles: plan.deleteFiles.filter { !ignoredFiles.contains(ignoredFileKey($0.fileURL)) })
}
