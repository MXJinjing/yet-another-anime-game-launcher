import Foundation

private typealias Fields = [String: Any]
private enum WishHistoryFailure: Error {
    case invalid
    case historyMismatch
}
private let poolTypes = ["301", "302", "200", "500", "100"]

private func digits(_ value: Any?) -> String? {
    let text = value as? String ?? (value as? Int).map(String.init)
    return text?.range(of: #"^[0-9]{1,19}$"#, options: .regularExpression) == nil ? nil : text
}

private struct History {
    var byUID: [String: [String: [String: String]]] = [:]

    mutating func append(_ rows: [Fields]) throws {
        var batch: [[String: String]] = []
        var batchUID: String?
        for row in rows {
            guard let role = digits(row["uid"]),
                  row["region"] == nil || row["region"] as? String == "cn_gf01",
                  let id = digits(row["id"]), let type = digits(row["gacha_type"]),
                  let time = row["time"] as? String,
                  time.range(of: #"^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$"#,
                             options: .regularExpression) != nil,
                  let rank = digits(row["rank_type"]), ["3", "4", "5"].contains(rank)
            else { throw WishHistoryFailure.invalid }
            guard batchUID == nil || role == batchUID else { throw WishHistoryFailure.historyMismatch }
            batchUID = role
            let normalized = type == "400" ? "301" : type
            guard poolTypes.contains(normalized)
            else { throw WishHistoryFailure.invalid }
            var pull = ["id": id, "gacha_type": type, "uigf_gacha_type": normalized,
                        "time": time, "rank_type": rank]
            for field in ["name", "item_type"] {
                if let text = row[field] as? String { pull[field] = String(text.prefix(100)) }
            }
            pull["item_id"] = digits(row["item_id"])
            pull["count"] = digits(row["count"])
            batch.append(pull)
        }
        if let uid = batchUID, !batch.isEmpty {
            for pull in batch {
                if let id = pull["id"], byUID[uid]?[id] == nil {
                    byUID[uid, default: [:]][id] = pull
                }
            }
        }
    }
}

private func cacheFiles(installCache: String?, userData: [String]) -> [URL] {
    let files = FileManager.default
    var roots: [(base: URL, cache: String)] = []
    if let path = installCache, path.hasPrefix("/"), path != "/" {
        let directory = URL(fileURLWithPath: path)
        let data = directory.deletingLastPathComponent()
        roots.append((data.deletingLastPathComponent(), data.lastPathComponent + "/" + directory.lastPathComponent))
    }
    for directory in userData where directory.hasPrefix("/") && directory != "/" {
        roots.append((URL(fileURLWithPath: directory), "webCaches"))
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

private func cacheHistory(_ data: Data, history: inout History) {
    // Only parse complete JSON response envelopes, never cached HTML or scripts.
    let prefix = Data(#"{"retcode":"#.utf8)
    var remaining = data.startIndex..<data.endIndex
    while let start = data.range(of: prefix, in: remaining)?.lowerBound {
        var next = start + prefix.count
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
                next = index + 1
                let slice = data[start...index]
                if let response = (try? JSONSerialization.jsonObject(with: slice)) as? Fields,
                   response["retcode"] as? Int == 0, let body = response["data"] as? Fields,
                   body["region"] == nil || body["region"] as? String == "cn_gf01",
                   let list = body["list"] as? [Fields], list.count <= 20 {
                    try? history.append(list)
                }
                break
            }
        }
        remaining = next..<data.endIndex
    }
}


private struct HistoryRequest: Decodable {
    let installCache: String?
    let directories: [String]
}

@main
private enum Main {
    static func main() throws {
        let requestData = FileHandle.standardInput.readDataToEndOfFile()
        let result: Fields
        if let request = try? JSONDecoder().decode(HistoryRequest.self, from: requestData) {
            var cache = History()
            var remaining = 64 * 1024 * 1024
            for file in cacheFiles(installCache: request.installCache, userData: request.directories) {
                guard remaining > 0 else { break }
                guard let data = try? Data(contentsOf: file), data.count <= remaining else { continue }
                remaining -= data.count
                cacheHistory(data, history: &cache)
            }
            let accounts = cache.byUID.keys.sorted().map { uid -> Fields in
                let rows = cache.byUID[uid] ?? [:]
                return ["uid": uid, "list": Array(rows.values)]
            }
            result = accounts.isEmpty ? ["state": "no-history"] : ["state": "ok", "accounts": accounts]
        } else {
            result = ["state": "invalid"]
        }
        FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: result))
    }
}
