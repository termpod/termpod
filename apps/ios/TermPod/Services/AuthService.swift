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

    private let relayHTTP: String
    private var refreshTimer: Timer?

    var accessToken: String? {
        KeychainService.load(key: Self.accessTokenKey)
    }

    private static let defaultRelayURL = "https://relay.termpod.dev"

    init() {
        let plistURL = Bundle.main.object(forInfoDictionaryKey: "RelayBaseURL") as? String
        let base = (plistURL?.isEmpty == false) ? plistURL! : Self.defaultRelayURL
        self.relayHTTP = base

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

    /// Build a WebSocket URL with auth token. Returns nil if not authenticated.
    func authenticatedWSURL(sessionId: String) -> URL? {
        let wsBase = relayHTTP
            .replacingOccurrences(of: "https://", with: "wss://")
            .replacingOccurrences(of: "http://", with: "ws://")

        guard let token = accessToken, !token.isEmpty else {
            return nil
        }

        return URL(string: "\(wsBase)/sessions/\(sessionId)/ws?token=\(token)")
    }

    /// Make an authenticated API request.
    func apiFetch(path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> (Data, HTTPURLResponse) {
        var request = URLRequest(url: URL(string: "\(relayHTTP)\(path)")!)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if let token = accessToken {
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
