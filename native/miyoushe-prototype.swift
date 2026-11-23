import CoreImage
import CryptoKit
import Foundation

// Development-only bridge. Credentials stay in native memory.
// Build and stage the two development helpers as described in docs/miyoushe-prototype.md.
// Protocol references: MightyOwls/MYS-Daily and XYRQ-Dev/miyoushe-tool.
private enum Failure: String, Error {
    case unavailable, invalid, network, limited, manual, unbound, expired
    case firstCheckIn = "first-check-in"
    case historyAuthorizationExpired = "account-authorization-expired"
}

private struct Rejected: Error {
    let code: Int
}

private typealias Fields = [String: Any]

private func isGameUID(_ value: String) -> Bool {
    value.range(of: #"^[0-9]{1,19}$"#, options: .regularExpression) != nil
}

private func credential(_ value: Any?) -> String? {
    guard let value = value as? String, !value.isEmpty, value.utf8.count <= 4096,
          value.range(of: #"^[a-zA-Z0-9._~+/%=\-]+$"#, options: .regularExpression) != nil
    else { return nil }
    return value
}

private struct AppAuthorization {
    let uid: String
    let mid: String
    let token: String

    var cookie: String { "stoken=\(token); mid=\(mid); stuid=\(uid)" }
}

private struct Pending {
    let ticket: String
    let expires: Date
    var authorization: AppAuthorization?
}

private struct SessionAccount {
    let id: String
    var cookie: String
    var profile: [String: String]
    let authorization: AppAuthorization

    var summary: Fields { ["id": id, "profile": profile] }
}

private struct SessionAccounts {
    var activeAccountId: String?
    var accounts: [SessionAccount] = []

    var summary: Fields {
        var reply: Fields = ["state": "ok", "accounts": accounts.map(\.summary)]
        reply["activeAccountId"] = activeAccountId
        return reply
    }
}

private func maskedProfile(_ uid: String) -> [String: String] {
    ["maskedId": "••••" + uid.suffix(uid.count > 4 ? 4 : 0)]
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

private final class Bridge {
    private let passport = "https://passport-api.mihoyo.com/account/ma-cn-passport/app/"
    private let device = UUID().uuidString.lowercased()
    private var pendingLogin: Pending?
    private var accounts = SessionAccounts()
    private let session: URLSession

    init() {
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
    ) async throws -> (code: Int, data: Fields) {
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
        let hasChallenge = ["gt", "challenge"].contains {
            guard let value = data[$0] as? String else { return false }
            return !value.isEmpty
        }
        if code == 1034 || code == -3503 || hasChallenge {
            throw Failure.manual
        }
        if code == -100 || code == -101 { throw Failure.unbound }
        return (code, data)
    }

    private var qrHeaders: [String: String] {
        [
            "x-rpc-app_id": "ddxf5dufpuyo",
            "x-rpc-client_type": "3",
            "x-rpc-device_id": device,
        ]
    }

    private func savedAccount(_ id: String) throws -> SessionAccount {
        guard UUID(uuidString: id) != nil,
              let account = accounts.accounts.first(where: { $0.id == id })
        else { throw Failure.unbound }
        return account
    }

    private func signedHeaders(cookie: String) -> [String: String] {
        let time = Int(Date().timeIntervalSince1970)
        let nonce = UUID().uuidString.lowercased().prefix(6)
        let input = "salt=d9200c846b10886e8c874fc33c8f308b&t=\(time)&r=\(nonce)"
        let signature = Insecure.MD5.hash(data: Data(input.utf8))
            .map { String(format: "%02x", $0) }.joined()
        return [
            "Cookie": cookie,
            "DS": "\(time),\(nonce),\(signature)",
            "x-rpc-client_type": "5",
            "x-rpc-device_id": device,
        ]
    }

    private func activityHeaders(_ game: Game) -> [String: String] {
        var headers = ["Origin": "https://act.mihoyo.com", "Referer": "https://act.mihoyo.com/"]
        if game == .hk4e { headers["x-rpc-signgame"] = "hk4e" }
        if game == .nap { headers["x-rpc-signgame"] = "zzz" }
        return headers
    }

    private func gameHeaders(_ game: Game, cookie: String) -> [String: String] {
        signedHeaders(cookie: cookie).merging(activityHeaders(game)) { _, activity in activity }
    }

    private func start() async throws -> Fields {
        pendingLogin = nil
        let result = try await request(passport + "createQRLogin", body: [:], headers: qrHeaders)
        guard result.code == 0 else { throw Rejected(code: result.code) }
        guard
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
        pendingLogin = Pending(ticket: ticket, expires: Date().addingTimeInterval(120))
        return ["state": "ok", "qr": png.base64EncodedString()]
    }

    private func pending() throws -> Pending {
        guard let pending = pendingLogin, pending.expires > Date() else {
            pendingLogin = nil
            throw Failure.expired
        }
        return pending
    }

    private func poll() async throws -> String {
        var pending = try pending()
        let result = try await request(
            passport + "queryQRLoginStatus",
            query: ["ticket": pending.ticket],
            body: ["ticket": pending.ticket],
            headers: qrHeaders
        )
        if [-106, -3501, -3505].contains(result.code) { throw Failure.expired }
        guard result.code == 0 else { throw Failure.invalid }
        switch result.data["status"] as? String {
        case "Created", "Init": return "waiting"
        case "Scanned", "ScannedWaitingConfirmation": return "scanned"
        case "Expired", "Timeout": return "expired"
        case "Confirmed":
            let user = result.data["user_info"] as? Fields
            let tokens = result.data["tokens"] as? [Fields]
            let session = tokens?.first { ($0["token_type"] as? Int) == 1 || ($0["name"] as? String) == "stoken" }
            guard let uid = user?["aid"] as? String, isGameUID(uid),
                  let mid = credential(user?["mid"]), let token = credential(session?["token"])
            else { throw Failure.invalid }
            pending.authorization = AppAuthorization(uid: uid, mid: mid, token: token)
            pendingLogin = pending
            return "confirmed"
        default: throw Failure.invalid
        }
    }

    private func roles(_ game: Game, cookie: String) async throws -> Fields {
        let result = try await request(
            "https://api-takumi.mihoyo.com/binding/api/getUserGameRolesByCookie",
            query: ["game_biz": game.rawValue + "_cn"],
            headers: gameHeaders(game, cookie: cookie)
        )
        guard result.code == 0 else { throw Rejected(code: result.code) }
        guard let entries = result.data["list"] as? [Fields] else { throw Failure.invalid }
        let roles: [[String: String]] = entries.compactMap { entry in
            guard entry["game_biz"] as? String == game.rawValue + "_cn",
                  entry["is_official"] as? Bool != false,
                  let uid = entry["game_uid"] as? String, isGameUID(uid),
                  let region = entry["region"] as? String, game.isOfficialRegion(region)
            else { return nil }
            return ["uid": uid, "region": region, "nickname": entry["nickname"] as? String ?? ""]
        }
        return ["state": "ok", "roles": roles]
    }

    private func appCookie(_ authorization: AppAuthorization) async throws -> String {
        let passport = "https://passport-api.mihoyo.com/account/auth/api/"
        let headers = signedHeaders(cookie: authorization.cookie)
        let response = try await request(passport + "getCookieAccountInfoBySToken",
                                         query: ["stoken": authorization.token, "uid": authorization.uid],
                                         headers: headers)
        guard response.code == 0 else { throw Rejected(code: response.code) }
        guard response.data["uid"] as? String == authorization.uid,
              let token = credential(response.data["cookie_token"])
        else { throw Failure.invalid }
        let ltokenResponse = try await request(passport + "getLTokenBySToken", headers: headers)
        guard ltokenResponse.code == 0 else { throw Rejected(code: ltokenResponse.code) }
        guard let ltoken = credential(ltokenResponse.data["ltoken"]) else { throw Failure.invalid }

        var fields = ["account_id=\(authorization.uid)"]
        if token.hasPrefix("v2_") {
            fields += ["cookie_token_v2=\(token)", "account_id_v2=\(authorization.uid)", "account_mid_v2=\(authorization.mid)"]
        } else {
            fields.append("cookie_token=\(token)")
        }
        if ltoken.hasPrefix("v2_") {
            fields += ["ltoken_v2=\(ltoken)", "ltuid_v2=\(authorization.uid)", "ltmid_v2=\(authorization.mid)"]
        } else {
            fields += ["ltoken=\(ltoken)", "ltuid=\(authorization.uid)"]
        }
        return fields.joined(separator: "; ")
    }

    private func accountRoles(_ game: Game, id: String) async throws -> Fields {
        let account = try savedAccount(id)
        do { return try await roles(game, cookie: account.cookie) }
        catch Failure.unbound {
            let cookie = try await appCookie(account.authorization)
            let result = try await roles(game, cookie: cookie)
            if let index = accounts.accounts.firstIndex(where: { $0.id == id }) {
                accounts.accounts[index].cookie = cookie
            }
            return result
        }
    }

    private struct WishHistoryRequest: Decodable {
        let accountId: String
        let uid: String
        let heads: [String: String]?
    }

    private func wishHistory(_ input: Data) async throws -> Fields {
        guard let target = try? JSONDecoder().decode(WishHistoryRequest.self, from: input),
              isGameUID(target.uid) else { throw Failure.invalid }
        let authorization: AppAuthorization
        do {
            authorization = try savedAccount(target.accountId).authorization
        } catch Failure.unbound {
            throw Failure.historyAuthorizationExpired
        }
        let result: (code: Int, data: Fields)
        do {
            var headers = signedHeaders(cookie: authorization.cookie)
            headers["Referer"] = "https://webstatic.mihoyo.com/"
            result = try await request(
                "https://api-takumi.miyoushe.com/binding/api/genAuthKey",
                body: ["game_biz": "hk4e_cn", "game_uid": target.uid,
                       "region": "cn_gf01", "auth_appid": "webview_gacha"],
                headers: headers
            )
        } catch Failure.unbound {
            throw Failure.historyAuthorizationExpired
        }
        if result.code == 1016 { throw WishHistoryFailure.historyMismatch }
        if result.code == -110 || result.code == -1100 { throw Failure.limited }
        guard result.code == 0 else { throw Rejected(code: result.code) }
        guard let key = credential(result.data["authkey"]),
              let version = result.data["authkey_ver"] as? Int,
              let signType = result.data["sign_type"] as? Int
        else { throw Failure.invalid }
        return try await fetchAccountWishHistory(key: key, version: String(version), signType: String(signType),
                                                 uid: target.uid, heads: target.heads ?? [:])
    }

    private func profile(_ uid: String) async throws -> [String: String] {
        let result = try await request(
            "https://bbs-api.miyoushe.com/user/api/getUserFullInfo",
            query: ["uid": uid], headers: [:]
        )
        guard result.code == 0 else { throw Rejected(code: result.code) }
        guard let user = result.data["user_info"] as? Fields,
              user["uid"] as? String == uid
        else { throw Failure.invalid }
        var profile = maskedProfile(uid)
        profile["nickname"] = (user["nickname"] as? String).map { String($0.prefix(100)) }
        if let avatar = user["avatar_url"] as? String,
           let url = URLComponents(string: avatar), url.scheme == "https",
           url.user == nil, url.password == nil, url.port == nil,
           ["img-static.mihoyo.com", "img-static.miyoushe.com", "upload-bbs.mihoyo.com", "bbs-static.miyoushe.com"]
            .contains(url.host ?? "") {
            profile["avatar"] = avatar
        }
        return profile
    }

    func run(action: String, args: [String], input: Data) async throws -> Fields {
        switch action {
        case "accounts": return accounts.summary
        case "profile":
            guard let id = args.first else { throw Failure.invalid }
            let profile = try await profile(savedAccount(id).authorization.uid)
            return ["state": "ok", "profile": profile]
        case "select", "unbind":
            guard let id = args.first else { throw Failure.invalid }
            guard let index = accounts.accounts.firstIndex(where: { $0.id == id })
            else { throw Failure.unbound }
            if action == "select" {
                accounts.activeAccountId = id
            } else {
                accounts.accounts.remove(at: index)
                if accounts.activeAccountId == id { accounts.activeAccountId = accounts.accounts.first?.id }
            }
            return accounts.summary
        case "wish-history": return try await wishHistory(input)
        case "start": return try await start()
        case "poll": return ["state": try await poll()]
        case "finish":
            guard let name = args.first, let game = Game(rawValue: name) else { throw Failure.invalid }
            let pending = try pending()
            pendingLogin = nil
            guard let authorization = pending.authorization else { throw Failure.invalid }
            let cookie = try await appCookie(authorization)
            _ = try await roles(game, cookie: cookie)
            let uid = authorization.uid
            let details = try? await profile(uid)
            let existing = accounts.accounts.firstIndex(where: { $0.authorization.uid == uid })
            let previous = existing.map { accounts.accounts[$0] }
            let account = SessionAccount(id: previous?.id ?? UUID().uuidString.lowercased(), cookie: cookie,
                                         profile: details ?? previous?.profile ?? maskedProfile(uid),
                                         authorization: authorization)
            if let index = existing { accounts.accounts[index] = account }
            else { accounts.accounts.append(account) }
            accounts.activeAccountId = account.id
            return accounts.summary
        case "cancel": pendingLogin = nil
        case "check-in-rewards":
            guard args.count == 1, let game = Game(rawValue: args[0]) else { throw Failure.invalid }
            let result = try await request(
                game.eventBase + "home", query: ["act_id": game.activity], headers: activityHeaders(game)
            )
            guard result.code == 0 else { throw Rejected(code: result.code) }
            guard let month = result.data["month"] as? Int,
                  let awards = result.data["awards"] as? [Fields], (1...31).contains(awards.count)
            else { throw Failure.invalid }
            let rewards = try awards.map { award -> Fields in
                guard let name = award["name"] as? String, let count = award["cnt"] as? Int
                else { throw Failure.invalid }
                var reward: Fields = ["name": name, "count": count]
                reward["icon"] = award["icon"] as? String
                return reward
            }
            return ["state": "ok", "month": month, "rewards": rewards]
        case "roles", "status", "sign":
            guard let key = args.first, let game = Game(rawValue: key) else { throw Failure.invalid }
            if action == "roles" {
                guard args.count == 2 else { throw Failure.invalid }
                return try await accountRoles(game, id: args[1])
            }
            guard args.count == 4, isGameUID(args[1]),
                  game.isOfficialRegion(args[2])
            else { throw Failure.invalid }
            let params = ["act_id": game.activity, "uid": args[1], "region": args[2]]
            let headers = gameHeaders(game, cookie: try savedAccount(args[3]).cookie)
            if action == "status" {
                let status = try await request(
                    game.eventBase + "info", query: params, headers: headers
                )
                guard status.code == 0 else { throw Rejected(code: status.code) }
                guard let signed = status.data["is_sign"] as? Bool else { throw Failure.invalid }
                if !signed, status.data["first_bind"] as? Bool == true {
                    throw Failure.firstCheckIn
                }
                var reply: Fields = ["state": signed ? "signed" : "unsigned"]
                reply["claimedDays"] = status.data["total_sign_day"] as? Int
                return reply
            }
            let submitted = try await request(
                game.eventBase + "sign", body: params, headers: headers
            )
            if submitted.code == -5003 { return ["state": "already"] }
            if submitted.data["success"] as? Int == 1 { throw Failure.manual }
            guard submitted.code == 0 else { throw Rejected(code: submitted.code) }
        default: throw Failure.invalid
        }
        return ["state": "ok"]
    }
}

@main
private enum Main {
    private struct SessionRequest: Decodable {
        let action: String
        let args: [String]
        let input: String?
    }

    static func main() async throws {
        let args = Array(CommandLine.arguments.dropFirst())
        guard args == ["session"] else { return }
        try await serveSession()
    }

    private static func serveSession() async throws {
        let parent = getppid()
        guard parent > 1 else { return }
        let parentExit = DispatchSource.makeProcessSource(identifier: parent, eventMask: .exit, queue: .global())
        parentExit.setEventHandler { exit(EXIT_SUCCESS) }
        parentExit.resume()
        defer { parentExit.cancel() }
        guard getppid() == parent else { return }

        let bridge = Bridge()
        let decoder = JSONDecoder()
        while let line = readLine() {
            let result = await reply {
                let request = try decoder.decode(SessionRequest.self, from: Data(line.utf8))
                return try await bridge.run(action: request.action, args: request.args, input: Data((request.input ?? "").utf8))
            }
            try writeWishHistoryLine(result)
        }
    }

    private static func reply(_ action: () async throws -> Fields) async -> Fields {
        var result: Fields
        do {
            result = try await action()
        } catch let failure as Failure {
            result = ["state": failure.rawValue]
        } catch let failure as WishHistoryFailure {
            result = ["state": failure.rawValue]
        } catch let failure as Rejected {
            result = ["state": "invalid", "code": failure.code]
        } catch {
            result = ["state": "unavailable"]
        }
        return result
    }
}
