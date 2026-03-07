import SwiftUI

struct LoginView: View {

    @EnvironmentObject private var auth: AuthService
    @State private var isSignup = false
    @State private var email = ""
    @State private var password = ""

    var body: some View {
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
                    // Placeholder — no backend support yet
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
                Text(isSignup ? "Already have an account? Sign in" : "Don't have an account? Sign up")
                    .font(.footnote)
            }

            Spacer()
        }
    }
}
