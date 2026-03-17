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

    // MARK: - Login

    private var loginView: some View {
        VStack(spacing: 24) {
            Spacer()

            Image(systemName: "terminal")
                .font(.system(size: 48))
                .foregroundStyle(.tint)

            Text("TermPod")
                .font(.largeTitle)
                .fontWeight(.bold)

            Text(isSignup ? "Create your account" : "Sign in to your account")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            VStack(spacing: 12) {
                TextField("Email", text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .textFieldStyle(.roundedBorder)

                SecureField("Password", text: $password)
                    .textContentType(isSignup ? .newPassword : .password)
                    .textFieldStyle(.roundedBorder)

                if isSignup {
                    Text("Minimum 8 characters")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                if let error = auth.error {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .transition(.opacity)
                }

                Button {
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
                            .frame(maxWidth: .infinity)
                    } else {
                        Text(isSignup ? "Create Account" : "Sign In")
                            .frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(email.isEmpty || password.count < 8 || auth.loading)
            }
            .padding(.horizontal, 32)

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
                }
            }

            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    isSignup.toggle()
                    auth.error = nil
                }
            } label: {
                Text(isSignup ? "Already have an account? Sign in" : "Don't have an account? Sign up")
                    .font(.footnote)
            }

            Spacer()
        }
    }

    // MARK: - Forgot Email

    private var forgotEmailView: some View {
        VStack(spacing: 24) {
            Spacer()

            Image(systemName: "terminal")
                .font(.system(size: 48))
                .foregroundStyle(.tint)

            Text("TermPod")
                .font(.largeTitle)
                .fontWeight(.bold)

            Text("Reset your password")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            VStack(spacing: 12) {
                TextField("Email", text: $forgotEmail)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .textFieldStyle(.roundedBorder)

                if let error = auth.error {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .transition(.opacity)
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
                            .frame(maxWidth: .infinity)
                    } else {
                        Text("Send Reset Code")
                            .frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
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
            }

            Spacer()
        }
    }

    // MARK: - Forgot Code

    private var forgotCodeView: some View {
        VStack(spacing: 24) {
            Spacer()

            Image(systemName: "terminal")
                .font(.system(size: 48))
                .foregroundStyle(.tint)

            Text("TermPod")
                .font(.largeTitle)
                .fontWeight(.bold)

            Text("Enter your reset code")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            VStack(spacing: 12) {
                if let msg = forgotMessage {
                    Text(msg)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                }

                TextField("6-digit code", text: $resetCode)
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode)
                    .autocorrectionDisabled()
                    .textFieldStyle(.roundedBorder)
                    .onChange(of: resetCode) { _, newValue in
                        resetCode = String(newValue.filter(\.isNumber).prefix(6))
                    }

                SecureField("New password", text: $newPassword)
                    .textContentType(.newPassword)
                    .textFieldStyle(.roundedBorder)

                Text("Minimum 8 characters")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)

                if let error = auth.error {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .transition(.opacity)
                }

                Button {
                    Task {
                        auth.error = nil
                        await auth.resetPassword(email: forgotEmail, code: resetCode, newPassword: newPassword)

                        if auth.error == nil {
                            // Auto-logged in — auth.isAuthenticated will flip via saveTokens
                        }
                    }
                } label: {
                    if auth.loading {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                    } else {
                        Text("Reset Password")
                            .frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(resetCode.count != 6 || newPassword.count < 8 || auth.loading)
            }
            .padding(.horizontal, 32)

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
            }

            Spacer()
        }
    }
}
