import Foundation

enum WishSyncStatus: String, Error {
    case complete
    case noLink = "no-link"
    case expired
    case rateLimited = "rate-limited"
    case needsAttention = "needs-attention"
    case unavailable
    case incomplete
}

struct WishSyncResult {
    let status: WishSyncStatus
    let history: History
}

typealias WishPageProgress = (_ pool: String, _ pages: Int, _ records: Int) -> Void

private let pageSize = 20
private let maxPagesPerPool = 500
private let logReadLimit = 4 * 1024 * 1024
private let historyPagePath = #"^/hk4e/event/e[0-9]+gacha[-a-z0-9]*/index\.html$"#
private let forwardedParameters: Set<String> = [
    "auth_appid", "authkey", "authkey_ver", "device_type", "gacha_id",
    "game_biz", "game_version", "init_type", "lang", "no_joypad_close",
    "region", "sign_type", "timestamp", "win_mode",
]

func wishHistoryQuery(from text: String, host: String) -> [URLQueryItem]? {
    let pattern = #"https://[^\s<>"\x00]+"#
    let expression = try! NSRegularExpression(pattern: pattern)
    let matches = expression.matches(in: text, range: NSRange(text.startIndex..., in: text))
    for match in matches.reversed() {
        guard let range = Range(match.range, in: text), range.upperBound != range.lowerBound,
              text[range].utf8.count <= 12_288,
              let url = URLComponents(string: text[range].replacingOccurrences(of: "&amp;", with: "&")),
              url.scheme == "https", url.host == host,
              url.user == nil, url.password == nil, url.port == nil,
              url.path.range(of: historyPagePath, options: .regularExpression) != nil,
              let items = url.queryItems
        else { continue }
        let query = items.filter { forwardedParameters.contains($0.name) && $0.value?.isEmpty == false }
        guard Set(query.map(\.name)).count == query.count,
              query.contains(URLQueryItem(name: "game_biz", value: "hk4e_cn")),
              query.contains(URLQueryItem(name: "auth_appid", value: "webview_gacha")),
              query.first(where: { $0.name == "region" }).map({ $0.value == "cn_gf01" }) ?? true,
              let authKey = query.first(where: { $0.name == "authkey" })?.value,
              (1...8192).contains(authKey.utf8.count)
        else { continue }
        return query.filter { $0.name != "lang" } + [URLQueryItem(name: "lang", value: "zh-cn")]
    }
    return nil
}

private func recentLogTail(_ url: URL) -> String? {
    guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
    defer { try? handle.close() }
    do {
        let size = try handle.seekToEnd()
        try handle.seek(toOffset: size - min(size, UInt64(logReadLimit)))
        guard let data = try handle.read(upToCount: logReadLimit) else { return nil }
        return String(decoding: data, as: UTF8.self)
    } catch {
        return nil
    }
}

private func recentWishQuery(in directories: [String]) -> [URLQueryItem]? {
    let files = directories.prefix(32).compactMap { path -> (URL, Date)? in
        guard path.hasPrefix("/"), path != "/" else { return nil }
        let directory = URL(fileURLWithPath: path).resolvingSymlinksInPath()
        let file = directory.appendingPathComponent("output_log.txt")
        guard file.resolvingSymlinksInPath().path == file.path,
              let props = try? file.resourceValues(forKeys: [.isRegularFileKey, .contentModificationDateKey]),
              props.isRegularFile == true
        else { return nil }
        return (file, props.contentModificationDate ?? .distantPast)
    }
    for (file, _) in files.sorted(by: { $0.1 > $1.1 }) {
        if let text = recentLogTail(file), let query = wishHistoryQuery(from: text, host: wishHistoryPageHost) {
            return query
        }
    }
    return nil
}

