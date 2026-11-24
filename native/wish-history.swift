import Compression
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

private func cacheDirectories(installCache: String?, userData: [String]) -> [URL] {
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
    var directories: [URL] = []
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
            let data = base.appendingPathComponent("Cache/Cache_Data").resolvingSymlinksInPath()
            guard data.path.hasPrefix(canonical.path + "/"),
                  (try? data.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true
            else { continue }
            if !directories.contains(data) { directories.append(data) }
        }
    }
    return directories
}

private func cacheFiles(in directories: [URL]) -> [URL] {
    let keys: Set<URLResourceKey> = [.isRegularFileKey, .contentModificationDateKey, .fileSizeKey]
    var candidates: [(URL, Date)] = []
    for directory in directories {
        let entries = (try? FileManager.default.contentsOfDirectory(
            at: directory, includingPropertiesForKeys: Array(keys)
        )) ?? []
        for entry in entries where entry.lastPathComponent.range(
            of: #"^(data_[23]|f_[a-fA-F0-9]{6,8}|[a-fA-F0-9]{16}_[0-2])$"#,
            options: .regularExpression
        ) != nil {
            guard entry.resolvingSymlinksInPath().path.hasPrefix(directory.path + "/"),
                  let info = try? entry.resourceValues(forKeys: keys),
                  info.isRegularFile == true, let size = info.fileSize, (1...16_777_216).contains(size)
            else { continue }
            candidates.append((entry, info.contentModificationDate ?? .distantPast))
        }
    }
    return candidates.sorted { $0.1 > $1.1 }.prefix(64).map(\.0)
}

private let responseLimit = 131_072

private func appendResponse(_ data: Data, history: inout History) {
    if let response = (try? JSONSerialization.jsonObject(with: data)) as? Fields,
       response["retcode"] as? Int == 0, let body = response["data"] as? Fields,
       body["region"] == nil || body["region"] as? String == "cn_gf01",
       let list = body["list"] as? [Fields], list.count <= 20 {
        try? history.append(list)
    }
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
        let end = min(data.endIndex, start + responseLimit)
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
                appendResponse(data[start...index], history: &history)
                break
            }
        }
        remaining = next..<data.endIndex
    }
}

private extension Data {
    func cacheWord(at offset: Int) -> UInt32 {
        withUnsafeBytes { UInt32(littleEndian: $0.loadUnaligned(fromByteOffset: offset, as: UInt32.self)) }
    }
}

// Chromium blockfile cache stores entry metadata, response headers and bodies
// separately. Match only the history endpoint, then read its two response streams.
private struct BlockCache {
    let directory: URL
    private static let headerSize = 8192
    private static let blockMagic: UInt32 = 0xC104CAC3
    private static let entrySize = 256
    private static let allocationOffset = 80
    private static let maxEntryFileSize = headerSize + (headerSize - allocationOffset) * 8 * entrySize
    private static let historyEndpoint = Data("/getGachaLog?".utf8)

    private func file(_ name: String) -> (url: URL, size: Int)? {
        let url = directory.appendingPathComponent(name).resolvingSymlinksInPath()
        guard url.path.hasPrefix(directory.path + "/"),
              let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey]),
              values.isRegularFile == true, let size = values.fileSize
        else { return nil }
        return (url, size)
    }

    private func stream(at address: UInt32, count: Int) -> Data? {
        guard address & 0x80000000 != 0, (1...responseLimit).contains(count) else { return nil }
        let type = Int((address >> 28) & 7)
        let name: String
        let offset: Int
        let sizes = [2: 256, 3: 1024, 4: 4096]
        if type == 0 {
            name = String(format: "f_%06x", address & 0x0fffffff)
            offset = 0
        } else if let blockSize = sizes[type] {
            let blocks = Int((address >> 24) & 3) + 1
            guard count <= blocks * blockSize else { return nil }
            name = "data_\((address >> 16) & 255)"
            offset = Self.headerSize + Int(address & 65535) * blockSize
        } else {
            return nil
        }
        guard let entry = file(name), offset + count <= entry.size,
              let handle = try? FileHandle(forReadingFrom: entry.url)
        else { return nil }
        defer { try? handle.close() }
        do {
            if let blockSize = sizes[type] {
                guard let header = try handle.read(upToCount: 16), header.count == 16,
                      header.cacheWord(at: 0) == Self.blockMagic,
                      header.cacheWord(at: 12) == blockSize
                else { return nil }
            }
            try handle.seek(toOffset: UInt64(offset))
            guard let data = try handle.read(upToCount: count), data.count == count else { return nil }
            return data
        } catch {
            return nil
        }
    }

    func readHistory(history: inout History, budget: inout Int) {
        guard #available(macOS 12, *),
              let file = file("data_1"), file.size >= Self.headerSize,
              file.size <= min(budget, Self.maxEntryFileSize),
              let data = try? Data(contentsOf: file.url), data.count == file.size,
              data.cacheWord(at: 0) == Self.blockMagic, data.cacheWord(at: 12) == Self.entrySize
        else { return }
        budget -= data.count
        for offset in stride(from: Self.headerSize, through: data.count - Self.entrySize, by: Self.entrySize) {
            let block = (offset - Self.headerSize) / Self.entrySize
            guard data[Self.allocationOffset + block / 8] & (1 << (block % 8)) != 0,
                  data.cacheWord(at: offset + 20) == 0
            else { continue }
            let keyLength = Int(data.cacheWord(at: offset + 32))
            let keyAddress = data.cacheWord(at: offset + 36)
            let keyStart = offset + 96
            let key: Data?
            if keyAddress != 0 {
                key = stream(at: keyAddress, count: keyLength)
            } else if (1...927).contains(keyLength), keyStart + keyLength <= data.count {
                key = data[keyStart..<(keyStart + keyLength)]
            } else {
                key = nil
            }
            guard key?.range(of: Self.historyEndpoint) != nil,
                  let headers = stream(at: data.cacheWord(at: offset + 56),
                                       count: Int(data.cacheWord(at: offset + 40))),
                  String(decoding: headers, as: UTF8.self).split(separator: "\0").contains(where: {
                      $0.lowercased().replacingOccurrences(of: " ", with: "") == "content-encoding:br"
                  }),
                  let body = stream(at: data.cacheWord(at: offset + 60),
                                    count: Int(data.cacheWord(at: offset + 44))),
                  let decoded = decodeBrotli(body)
            else { continue }
            appendResponse(decoded, history: &history)
        }
    }
}

@available(macOS 12, *)
private func decodeBrotli(_ data: Data) -> Data? {
    var output = [UInt8](repeating: 0, count: responseLimit)
    let size = data.withUnsafeBytes { raw -> Int in
        guard let source = raw.bindMemory(to: UInt8.self).baseAddress else { return 0 }
        return compression_decode_buffer(&output, output.count, source, data.count, nil, COMPRESSION_BROTLI)
    }
    guard size > 0, size < responseLimit else { return nil }
    return Data(output.prefix(size))
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
            let directories = cacheDirectories(installCache: request.installCache, userData: request.directories)
            for directory in directories {
                BlockCache(directory: directory).readHistory(history: &cache, budget: &remaining)
            }
            for file in cacheFiles(in: directories) {
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
