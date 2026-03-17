import Foundation

/// Manages authentication state — JWT tokens stored in Keychain.
@MainActor
final class AuthService: ObservableObject {

    @Published var isAuthenticated = false
    @Published var email: String?
    @Published var loading = false
    @Published var error: String?

    private static let accessTokenKey = "termpod-access-token"
    private static let refreshTokenKey = "termpod-refresh-token"
    private static let emailKey = "termpod-email"

    private(set) var relayHTTP: String
    private var refreshTimer: Timer?

    var accessToken: String? {
        KeychainService.load(key: Self.accessTokenKey)
    }

    /// Returns a valid access token, refreshing if expired or expiring within 60s.
    func validAccessToken() async -> String? {
        if let token = accessToken, !isTokenExpiringSoon(token) {
            return token
        }

        let refreshed = await refresh()

        return refreshed ? accessToken : nil
    }

    private func isTokenExpiringSoon(_ token: String) -> Bool {
        let parts = token.split(separator: ".")

        guard parts.count == 3,
              let data = Data(base64URLEncoded: String(parts[1])),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let exp = json["exp"] as? TimeInterval
        else {
            return true
        }

        return exp - Date().timeIntervalSince1970 < 60
    }

    private static let defaultRelayURL = "https://relay.termpod.dev"
    private static let customRelayURLKey = "termpod-relay-url"

    private static func resolveRelayURL() -> String {
        if let custom = UserDefaults.standard.string(forKey: customRelayURLKey),
           !custom.isEmpty {
            return custom
        }
        let plistURL = Bundle.main.object(forInfoDictionaryKey: "RelayBaseURL") as? String
        if let plistURL, !plistURL.isEmpty {
            return plistURL
        }
        return defaultRelayURL
    }

    func setCustomRelayURL(_ url: String) {
        let normalized = url
            .trimmingCharacters(in: .whitespaces)
            .replacingOccurrences(of: "wss://", with: "https://")
            .replacingOccurrences(of: "ws://", with: "http://")
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        if normalized.isEmpty {
            UserDefaults.standard.removeObject(forKey: Self.customRelayURLKey)
        } else {
            UserDefaults.standard.set(normalized, forKey: Self.customRelayURLKey)
        }
        self.relayHTTP = Self.resolveRelayURL()
    }

    static func getCustomRelayURL() -> String {
        return UserDefaults.standard.string(forKey: customRelayURLKey) ?? ""
    }

    init() {
        self.relayHTTP = Self.resolveRelayURL()

        // Restore session from keychain
        if let token = KeychainService.load(key: Self.accessTokenKey) {
            isAuthenticated = !token.isEmpty
            email = KeychainService.load(key: Self.emailKey)

            if isAuthenticated {
                // Refresh immediately on launch, then every 12 minutes
                Task { await self.refresh() }
                startAutoRefresh()
            }
        }
    }

