import SwiftUI

struct LoginView: View {

    @EnvironmentObject private var auth: AuthService
    @State private var isSignup = false
    @State private var email = ""
    @State private var password = ""

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            Text("Termpod")
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

                if let error = auth.error {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
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

            Button {
                isSignup.toggle()
                auth.error = nil
            } label: {
                Text(isSignup ? "Already have an account? Sign in" : "Don't have an account? Sign up")
                    .font(.footnote)
            }

            Spacer()
        }
    }
}
