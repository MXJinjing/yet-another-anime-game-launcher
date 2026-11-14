import Foundation
import Testing

@testable import SophonCLI
@testable import SophonClientv3

@Test
func testManifestDirectoryListingAndPagination() throws {
  var manifest = Manifest()
  manifest.files = [
    manifestFile("Root.bin"), manifestFile("Data/Store/a.pck"),
    manifestFile("Data/b.pck"), manifestFile("Data/empty/", directory: true),
  ]
  let index = try ManifestIndex(manifest)
  func listing(
    _ path: String, pattern: String? = nil, recursive: Bool = false,
    offset: Int = 0, limit: Int = 100
  ) throws -> ManifestListing {
    try index.listing(
      version: "1.2.3", category: "game", path: path, pattern: pattern,
      recursive: recursive, offset: offset, limit: limit)
  }
  #expect(try listing(".").files.map(\.filename) == ["Data", "Root.bin"])
  #expect(try listing("Data").files.map(\.name) == ["Store", "empty", "b.pck"])
  #expect(try listing("Data/empty").total == 0)
  #expect(try listing("Data/Store/a.pck").files.first?.size == 1)
  #expect(try listing(".", pattern: "Data/*.pck").total == 2)
  let page = try listing("Data", recursive: true, offset: 1, limit: 1)
  #expect(page.version == "1.2.3" && page.category == "game" && page.path == "Data")
  #expect(page.total == 2 && page.offset == 1 && page.files.first?.filename == "Data/b.pck")
  #expect(try listing("Data", offset: Int.max).files.isEmpty)
  #expect(throws: SelectionError.self) { try listing("missing") }
  #expect(throws: SelectionError.self) { try listing("..") }
  #expect(throws: SelectionError.self) { try listing(".", limit: 1001) }
  #expect(throws: SelectionError.self) { try listing(".", offset: -1) }
}

@Test(arguments: ["", "/a", "../a", "a/../b", "a\\b", "C:a", "a//b", "./a", "a/"])
func testManifestRejectsUnsafeFilePaths(path: String) {
  #expect(throws: SelectionError.self) { try manifestPath(path) }
}

@Test
func testManifestRejectsDuplicateAndConflictingEntries() {
  for names in [["A", "a"], ["a", "a/b"], ["a/b", "a"]] {
    var manifest = Manifest()
    manifest.files = names.map { manifestFile($0) }
    #expect(throws: SelectionError.self) { try ManifestIndex(manifest) }
  }
}

@Test
func testSelectedFileDestinationRejectsLinksAndDirectories() throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: root) }
  try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
  try FileManager.default.createDirectory(
    at: root.appendingPathComponent("Directory"), withIntermediateDirectories: true)
  try FileManager.default.createSymbolicLink(
    at: root.appendingPathComponent("Link"),
    withDestinationURL: root.appendingPathComponent("Missing"))
  #expect(try selectedFileURL(root: root, path: "Directory/file").path.hasSuffix("/Directory/file"))
  #expect(throws: SelectionError.self) { try selectedFileURL(root: root, path: "Directory") }
  #expect(throws: SelectionError.self) { try selectedFileURL(root: root, path: "Link") }
  #expect(throws: SelectionError.self) { try selectedFileURL(root: root, path: "Link/file") }
}

@Test
func testTransferControlChangesRateAndWakesCancelledWork() async throws {
  let control = TransferControl(bytesPerSecond: 1)
  let limited = Task.detached { control.admit(1024) }
  control.setRate(0)
  #expect(await limited.value)
  control.setPaused(true)
  let paused = Task.detached { control.admit(1) }
  let checkpoint = Task { try await control.checkpoint() }
  control.cancel()
  #expect(!(await paused.value))
  await #expect(throws: CancellationError.self) { try await checkpoint.value }
  #expect(!control.admit(1))
}

@Test
func testSelectedFileRPCRejectsIncompleteRequests() async throws {
  let dispatcher = RPCDispatcher(settings: try RPCSessionSettings())
  for params in [
    #"{"game":"fixture","directory":"/tmp/test","version":"1.2.3"}"#,
    #"{"game":"fixture","directory":"/tmp/test","files":["a"]}"#,
    #"{"game":"fixture","directory":"/tmp/test","version":"1.2.3","files":["a"],"categories":[]}"#,
  ] {
    let request = Data(
      """
      {"jsonrpc":"2.0","id":1,"method":"files.download","params":\(params)}
      """.utf8)
    let response = try #require(await dispatcher.handle(request))
    let json = try JSONDecoder().decode(JSONValue.self, from: response)
    #expect(
      json.object?["error"]?.object?["message"]?.string?.contains("explicit file paths") == true)
  }
}

private func manifestFile(_ name: String, directory: Bool = false) -> FileInfo {
  var file = FileInfo()
  file.filename = name
  file.flags = directory ? 64 : 0
  file.size = directory ? 0 : 1
  file.md5 = directory ? "" : "hash"
  return file
}