    private func startAutoRefresh() {
        refreshTimer?.invalidate()
        // Refresh every 12 minutes (access token expires in 15 min)
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 12 * 60, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { @MainActor in
                _ = await self.refresh()
            }
        }
    }

    private func stopAutoRefresh() {
        refreshTimer?.invalidate()
        refreshTimer = nil
    }

    // MARK: - Auth

    func signup(email: String, password: String) async {
        loading = true
        error = nil

        do {
            let body = try JSONSerialization.data(withJSONObject: [
                "email": email,
                "password": password,
            ])

            var request = URLRequest(url: URL(string: "\(relayHTTP)/auth/signup")!)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body

            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                throw AuthError.networkError
            }

            if httpResponse.statusCode != 200 {
                if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let message = json["error"] as? String {
                    throw AuthError.serverError(message)
                }

                throw AuthError.serverError("Signup failed")
            }

            try saveTokens(from: data, email: email)
        } catch let err as AuthError {
            self.error = err.message
        } catch {
            self.error = error.localizedDescription
        }

        loading = false
    }

    func login(email: String, password: String) async {
        loading = true
        self.error = nil

        do {
            let body = try JSONSerialization.data(withJSONObject: [
                "email": email,
                "password": password,
            ])

            var request = URLRequest(url: URL(string: "\(relayHTTP)/auth/login")!)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body

            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
                throw AuthError.serverError("Invalid email or password")
            }

            try saveTokens(from: data, email: email)
        } catch let err as AuthError {
            self.error = err.message
        } catch {
            self.error = error.localizedDescription
        }

        loading = false
    }

    func forgotPassword(email: String) async {
        loading = true
        error = nil

        do {
            let body = try JSONSerialization.data(withJSONObject: ["email": email])

            var request = URLRequest(url: URL(string: "\(relayHTTP)/auth/forgot-password")!)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body

            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                throw AuthError.networkError
            }

            if httpResponse.statusCode == 503 {
                throw AuthError.serverError("Email service temporarily unavailable")
            }

            if httpResponse.statusCode == 429 {
                throw AuthError.serverError("Too many requests. Wait a minute and try again.")
            }

            if httpResponse.statusCode != 200 {
                if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let message = json["error"] as? String {
                    throw AuthError.serverError(message)
                }

                throw AuthError.serverError("Request failed")
            }
        } catch let err as AuthError {
            self.error = err.message
        } catch {
            self.error = error.localizedDescription
        }

        loading = false
    }

    func resetPassword(email: String, code: String, newPassword: String) async {
        loading = true
        error = nil

        do {
            let body = try JSONSerialization.data(withJSONObject: [
                "email": email,
                "code": code,
                "password": newPassword,
            ])

            var request = URLRequest(url: URL(string: "\(relayHTTP)/auth/reset-password")!)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body

            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                throw AuthError.networkError
            }

            if httpResponse.statusCode != 200 {
                if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let message = json["error"] as? String {
                    throw AuthError.serverError(message)
                }

                throw AuthError.serverError("Reset failed. Check your code and try again.")
            }

            try saveTokens(from: data, email: email)
        } catch let err as AuthError {
            self.error = err.message
        } catch {
            self.error = error.localizedDescription
        }

        loading = false
    }

    func logout() {
        stopAutoRefresh()
        KeychainService.delete(key: Self.accessTokenKey)
        KeychainService.delete(key: Self.refreshTokenKey)
        KeychainService.delete(key: Self.emailKey)
        isAuthenticated = false
        email = nil
    }

    func refresh() async -> Bool {
        guard let refreshToken = KeychainService.load(key: Self.refreshTokenKey) else {
            return false
        }

        do {
            let body = try JSONSerialization.data(withJSONObject: [
                "refreshToken": refreshToken,
            ])

            var request = URLRequest(url: URL(string: "\(relayHTTP)/auth/refresh")!)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body

            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
                logout()
                return false
            }

            try saveTokens(from: data, email: email ?? "")
            return true
        } catch {
            return false
        }
    }

    // MARK: - Helpers

    private func saveTokens(from data: Data, email: String) throws {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let accessToken = json["accessToken"] as? String,
              let refreshToken = json["refreshToken"] as? String
        else {
            throw AuthError.invalidResponse
        }

        KeychainService.save(key: Self.accessTokenKey, value: accessToken)
        KeychainService.save(key: Self.refreshTokenKey, value: refreshToken)
        KeychainService.save(key: Self.emailKey, value: email.lowercased())

        self.isAuthenticated = true
        self.email = email.lowercased()
        startAutoRefresh()
    }

    /// Build a WebSocket URL for a session. Token is sent separately via first message.
    func wsURL(sessionId: String) -> URL? {
        let wsBase = relayHTTP
            .replacingOccurrences(of: "https://", with: "wss://")
            .replacingOccurrences(of: "http://", with: "ws://")

        return URL(string: "\(wsBase)/sessions/\(sessionId)/ws")
    }

    /// Build a WebSocket URL with a fresh auth token and return both.
    /// Token is sent as the first WS message, NOT in the URL.
    func authenticatedWSURL(sessionId: String) async -> (url: URL, token: String)? {
        guard let url = wsURL(sessionId: sessionId) else { return nil }

        guard let token = await validAccessToken(), !token.isEmpty else {
            return nil
        }

        return (url, token)
    }

    /// Make an authenticated API request. Auto-refreshes and retries once on 401.
    func apiFetch(path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> (Data, HTTPURLResponse) {
        let token = await validAccessToken()

        let result = try await rawFetch(path: path, method: method, body: body, token: token)

        if result.1.statusCode == 401 {
            let refreshed = await refresh()

            if refreshed {
                return try await rawFetch(path: path, method: method, body: body, token: accessToken)
            }
        }

        return result
    }

    private func rawFetch(path: String, method: String, body: [String: Any]?, token: String?) async throws -> (Data, HTTPURLResponse) {
        var request = URLRequest(url: URL(string: "\(relayHTTP)\(path)")!)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        if let body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw AuthError.networkError
        }

        return (data, httpResponse)
    }
}

// MARK: - Error

private extension Data {
    init?(base64URLEncoded string: String) {
        var base64 = string
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")

        let remainder = base64.count % 4

        if remainder > 0 {
            base64.append(String(repeating: "=", count: 4 - remainder))
        }

        self.init(base64Encoded: base64)
    }
}

enum AuthError: Error {
    case networkError
    case serverError(String)
    case invalidResponse

    var message: String {
        switch self {
        case .networkError: return "Network error"
        case .serverError(let msg): return msg
        case .invalidResponse: return "Invalid response"
        }
    }
}
