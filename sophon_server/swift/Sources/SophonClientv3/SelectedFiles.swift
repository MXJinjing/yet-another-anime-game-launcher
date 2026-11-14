import Foundation
import HYPAPIClient

public struct ManifestEntry: Codable, Equatable, Sendable {
  public let filename: String
  public let name: String
  public let type: String
  public let size: Int64?
  public let md5: String?

  init(_ path: String, file: FileInfo? = nil) {
    filename = path
    name = path.split(separator: "/").last.map(String.init) ?? path
    type = file == nil ? "directory" : "file"
    size = file.map { Int64($0.size) }
    md5 = file?.md5
  }
}

public struct ManifestListing: Codable, Sendable {
  public let version: String
  public let category: String
  public let path: String
  public let total: Int
  public let offset: Int
  public let files: [ManifestEntry]
}

enum SelectionError: LocalizedError {
  case invalid(String)
  case missing(String)
  case version(String, String)

  var errorDescription: String? {
    switch self {
    case .invalid(let value): "Invalid manifest selection: \(value)"
    case .missing(let value): "Manifest entry not found: \(value)"
    case .version(let requested, let actual): "Requested \(requested), received \(actual)"
    }
  }
}

func manifestPath(_ path: String) throws -> String {
  guard !path.isEmpty, !path.contains("\\"), !path.contains(":"), !path.contains("\0"),
    path.split(separator: "/", omittingEmptySubsequences: false).allSatisfy({
      !$0.isEmpty && $0 != "." && $0 != ".."
    })
  else { throw SelectionError.invalid(path) }
  return path
}

struct ManifestIndex {
  let entries: [String: ManifestEntry]

  init(_ manifest: Manifest) throws {
    var entries: [String: ManifestEntry] = [:]
    var seen = Set<String>()
    for file in manifest.files {
      let directory = file.flags == FILE_FLAG_DIRECTORY
      guard directory || file.flags == FILE_FLAG_FILE, file.size >= 0 else {
        throw SelectionError.invalid(file.filename)
      }
      let name =
        directory && file.filename.hasSuffix("/")
        ? String(file.filename.dropLast()) : file.filename
      let path = try manifestPath(name)
      guard seen.insert(path.lowercased()).inserted,
        entries[path]?.type != "directory" || directory
      else { throw SelectionError.invalid(path) }
      entries[path] = ManifestEntry(path, file: directory ? nil : file)
      var parts = path.split(separator: "/")
      while parts.count > 1 {
        parts.removeLast()
        let parent = parts.joined(separator: "/")
        guard entries[parent]?.type != "file" else { throw SelectionError.invalid(parent) }
        entries[parent] = ManifestEntry(parent)
      }
    }
    self.entries = entries
  }

  func listing(
    version: String, category: String, path: String, pattern: String?,
    recursive: Bool, offset: Int, limit: Int
  ) throws -> ManifestListing {
    guard offset >= 0, (1...1000).contains(limit) else {
      throw SelectionError.invalid("offset or limit")
    }
    let path = path == "." || path.isEmpty ? "" : try manifestPath(path)
    if !path.isEmpty && entries[path] == nil { throw SelectionError.missing(path) }
    let matches: [ManifestEntry]
    if let file = entries[path], file.type == "file" {
      matches = [file]
    } else {
      let prefix = path.isEmpty ? "" : path + "/"
      matches = entries.values.filter { entry in
        guard entry.filename.hasPrefix(prefix), entry.filename != path else { return false }
        if recursive || pattern != nil {
          return entry.type == "file"
            && (pattern.map { glob in fnmatch(glob, entry.filename, 0) == 0 } ?? true)
        }
        return !entry.filename.dropFirst(prefix.count).contains("/")
      }.sorted {
        if !recursive && pattern == nil && $0.type != $1.type { return $0.type == "directory" }
        return $0.filename < $1.filename
      }
    }
    return ManifestListing(
      version: version, category: category, path: path.isEmpty ? "." : path,
      total: matches.count, offset: offset,
      files: Array(matches.dropFirst(offset).prefix(limit)))
  }
}

func selectedFileURL(root: URL, path: String) throws -> URL {
  var url = root
  let parts = try manifestPath(path).split(separator: "/")
  for (index, part) in parts.enumerated() {
    url.appendPathComponent(String(part))
    if (try? FileManager.default.destinationOfSymbolicLink(atPath: url.path)) != nil {
      throw SelectionError.invalid("symbolic link at \(url.path)")
    }
    var directory: ObjCBool = false
    if FileManager.default.fileExists(atPath: url.path, isDirectory: &directory),
      directory.boolValue != (index < parts.count - 1)
    {
      throw SelectionError.invalid("unexpected file type at \(url.path)")
    }
    if index == parts.count - 1,
      let values = try? url.resourceValues(forKeys: [.isRegularFileKey]),
      values.isRegularFile != true
    {
      throw SelectionError.invalid("not a regular file: \(url.path)")
    }
  }
  return url
}
