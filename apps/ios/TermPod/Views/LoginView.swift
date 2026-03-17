import SwiftUI

struct LoginView: View {

    @EnvironmentObject private var auth: AuthService
    @State private var isSignup = false
    @State private var email = ""
    @State private var password = ""

    // Forgot password flow
    @State private var view: LoginViewState = .login
    @State private var forgotEmail = ""
    @State private var resetCode = ""
    @State private var newPassword = ""
    @State private var forgotMessage: String? = nil

    // Custom server
    @State private var showCustomServer: Bool = !AuthService.getCustomRelayURL().isEmpty
    @State private var customRelayURL: String = AuthService.getCustomRelayURL()
    @State private var customURLError: String? = nil

    enum LoginViewState {
        case login
        case forgotEmail
        case forgotCode
    }

    var body: some View {
        switch view {
        case .login:
            loginView
        case .forgotEmail:
            forgotEmailView
        case .forgotCode:
            forgotCodeView
        }
    }

    // MARK: - Custom Server

    private func applyCustomURL() -> Bool {
        let trimmed = customRelayURL.trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty {
            var normalized = trimmed
                .replacingOccurrences(of: "wss://", with: "https://")
                .replacingOccurrences(of: "ws://", with: "http://")
            if URL(string: normalized) == nil {
                customURLError = "Invalid URL format"
                return false
            }
            normalized = normalized.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            auth.setCustomRelayURL(normalized)
        } else {
            auth.setCustomRelayURL("")
        }
        customURLError = nil
        return true
    }

    private var customServerSection: some View {
        VStack(spacing: 10) {
            Button {
                withAnimation(.easeInOut(duration: 0.15)) {
                    showCustomServer.toggle()
                }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "server.rack")
                        .font(.system(size: 11))
                        .opacity(0.6)

                    if !showCustomServer, !customRelayURL.isEmpty,
                       let host = URL(string: customRelayURL)?.host {
                        Text(host)
                            .font(.system(size: 12))
                    } else {
                        Text("Self-hosted server")
                            .font(.system(size: 12))
                    }

                    Image(systemName: "chevron.right")
                        .font(.system(size: 8, weight: .medium))
                        .rotationEffect(.degrees(showCustomServer ? 90 : 0))
                        .animation(.easeInOut(duration: 0.15), value: showCustomServer)
                        .opacity(0.5)
                }
                .foregroundStyle(.secondary)
                .opacity(0.6)
            }
            .buttonStyle(.plain)

            if showCustomServer {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Relay URL")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.secondary)

                    HStack(spacing: 10) {
                        Image(systemName: "server.rack")
                            .font(.system(size: 14))
                            .foregroundStyle(.secondary)
                            .frame(width: 18)

                        TextField("https://relay.example.com", text: $customRelayURL)
                            .font(.system(size: 13, design: .monospaced))
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                            .keyboardType(.URL)
                            .onChange(of: customRelayURL) { _, _ in
                                customURLError = nil
                            }
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .background(Color(UIColor.tertiarySystemGroupedBackground))
                    .clipShape(RoundedRectangle(cornerRadius: 10))

                    if let err = customURLError {
                        Text(err)
                            .font(.caption2)
                            .foregroundStyle(.red)
                    }

                    HStack(spacing: 0) {
                        Text("Leave empty for default relay. ")
                            .foregroundStyle(.tertiary)
                        Link("Self-hosting guide \u{2192}", destination: URL(string: "https://github.com/termpod/termpod/blob/main/docs/SELF-HOSTING.md")!)
                            .foregroundStyle(Self.gold)
                    }
                    .font(.system(size: 11))
                }
                .padding(14)
                .background(Color(UIColor.quaternarySystemFill))
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .padding(.horizontal, 32)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }

    // MARK: - Shared Components

    private static let gold = Color(red: 201 / 255, green: 169 / 255, blue: 98 / 255)

