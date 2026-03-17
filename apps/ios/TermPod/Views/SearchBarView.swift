import SwiftUI
import SwiftTerm

struct SearchBarView: View {

    @Binding var isVisible: Bool
    let terminalView: RemoteTerminalView?
    @State private var query = ""
    @State private var hasMatch = true
    @FocusState private var isFocused: Bool

    var body: some View {
        HStack(spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)

                TextField("Search...", text: $query)
                    .font(.system(size: 14))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($isFocused)
                    .onSubmit { findNext() }
                    .onChange(of: query) { _, newQuery in
                        if newQuery.isEmpty {
                            terminalView?.clearSearch()
                            hasMatch = true
                        } else {
                            hasMatch = terminalView?.findNext(newQuery) ?? false
                        }
                    }

                if !query.isEmpty {
                    Button {
                        query = ""
                        terminalView?.clearSearch()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 14))
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .background(Color(UIColor.tertiarySystemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 8))

            if !query.isEmpty {
                if !hasMatch {
                    Text("No matches")
                        .font(.system(size: 11))
                        .foregroundStyle(.tertiary)
                }

                HStack(spacing: 4) {
                    Button {
                        hasMatch = terminalView?.findPrevious(query) ?? false
                    } label: {
                        Image(systemName: "chevron.up")
                            .font(.system(size: 13, weight: .semibold))
                    }

                    Button {
                        findNext()
                    } label: {
                        Image(systemName: "chevron.down")
                            .font(.system(size: 13, weight: .semibold))
                    }
                }
            }

            Button("Done") {
                terminalView?.clearSearch()
                withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                    isVisible = false
                }
            }
            .font(.system(size: 14, weight: .medium))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.ultraThinMaterial)
        .onAppear {
            isFocused = true
        }
    }

    @discardableResult
    private func findNext() -> Bool {
        guard !query.isEmpty else { return false }
        let result = terminalView?.findNext(query) ?? false
        hasMatch = result
        return result
    }
}
