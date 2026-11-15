import Foundation
import Testing

@testable import SophonCLI
@testable import SophonClientv3

#if os(macOS)
  @Test
  func testDownloadProxyAddress() throws {
    let proxy = try DownloadProxy("  [::1]:7890  ")
    #expect(proxy.host == "::1" && proxy.port == 7890)
    #expect(try DownloadProxy("https://proxy.example").port == 80)
    let config = proxy.configuration().connectionProxyDictionary
    #expect(config?["HTTPProxy"] as? String == "::1")
    #expect(config?["HTTPSProxy"] as? String == "::1")
    #expect(config?["HTTPPort"] as? Int == 7890)
    #expect(config?["HTTPSPort"] as? Int == 7890)

    for address in [
      "", "http://", "socks5://proxy.example", "host name", "host:0", "host:65536",
      "host:abc", "http://host/path", "http://host?query", "http://host#fragment",
    ] {
      #expect(throws: (any Error).self) { try DownloadProxy(address) }
    }
  }

#endif

@Test
func testRPCRejectsInvalidProxyBeforeMakingRequests() async throws {
  let dispatcher = RPCDispatcher(settings: try RPCSessionSettings())
  for method in ["game.online", "files.list", "api.configs", "install.start", "files.download"] {
    let request = Data(
      """
      {"jsonrpc":"2.0","id":1,"method":"\(method)",
      "params":{"game":"fixture","directory":"/tmp/fixture","version":"1.2.3",
      "files":["example"],"httpProxy":"http://user:secret@invalid/path"}}
      """.utf8)
    let response = try #require(await dispatcher.handle(request))
    let result = try #require(JSONSerialization.jsonObject(with: response) as? [String: Any])
    let error = try #require(result["error"] as? [String: Any])
    #expect(error["code"] as? Int == -32602)
    #expect(
      error["message"] as? String == "Invalid HTTP download proxy. Enter a host and optional port.")
  }
}

