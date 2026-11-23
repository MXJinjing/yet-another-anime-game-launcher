import Foundation

private typealias Fields = [String: Any]

private enum Failure: String, Error {
    case invalid, unavailable, network, limited, manual
    case noHistory = "no-history"
    case historyExpired = "history-expired"
}

private let poolTypes = ["100", "200", "301", "302", "500"]
private let recordHosts = ["hk4e-api.mihoyo.com", "public-operation-hk4e.mihoyo.com"]
private let recordPaths = ["/event/gacha_info/api/getGachaLog", "/gacha_info/api/getGachaLog"]

private final class RejectRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

private func digits(_ value: Any?) -> String? {
    let text = value as? String ?? (value as? Int).map(String.init)
    return text?.range(of: #"^[0-9]{1,19}$"#, options: .regularExpression) == nil ? nil : text
}

private struct History {
    var uid: String?
    var pulls: [[String: String]] = []

    mutating func append(_ rows: [Fields], pool: String? = nil, expectedUID: String?) throws {
        var batch: [[String: String]] = []
        var batchUID = uid ?? expectedUID
        for row in rows {
            guard let role = digits(row["uid"]), role.hasPrefix("1") || role.hasPrefix("2"),
                  let id = digits(row["id"]), let type = digits(row["gacha_type"]),
                  let time = row["time"] as? String,
                  time.range(of: #"^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$"#,
                             options: .regularExpression) != nil,
                  let rank = digits(row["rank_type"]), ["3", "4", "5"].contains(rank)
            else { throw Failure.invalid }
            guard batchUID == nil || role == batchUID else { throw Failure.invalid }
            batchUID = role
            let normalized = type == "400" ? "301" : type
            guard poolTypes.contains(normalized), pool == nil || normalized == pool
            else { throw Failure.invalid }
            var pull = ["id": id, "gacha_type": type, "uigf_gacha_type": normalized,
                        "time": time, "rank_type": rank]
            for field in ["name", "item_type"] {
                if let text = row[field] as? String { pull[field] = String(text.prefix(100)) }
            }
            pull["item_id"] = digits(row["item_id"])
            pull["count"] = digits(row["count"])
            batch.append(pull)
        }
        if !batch.isEmpty {
            uid = batchUID
            pulls.append(contentsOf: batch)
        }
    }

    func result() throws -> Fields {
        guard let uid = uid, !pulls.isEmpty else { throw Failure.noHistory }
        return ["state": "ok", "history": ["uid": uid, "list": pulls]]
    }
}

private func cacheFiles(install: String, userData: String) -> [URL] {
    let files = FileManager.default
    var roots: [(base: URL, cache: String)] = []
    if install.hasPrefix("/") && install != "/" {
        roots.append((URL(fileURLWithPath: install), "YuanShen_Data/webCaches"))
    }
    if userData.hasPrefix("/") && userData != "/" {
        roots.append((URL(fileURLWithPath: userData), "webCaches"))
    }
    let keys: Set<URLResourceKey> = [.isRegularFileKey, .contentModificationDateKey, .fileSizeKey]
    var candidates: [(URL, Date)] = []
    for (base, cache) in roots {
        let parent = base.standardizedFileURL.resolvingSymlinksInPath()
        let root = parent.appendingPathComponent(cache)
        // Game data directories and cache entries must stay within the configured roots.
        let canonical = root.resolvingSymlinksInPath()
        guard canonical.path.hasPrefix(parent.path + "/") else { continue }
        let children = (try? files.contentsOfDirectory(at: canonical, includingPropertiesForKeys: nil)) ?? []
        for base in [canonical] + children.filter({
            $0.lastPathComponent.range(of: #"^[0-9]+(?:\.[0-9]+){1,4}$"#,
                                       options: .regularExpression) != nil
        }).prefix(16) {
            let data = base.appendingPathComponent("Cache/Cache_Data")
            let entries = (try? files.contentsOfDirectory(at: data, includingPropertiesForKeys: Array(keys))) ?? []
            for entry in entries where entry.lastPathComponent.range(
                of: #"^(data_[23]|f_[a-fA-F0-9]{6,8}|[a-fA-F0-9]{16}_[0-2])$"#,
                options: .regularExpression
            ) != nil {
                guard entry.resolvingSymlinksInPath().path.hasPrefix(canonical.path + "/"),
                      let info = try? entry.resourceValues(forKeys: keys),
                      info.isRegularFile == true, let size = info.fileSize, (1...16_777_216).contains(size)
                else { continue }
                candidates.append((entry, info.contentModificationDate ?? .distantPast))
            }
        }
    }
    return candidates.sorted { $0.1 > $1.1 }.prefix(64).map(\.0)
}

private func cacheHistory(_ data: Data, history: inout History, expectedUID: String?) {
    // Only parse complete JSON response envelopes, never cached HTML or scripts.
    let prefix = Data(#"{"retcode":"#.utf8)
    var remaining = data.startIndex..<data.endIndex
    while let start = data.range(of: prefix, in: remaining)?.lowerBound {
        var depth = 0
        var quoted = false
        var escaped = false
        let end = min(data.endIndex, start + 131072)
        for index in start..<end {
            let byte = data[index]
            if quoted {
                if escaped { escaped = false }
                else if byte == 92 { escaped = true }
                else if byte == 34 { quoted = false }
            } else {
                if byte == 34 { quoted = true }
                else if byte == 123 { depth += 1 }
                else if byte == 125 { depth -= 1 }
            }
            if depth == 0 {
                let slice = data[start...index]
                if let response = (try? JSONSerialization.jsonObject(with: slice)) as? Fields,
                   response["retcode"] as? Int == 0, let body = response["data"] as? Fields,
                   body["region"] == nil || body["region"] as? String == "cn_gf01",
                   let list = body["list"] as? [Fields], list.count <= 20 {
                    try? history.append(list, expectedUID: expectedUID)
                }
                break
            }
        }
        remaining = (start + prefix.count)..<data.endIndex
    }
}

private func searchRecordLink(_ data: Data) -> URLComponents? {
    let text = String(decoding: data, as: UTF8.self)
    let pattern = #"https://(?:hk4e-api|public-operation-hk4e)\.mihoyo\.com/(?:event/)?gacha_info/api/getGachaLog\?[^\s\x00-\x20"'<>]{1,8192}"#
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
    let matches = regex.matches(in: text, range: NSRange(text.startIndex..., in: text))
    for match in matches.reversed() {
        guard let range = Range(match.range, in: text),
              let url = URLComponents(string: String(text[range])),
              recordHosts.contains(url.host ?? ""), recordPaths.contains(url.path),
              url.user == nil, url.password == nil, url.port == nil,
              let query = url.queryItems,
              query.filter({ $0.name == "authkey" }).count == 1,
              let key = query.first(where: { $0.name == "authkey" })?.value, !key.isEmpty,
              !query.contains(where: {
                  ($0.name == "region" && $0.value != "cn_gf01") ||
                  ($0.name == "game_biz" && $0.value != "hk4e_cn")
              })
        else { continue }
        return url
    }
    return nil
}

private func fetchHistory(_ link: URLComponents, expectedUID: String?) async throws -> History {
    let config = URLSessionConfiguration.ephemeral
    config.httpShouldSetCookies = false
    config.timeoutIntervalForRequest = 12
    config.timeoutIntervalForResource = 15
    let session = URLSession(configuration: config, delegate: RejectRedirects(), delegateQueue: nil)
    defer { session.finishTasksAndInvalidate() }
    let fields = ["authkey", "authkey_ver", "sign_type", "auth_appid", "game_biz", "region", "init_type", "gacha_id"]
    let prefix = (link.queryItems ?? []).filter { fields.contains($0.name) }
    var history = History()
    let deadline = Date().addingTimeInterval(180)
    for pool in poolTypes {
        var cursor = "0"
        var pageNumber = 1
        while true {
            guard Date() < deadline, pageNumber <= 500 else { throw Failure.network }
            var endpoint = link
            endpoint.queryItems = prefix + [
                URLQueryItem(name: "lang", value: "zh-cn"),
                URLQueryItem(name: "gacha_type", value: pool),
                URLQueryItem(name: "page", value: String(pageNumber)),
                URLQueryItem(name: "size", value: "20"),
                URLQueryItem(name: "end_id", value: cursor),
            ]
            guard let url = endpoint.url else { throw Failure.invalid }
            let response: URLResponse
            let data: Data
            do { (data, response) = try await session.data(from: url) }
            catch { throw Failure.network }
            guard let http = response as? HTTPURLResponse else { throw Failure.network }
            if http.statusCode == 429 { throw Failure.limited }
            if http.statusCode == 401 { throw Failure.historyExpired }
            if http.statusCode == 403 || http.value(forHTTPHeaderField: "x-rpc-aigis") != nil {
                throw Failure.manual
            }
            guard http.statusCode == 200, data.count <= 131072 else { throw Failure.network }
            guard let envelope = (try? JSONSerialization.jsonObject(with: data)) as? Fields,
                  let code = envelope["retcode"] as? Int else { throw Failure.invalid }
            let body = envelope["data"] as? Fields
            if code == 1034 || code == -3503 || body?["challenge"] != nil || body?["gt"] != nil {
                throw Failure.manual
            }
            if [-100, -101, -111].contains(code) { throw Failure.historyExpired }
            if code == -110 || code == -1100 { throw Failure.limited }
            guard code == 0, let rows = body?["list"] as? [Fields], rows.count <= 20
            else { throw Failure.invalid }
            if let region = body?["region"] as? String, !region.isEmpty, region != "cn_gf01" {
                throw Failure.invalid
            }
            try history.append(rows, pool: pool, expectedUID: expectedUID)
            if rows.count < 20 { break }
            guard let next = digits(rows.last?["id"]), let current = UInt64(cursor),
                  let earlier = UInt64(next), earlier > 0, current == 0 || earlier < current
            else { throw Failure.invalid }
            cursor = next
            pageNumber += 1
            try await Task.sleep(nanoseconds: 700_000_000)
        }
        try await Task.sleep(nanoseconds: 700_000_000)
    }
    return history
}

@main
private enum Main {
    static func main() async throws {
        let args = Array(CommandLine.arguments.dropFirst())
        var reply: Fields
        do {
            guard args.count == 4, ["cached", "authorized"].contains(args[0]),
                  args[3].isEmpty || digits(args[3]) != nil else { throw Failure.invalid }
            let expectedUID = args[3].isEmpty ? nil : args[3]
            var history = History()
            var link: URLComponents?
            var remaining = 64 * 1024 * 1024
            for file in cacheFiles(install: args[1], userData: args[2]) {
                guard remaining > 0, let data = try? Data(contentsOf: file, options: .mappedIfSafe)
                else { continue }
                remaining -= data.count
                cacheHistory(data, history: &history, expectedUID: expectedUID)
                if args[0] == "authorized" && link == nil { link = searchRecordLink(data) }
            }
            if history.pulls.isEmpty, let link = link {
                history = try await fetchHistory(link, expectedUID: expectedUID)
            }
            reply = try history.result()
        } catch let failure as Failure {
            reply = ["state": failure.rawValue]
        } catch {
            reply = ["state": "unavailable"]
        }
        FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: reply))
    }
}
