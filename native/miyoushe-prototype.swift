import CoreImage
import CryptoKit
import Foundation
import Security

// Development-only bridge. Login cookies and pending tickets stay in Keychain.
// Compile with swiftc -parse-as-library and stage as sidecar/miyoushe-prototype
// under the channel's dev directory before running with YAAGL_MIYOUSHE_PROTOTYPE=1.
// Protocol references: MightyOwls/MYS-Daily and XYRQ-Dev/miyoushe-tool.
private enum Failure: String, Error {
    case unavailable, invalid, network, limited, manual, unbound, expired
}

private typealias Fields = [String: Any]

private func isGameUID(_ value: String) -> Bool {
    value.range(of: #"^[0-9]{1,19}$"#, options: .regularExpression) != nil
}

private struct Pending: Codable {
    let ticket: String
    let device: String
    let expires: Date
    var cookie: String?
}

private struct Keychain {
    let installation: String

    private func query(_ item: String) -> Fields {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "io.yaaglm.miyoushe.prototype",
            kSecAttrAccount as String: "\(installation):\(item)",
        ]
    }

    func read(_ item: String) throws -> Data? {
        var attributes = query(item)
        attributes[kSecReturnData as String] = true
        attributes[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(attributes as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw Failure.unavailable
        }
        return data
    }

    func write(_ data: Data, to item: String) throws {
        var attributes = query(item)
        let value = [kSecValueData as String: data]
        let status = SecItemUpdate(attributes as CFDictionary, value as CFDictionary)
        if status == errSecSuccess { return }
        guard status == errSecItemNotFound else { throw Failure.unavailable }
        attributes[kSecValueData as String] = data
        guard SecItemAdd(attributes as CFDictionary, nil) == errSecSuccess else {
            throw Failure.unavailable
        }
    }

    func delete(_ item: String) throws {
        let status = SecItemDelete(query(item) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw Failure.unavailable
        }
    }
}

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

private enum Game: String {
    case hk4e, hkrpg, nap

    var activity: String {
        switch self {
        case .hk4e: return "e202311201442471"
        case .hkrpg: return "e202304121516551"
        case .nap: return "e202406242138391"
        }
    }

    var eventBase: String {
        self == .nap
            ? "https://act-nap-api.mihoyo.com/event/luna/zzz/"
            : "https://api-takumi.mihoyo.com/event/luna/"
    }

    func isOfficialRegion(_ region: String) -> Bool {
        self == .hk4e ? region == "cn_gf01" : region == "prod_gf_cn"
    }
}

private struct Bridge {
    private let passport = "https://passport-api.miyoushe.com/account/ma-cn-passport/web/"
    private let vault: Keychain
    private let session: URLSession

    init(path: String) {
        let installation = URL(fileURLWithPath: path).standardizedFileURL.path
        let digest = SHA256.hash(data: Data(installation.utf8))
        vault = Keychain(installation: digest.map { String(format: "%02x", $0) }.joined())
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.timeoutIntervalForRequest = 12
        config.timeoutIntervalForResource = 15
        session = URLSession(configuration: config, delegate: RejectRedirects(), delegateQueue: nil)
    }

    private func request(
        _ endpoint: String,
        query: [String: String] = [:],
        body: [String: String]? = nil,
        headers: [String: String]
    ) async throws -> (code: Int, data: Fields, cookies: [HTTPCookie]) {
        guard var components = URLComponents(string: endpoint) else { throw Failure.invalid }
        if !query.isEmpty {
            components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        guard let url = components.url else { throw Failure.invalid }
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        for (field, value) in headers { request.setValue(value, forHTTPHeaderField: field) }
        if let body = body {
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let responseData: Data
        let response: URLResponse
        do {
            (responseData, response) = try await session.data(for: request)
        } catch {
            throw Failure.network
        }
        guard let http = response as? HTTPURLResponse else { throw Failure.network }
        if http.statusCode == 429 { throw Failure.limited }
        if http.statusCode == 403 || http.value(forHTTPHeaderField: "x-rpc-aigis") != nil {
            throw Failure.manual
        }
        if http.statusCode == 401 { throw Failure.unbound }
        guard (200..<300).contains(http.statusCode) else { throw Failure.network }
        guard
            let envelope = (try? JSONSerialization.jsonObject(with: responseData)) as? Fields,
            let code = envelope["retcode"] as? Int
        else { throw Failure.invalid }
        let data = envelope["data"] as? Fields ?? [:]
        if code == 1034 || code == -3503 || data["gt"] != nil || data["challenge"] != nil {
            throw Failure.manual
        }
        if code == -100 || code == -101 { throw Failure.unbound }
        let cookies = HTTPCookie.cookies(
            withResponseHeaderFields: http.allHeaderFields as? [String: String] ?? [:],
            for: url
        )
        return (code, data, cookies)
    }

    private func qrHeaders(device: String) -> [String: String] {
        [
            "x-rpc-app_id": "bll8iq97cem8",
            "x-rpc-game_biz": "bbs_cn",
            "x-rpc-client_type": "4",
            "x-rpc-device_id": device,
        ]
    }

    private func gameHeaders(_ game: Game) throws -> [String: String] {
        guard
            let credential = try vault.read("account"),
            let cookie = String(data: credential, encoding: .utf8)
        else { throw Failure.unbound }
        let time = Int(Date().timeIntervalSince1970)
        let nonce = UUID().uuidString.lowercased().prefix(6)
        let input = "salt=d9200c846b10886e8c874fc33c8f308b&t=\(time)&r=\(nonce)"
        let signature = Insecure.MD5.hash(data: Data(input.utf8))
            .map { String(format: "%02x", $0) }.joined()
        var headers = [
            "Cookie": cookie,
            "DS": "\(time),\(nonce),\(signature)",
            "Origin": "https://act.mihoyo.com",
            "Referer": "https://act.mihoyo.com/",
            "x-rpc-client_type": "5",
        ]
        if game == .hk4e { headers["x-rpc-signgame"] = "hk4e" }
        if game == .nap { headers["x-rpc-signgame"] = "zzz" }
        return headers
    }

    private func start() async throws -> Fields {
        try vault.delete("pending")
        let device = UUID().uuidString.lowercased()
        let result = try await request(passport + "createQRLogin", body: [:], headers: qrHeaders(device: device))
        guard
            result.code == 0,
            let ticket = result.data["ticket"] as? String,
            !ticket.isEmpty,
            let url = result.data["url"] as? String,
            let filter = CIFilter(name: "CIQRCodeGenerator")
        else { throw Failure.invalid }
        filter.setValue(Data(url.utf8), forKey: "inputMessage")
        guard let qr = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 5, y: 5)),
              let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
              let png = CIContext().pngRepresentation(of: qr, format: .RGBA8, colorSpace: colorSpace)
        else { throw Failure.unavailable }
        try vault.write(JSONEncoder().encode(Pending(
            ticket: ticket, device: device, expires: Date().addingTimeInterval(120)
        )), to: "pending")
        return ["state": "ok", "qr": png.base64EncodedString()]
    }

    private func pending() throws -> Pending {
        guard let data = try vault.read("pending"),
              let pending = try? JSONDecoder().decode(Pending.self, from: data),
              pending.expires > Date()
        else { throw Failure.expired }
        return pending
    }

    private func poll() async throws -> String {
        var pending = try pending()
        let result = try await request(
            passport + "queryQRLoginStatus",
            body: ["ticket": pending.ticket],
            headers: qrHeaders(device: pending.device)
        )
        if [-106, -3501].contains(result.code) { throw Failure.expired }
        guard result.code == 0 else { throw Failure.invalid }
        switch result.data["status"] as? String {
        case "Created", "Init": return "waiting"
        case "Scanned": return "scanned"
        case "Expired", "Timeout": return "expired"
        case "Confirmed":
            let names = ["cookie_token_v2", "account_mid_v2", "account_id_v2", "ltoken_v2", "ltmid_v2", "ltuid_v2"]
            let cookies = result.cookies.filter { names.contains($0.name) && !$0.value.isEmpty }
            guard Set(cookies.map(\.name)) == Set(names) else { throw Failure.invalid }
            pending.cookie = cookies.map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
            try vault.write(JSONEncoder().encode(pending), to: "pending")
            return "confirmed"
        default: throw Failure.invalid
        }
    }

    private func roles(_ game: Game) async throws -> Fields {
        let result = try await request(
            "https://api-takumi.mihoyo.com/binding/api/getUserGameRolesByCookie",
            query: ["game_biz": game.rawValue + "_cn"],
            headers: gameHeaders(game)
        )
        guard result.code == 0, let entries = result.data["list"] as? [Fields] else {
            throw Failure.invalid
        }
        let roles: [[String: String]] = entries.compactMap { entry in
            guard let uid = entry["game_uid"] as? String, isGameUID(uid),
                  let region = entry["region"] as? String, game.isOfficialRegion(region)
            else { return nil }
            return ["uid": uid, "region": region, "nickname": entry["nickname"] as? String ?? ""]
        }
        return ["state": "ok", "roles": roles]
    }

    func run(action: String, args: [String]) async throws -> Fields {
        switch action {
        case "bound": return ["state": try vault.read("account") == nil ? "unbound" : "ok"]
        case "unbind":
            try vault.delete("pending")
            try vault.delete("account")
        case "start": return try await start()
        case "poll": return ["state": try await poll()]
        case "finish":
            guard let cookie = try pending().cookie else { throw Failure.invalid }
            try vault.write(Data(cookie.utf8), to: "account")
        case "cancel": try vault.delete("pending")
        case "roles", "status", "sign":
            guard let key = args.first, let game = Game(rawValue: key) else { throw Failure.invalid }
            if action == "roles" { return try await roles(game) }
            guard args.count == 3, isGameUID(args[1]),
                  game.isOfficialRegion(args[2])
            else { throw Failure.invalid }
            let params = ["act_id": game.activity, "uid": args[1], "region": args[2]]
            if action == "status" {
                let status = try await request(
                    game.eventBase + "info", query: params, headers: gameHeaders(game)
                )
                guard status.code == 0, let signed = status.data["is_sign"] as? Bool else {
                    throw Failure.invalid
                }
                return ["state": signed ? "signed" : "unsigned"]
            }
            let submitted = try await request(
                game.eventBase + "sign", body: params, headers: gameHeaders(game)
            )
            if submitted.code == -5003 { return ["state": "already"] }
            if submitted.data["success"] as? Int == 1 { throw Failure.manual }
            guard submitted.code == 0 else { throw Failure.invalid }
        default: throw Failure.invalid
        }
        return ["state": "ok"]
    }
}

@main
private enum Main {
    static func main() async throws {
        let args = Array(CommandLine.arguments.dropFirst())
        var result: Fields
        do {
            guard args.count >= 2 else { throw Failure.invalid }
            result = try await Bridge(path: args[0]).run(action: args[1], args: Array(args.dropFirst(2)))
        } catch let failure as Failure {
            result = ["state": failure.rawValue]
        } catch {
            result = ["state": "unavailable"]
        }
        FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: result))
    }
}