func paginateWishHistory(
    request: (_ pool: String, _ page: Int, _ cursor: String) async throws -> [Fields],
    wait: () async throws -> Void,
    onProgress: WishPageProgress = { _, _, _ in }
) async -> WishSyncResult {
    var history = History()
    var account: String?
    var records = 0
    var firstRequest = true
    do {
        for pool in poolTypes {
            var cursor: UInt64 = 0
            onProgress(pool, 0, records)
            for page in 1...maxPagesPerPool {
                if !firstRequest { try await wait() }
                firstRequest = false
                let rows = try await request(pool, page, String(cursor))
                guard rows.count <= pageSize else { throw WishSyncStatus.incomplete }
                if rows.isEmpty { break }
                var previous = cursor == 0 ? UInt64.max : cursor
                for row in rows {
                    guard let uid = digits(row["uid"]), account == nil || uid == account,
                          let type = digits(row["gacha_type"]), (type == "400" ? "301" : type) == pool,
                          let id = digits(row["id"]).flatMap(UInt64.init),
                          id > 0, id < previous
                    else { throw WishSyncStatus.incomplete }
                    account = uid
                    previous = id
                }
                try history.append(rows)
                records = account.flatMap { history.byUID[$0]?.count } ?? 0
                onProgress(pool, page, records)
                cursor = previous
                if rows.count < pageSize { break }
                if page == maxPagesPerPool { throw WishSyncStatus.incomplete }
            }
        }
        return WishSyncResult(status: .complete, history: history)
    } catch let status as WishSyncStatus {
        return WishSyncResult(status: status, history: history)
    } catch {
        return WishSyncResult(status: .incomplete, history: history)
    }
}

private final class NoWishHistoryRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

@available(macOS 12, *)
private func wishHistoryPage(
    session: URLSession, endpoint: URLComponents, query: [URLQueryItem],
    pool: String, page: Int, cursor: String
) async throws -> [Fields] {
    var url = endpoint
    url.queryItems = query + [
        URLQueryItem(name: "gacha_type", value: pool),
        URLQueryItem(name: "page", value: String(page)),
        URLQueryItem(name: "size", value: String(pageSize)),
        URLQueryItem(name: "end_id", value: cursor),
    ]
    // Encode literal plus signs because the service interprets query values as form data.
    url.percentEncodedQuery = url.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
    guard let address = url.url else { throw WishSyncStatus.unavailable }
    var request = URLRequest(url: address)
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    let data: Data
    let response: URLResponse
    do {
        (data, response) = try await session.data(for: request)
    } catch {
        throw WishSyncStatus.unavailable
    }
    switch (response as? HTTPURLResponse)?.statusCode {
    case 200: break
    case 401: throw WishSyncStatus.expired
    case 403: throw WishSyncStatus.needsAttention
    case 429: throw WishSyncStatus.rateLimited
    default: throw WishSyncStatus.unavailable
    }
    guard data.count <= 131_072,
          let response = (try? JSONSerialization.jsonObject(with: data)) as? Fields,
          let code = response["retcode"] as? Int
    else { throw WishSyncStatus.unavailable }
    switch code {
    case 0: break
    case -100: throw WishSyncStatus.expired
    case -110: throw WishSyncStatus.rateLimited
    case 1034: throw WishSyncStatus.needsAttention
    default: throw WishSyncStatus.unavailable
    }
    guard let page = response["data"] as? Fields,
          page["region"] == nil || page["region"] as? String == "cn_gf01",
          let list = page["list"] as? [Fields]
    else { throw WishSyncStatus.incomplete }
    return list
}

@available(macOS 12, *)
func syncWishHistory(in directories: [String], onProgress: WishPageProgress) async -> WishSyncResult {
    guard let query = recentWishQuery(in: directories) else {
        return WishSyncResult(status: .noLink, history: History())
    }
    guard let endpoint = URLComponents(string: wishHistoryAPI), endpoint.scheme == "https" else {
        return WishSyncResult(status: .unavailable, history: History())
    }
    let configuration = URLSessionConfiguration.ephemeral
    configuration.httpCookieStorage = nil
    configuration.urlCache = nil
    configuration.urlCredentialStorage = nil
    configuration.timeoutIntervalForRequest = 12
    configuration.timeoutIntervalForResource = 20
    let session = URLSession(configuration: configuration, delegate: NoWishHistoryRedirects(), delegateQueue: nil)
    defer { session.invalidateAndCancel() }
    return await paginateWishHistory(
        request: { pool, page, cursor in
            try await wishHistoryPage(session: session, endpoint: endpoint, query: query,
                                      pool: pool, page: page, cursor: cursor)
        },
        wait: { try await Task.sleep(nanoseconds: 1_000_000_000) },
        onProgress: onProgress
    )
}