    private var logoView: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 16)
                .fill(
                    LinearGradient(
                        colors: [Self.gold, Self.gold.opacity(0.8)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .frame(width: 64, height: 64)
                .shadow(color: Self.gold.opacity(0.25), radius: 20, y: 6)

            Image(systemName: "terminal")
                .font(.system(size: 28, weight: .medium))
                .foregroundStyle(.black)
        }
    }

    private func headerView(title: String, subtitle: String) -> some View {
        VStack(spacing: 8) {
            logoView

            Text(title)
                .font(.title2)
                .fontWeight(.bold)

            Text(subtitle)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }

    private func inputField(
        icon: String,
        placeholder: String,
        text: Binding<String>,
        isSecure: Bool = false,
        contentType: UITextContentType? = nil,
        keyboardType: UIKeyboardType = .default
    ) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 14))
                .foregroundStyle(.secondary)
                .frame(width: 18)

            if isSecure {
                SecureField(placeholder, text: text)
                    .textContentType(contentType)
            } else {
                TextField(placeholder, text: text)
                    .textContentType(contentType)
                    .keyboardType(keyboardType)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(Color(UIColor.tertiarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    // MARK: - Login

    private var loginView: some View {
        VStack(spacing: 24) {
            Spacer()

            headerView(
                title: "TermPod",
                subtitle: isSignup ? "Create your account" : "Sign in to your account"
            )

            VStack(spacing: 10) {
                inputField(
                    icon: "envelope",
                    placeholder: "Email",
                    text: $email,
                    contentType: .emailAddress,
                    keyboardType: .emailAddress
                )

                inputField(
                    icon: "lock",
                    placeholder: "Password",
                    text: $password,
                    isSecure: true,
                    contentType: isSignup ? .newPassword : .password
                )

                if isSignup {
                    Text("Minimum 8 characters")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.leading, 4)
                }

                if let error = auth.error {
                    errorBanner(error)
                }

                Button {
                    guard applyCustomURL() else { return }
                    Task {
                        if isSignup {
                            await auth.signup(email: email, password: password)
                        } else {
                            await auth.login(email: email, password: password)
                        }
                    }
                } label: {
                    if auth.loading {
                        ProgressView()
                            .tint(.white)
                            .frame(maxWidth: .infinity)
                    } else {
                        Text(isSignup ? "Create Account" : "Sign In")
                            .fontWeight(.semibold)
                            .frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.roundedRectangle(radius: 10))
                .controlSize(.large)
                .disabled(email.isEmpty || password.count < 8 || auth.loading)
            }
            .padding(.horizontal, 32)

            VStack(spacing: 8) {
                if !isSignup {
                    Button {
                        forgotEmail = email
                        auth.error = nil
                        withAnimation(.easeInOut(duration: 0.2)) {
                            view = .forgotEmail
                        }
                    } label: {
                        Text("Forgot password?")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }

                Button {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        isSignup.toggle()
                        auth.error = nil
                    }
                } label: {
                    Text(isSignup ? "Already have an account? **Sign in**" : "Don't have an account? **Sign up**")
                        .font(.footnote)
                }
            }

            customServerSection

            Spacer()
        }
    }

    // MARK: - Forgot Email

    private var forgotEmailView: some View {
        VStack(spacing: 24) {
            Spacer()

            headerView(
                title: "Reset password",
                subtitle: "Enter your email to receive a reset code"
            )

            VStack(spacing: 10) {
                inputField(
                    icon: "envelope",
                    placeholder: "Email",
                    text: $forgotEmail,
                    contentType: .emailAddress,
                    keyboardType: .emailAddress
                )

                if let error = auth.error {
                    errorBanner(error)
                }

                Button {
                    Task {
                        auth.error = nil
                        await auth.forgotPassword(email: forgotEmail)

                        if auth.error == nil {
                            forgotMessage = "Check your email for a 6-digit reset code."
                            withAnimation(.easeInOut(duration: 0.2)) {
                                view = .forgotCode
                            }
                        }
                    }
                } label: {
                    if auth.loading {
                        ProgressView()
                            .tint(.white)
                            .frame(maxWidth: .infinity)
                    } else {
                        Text("Send Reset Code")
                            .fontWeight(.semibold)
                            .frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.roundedRectangle(radius: 10))
                .controlSize(.large)
                .disabled(forgotEmail.isEmpty || auth.loading)
            }
            .padding(.horizontal, 32)

            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    auth.error = nil
                    view = .login
                }
            } label: {
                Text("Back to sign in")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Spacer()
        }
    }

    // MARK: - Forgot Code

    private var forgotCodeView: some View {
        VStack(spacing: 24) {
            Spacer()

            headerView(
                title: "Enter reset code",
                subtitle: "Check your email for a 6-digit code"
            )

            VStack(spacing: 10) {
                if let msg = forgotMessage {
                    Text(msg)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                }

                inputField(
                    icon: "number",
                    placeholder: "6-digit code",
                    text: $resetCode,
                    keyboardType: .numberPad
                )
                .onChange(of: resetCode) { _, newValue in
                    resetCode = String(newValue.filter(\.isNumber).prefix(6))
                }

                inputField(
                    icon: "lock",
                    placeholder: "New password",
                    text: $newPassword,
                    isSecure: true,
                    contentType: .newPassword
                )

                Text("Minimum 8 characters")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.leading, 4)

                if let error = auth.error {
                    errorBanner(error)
                }

                Button {
                    Task {
                        auth.error = nil
                        await auth.resetPassword(email: forgotEmail, code: resetCode, newPassword: newPassword)
                    }
                } label: {
                    if auth.loading {
                        ProgressView()
                            .tint(.white)
                            .frame(maxWidth: .infinity)
                    } else {
                        Text("Reset Password")
                            .fontWeight(.semibold)
                            .frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.roundedRectangle(radius: 10))
                .controlSize(.large)
                .disabled(resetCode.count != 6 || newPassword.count < 8 || auth.loading)
            }
            .padding(.horizontal, 32)

            VStack(spacing: 8) {
                Button {
                    auth.error = nil
                    Task {
                        await auth.forgotPassword(email: forgotEmail)

                        if auth.error == nil {
                            forgotMessage = "A new code has been sent to your email."
                        }
                    }
                } label: {
                    Text("Resend code")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .disabled(auth.loading)

                Button {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        auth.error = nil
                        view = .login
                    }
                } label: {
                    Text("Back to sign in")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()
        }
    }

    // MARK: - Error Banner

    private func errorBanner(_ message: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 14))

            Text(message)
                .font(.caption)
        }
        .foregroundStyle(.red)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.red.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .transition(.opacity)
    }
}