#if os(macOS)
  @Test(.timeLimit(.minutes(1)), arguments: [false, true])
  func testRequestsThroughHTTPDownloadProxy(authenticated: Bool) async throws {
    if authenticated {
      guard #available(macOS 14.0, *) else { return }
    }
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }

    let gameRoot = root.appendingPathComponent("game")
    let origin = "http://sophon-proxy-fixture.invalid"
    let payload = Data("downloaded through the proxy".utf8)
    var chunk = ChunkInfo()
    chunk.chunkID = "payload"
    chunk.md5 = md5Hex(payload)
    chunk.compressedMd5 = chunk.md5
    chunk.uncompressedSize = UInt32(payload.count)
    chunk.compressedSize = UInt32(payload.count)
    var file = FileInfo()
    file.filename = "example.bin"
    file.size = Int32(payload.count)
    file.md5 = chunk.md5
    file.chunks = [chunk]
    var manifest = Manifest()
    manifest.files = [file]
    let manifestBytes = try manifest.serializedData()
    let config = """
      {"launch_configs":[{"game":{"id":"fixture","biz":"fixture"},"installation_dir":"game",
      "exe_file_name":"example.bin","audio_pkg_scan_dir":"","res_category_dir":"","wpf_exe_dir":"",
      "wpf_pkg_version_dir":"","enable_ldiff":true,"enable_scenario_pkg":false,
      "enable_write_verify_result":false,"write_verify_result_path":""}]}
      """
    let branches = """
      {"game_branches":[{"game":{"id":"fixture","biz":"fixture"},"main":{
      "package_id":"1","branch":"main","password":"","tag":"1.2.3","diff_tags":["1.2.2"],
      "categories":[{"category_id":"1","matching_field":"game","type":"CATEGORY_TYPE_RESOURCE",
      "scenarios":["CATEGORY_SCENARIO_FULL"]}]},"enable_base_pkg_predownload":false}]}
      """
    let download = """
      {"encryption":false,"password":"","compression":false,"url_prefix":"\(origin)","url_suffix":""}
      """
    let stats =
      #"{"compressed_size":"28","uncompressed_size":"28","file_count":"1","chunk_count":"1"}"#
    let build = """
      {"build_id":"1","tag":"1.2.3","manifests":[{"category_id":"1","category_name":"game",
      "matching_field":"game","manifest":{"id":"manifest","checksum":"\(md5Hex(manifestBytes))",
      "compressed_size":"\(manifestBytes.count)","uncompressed_size":"\(manifestBytes.count)"},
      "chunk_download":\(download),"manifest_download":\(download),
      "stats":\(stats),"deduplicated_stats":\(stats)}]}
      """
    for (route, data) in [
      ("getGameConfigs", config), ("getGameBranches", branches), ("getBuild", build),
    ] {
      try Data("{\"retcode\":0,\"message\":\"\",\"data\":\(data)}".utf8)
        .write(to: root.appendingPathComponent(route))
    }
    try manifestBytes.write(to: root.appendingPathComponent("manifest"))
    try payload.write(to: root.appendingPathComponent("payload"))

    let server = Process()
    let output = Pipe()
    server.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
    server.arguments = ["-u", "-c", proxyFixture, root.path, authenticated ? "1" : "0"]
    server.standardOutput = output
    try server.run()
    defer {
      if server.isRunning { server.terminate() }
      server.waitUntilExit()
    }

    var port = Data()
    while let byte = try output.fileHandleForReading.read(upToCount: 1), !byte.isEmpty,
      byte.first != 10
    {
      port.append(byte)
    }
    let credentials = authenticated ? "proxy-user:proxy-password@" : ""
    let proxy = try DownloadProxy(
      "http://\(credentials)127.0.0.1:\(String(decoding: port, as: UTF8.self))")
    var transfer = TransferSettings()
    transfer.cacheDirectory = root.appendingPathComponent("cache").path
    let client = try await SophonClientv3(
      SophonClientSettings(
        baseURL: origin, sophonBaseURL: origin, maxRetries: 0, retryInterval: 0,
        launcherID: "fixture",
        gameID: "fixture", manifestCacheDir: root.appendingPathComponent("manifests").path,
        logStdout: false, transfer: transfer), baseGameDir: gameRoot, proxy: proxy)
    let online = try await client.onlineBuild()
    #expect(online.version == "1.2.3" && online.installSize == 28)
    let listing = try await client.listFiles(version: "1.2.3", path: "example.bin")
    #expect(listing.files.first?.md5 == file.md5)
    try await client.downloadFiles(version: "1.2.3", categories: ["game"], files: ["example.bin"])
    #expect(try Data(contentsOf: gameRoot.appendingPathComponent("example.bin")) == payload)
    let requests = try String(contentsOf: root.appendingPathComponent("requests"), encoding: .utf8)
    for route in ["/getGameConfigs", "/getGameBranches", "/getBuild", "/manifest", "/payload"] {
      #expect(requests.contains("http://sophon-proxy-fixture.invalid" + route))
    }
    #expect(requests.contains("Range: bytes=0-27"))
    #expect(requests.contains("CONNECT sophon-proxy-fixture.invalid:80") == authenticated)

    let httpsURL = try #require(URL(string: "https://sophon-proxy-fixture.invalid"))
    let session = proxy.makeMetadataSession()
    defer { session.invalidateAndCancel() }
    do {
      _ = try await session.data(for: URLRequest(url: httpsURL, timeoutInterval: 3))
      Issue.record("The fixture rejects HTTPS tunnels after observing CONNECT")
    } catch {
      let requests = try String(
        contentsOf: root.appendingPathComponent("requests"), encoding: .utf8)
      #expect(requests.contains("CONNECT sophon-proxy-fixture.invalid:443"))
    }
  }

  private let proxyFixture = """
    from base64 import b64encode
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    from pathlib import Path
    from urllib.parse import urlsplit
    import signal
    import sys

    root = Path(sys.argv[1])
    expected = 'Basic ' + b64encode(b'proxy-user:proxy-password').decode()
    require_auth = sys.argv[2] == '1'
    signal.alarm(50)

    class Proxy(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'
        tunneled = False

        def do_CONNECT(self):
            if require_auth and self.headers.get('Proxy-Authorization') != expected:
                self.send_response(407)
                self.send_header('Proxy-Authenticate', 'Basic realm="fixture-proxy"')
                self.send_header('Content-Length', '0')
                self.end_headers()
                return
            with (root / 'requests').open('a') as log:
                log.write('CONNECT ' + self.path + '\\n')
            if self.path != 'sophon-proxy-fixture.invalid:80':
                self.send_error(502)
                return
            self.tunneled = True
            self.send_response_only(200, 'Connection Established')
            self.end_headers()

        def do_GET(self):
            if self.tunneled:
                if self.headers.get('Proxy-Authorization'):
                    self.send_error(400)
                    return
                url = urlsplit('http://' + self.headers['Host'] + self.path)
            else:
                url = urlsplit(self.path)
            if url.hostname != 'sophon-proxy-fixture.invalid' or url.path not in {
                '/getGameConfigs', '/getGameBranches', '/getBuild', '/manifest', '/payload'
            }:
                self.send_error(404)
                return
            with (root / 'requests').open('a') as log:
                log.write(url.geturl() + ' Range: ' + self.headers.get('Range', '') + '\\n')
            content = (root / url.path[1:]).read_bytes()
            selected = self.headers.get('Range')
            if selected:
                start, end = map(int, selected.removeprefix('bytes=').split('-'))
                body = content[start:end + 1]
                self.send_response(206)
                self.send_header('Content-Range', f'bytes {start}-{end}/{len(content)}')
            else:
                body = content
                self.send_response(200)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Proxy)
    print(server.server_address[1], flush=True)
    server.serve_forever()
    """
#endif
