import SwiftUI

struct PodDetailView: View {
  @Bindable var model: PodsModel
  @State private var section = "Chat"
  @FocusState private var composerFocused: Bool
  @State private var confirmingRun = false
  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Label(
          model.online ? "Desktop online" : "Offline · cached content",
          systemImage: model.online ? "network" : "wifi.slash"
        ).font(.caption)
        Spacer()
        if model.busy { ProgressView() }
      }.padding(.horizontal).padding(.vertical, 8).foregroundStyle(.secondary)
      Picker("Pod section", selection: $section) {
        ForEach(["Chat", "Runs", "Setup"], id: \.self) { Text($0) }
      }.pickerStyle(.segmented).padding(.horizontal)
      if section == "Chat" { chat } else if section == "Runs" { runList } else { setup }
    }
    .navigationTitle(model.pod["name"].string ?? "Pod")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Button {
          Task { await model.refresh() }
        } label: {
          Image(systemName: "arrow.clockwise")
        }.disabled(model.busy).accessibilityLabel("Refresh Pod")
      }
    }
    .confirmationDialog(
      "Start one run on your desktop?", isPresented: $confirmingRun, titleVisibility: .visible
    ) {
      Button("Start authorized run") { Task { await model.runOnce() } }
    } message: {
      Text(
        "Existing permissions and grant checks still apply. The desktop may request a separate approval from your identity provider."
      )
    }
    .task(id: model.selectedPod) {
      while !Task.isCancelled {
        do { try await Task.sleep(for: .seconds(5)) } catch { return }
        if model.conversation["state"].string == "running"
          || model.runs["runs"].array.contains(where: { $0["state"].string == "running" })
        {
          await model.refresh()
        }
      }
    }
  }
  private var chat: some View {
    VStack(spacing: 0) {
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 20) {
          if model.conversation["messages"].array.isEmpty {
            ContentUnavailableView(
              "Describe your Pod", systemImage: "bubble.left.and.bubble.right",
              description: Text(
                "Explain what it should do. Review proposed changes before applying them."))
          }
          ForEach(
            model.conversation["messages"].array.filter { $0["role"].string != "tool" },
            id: \.recordID
          ) { message in
            VStack(alignment: .leading, spacing: 6) {
              Text(message["role"].string == "user" ? "You" : "Pod assistant").font(.caption.bold())
                .foregroundStyle(.secondary)
              Text(message["text"].string ?? "").textSelection(.enabled)
              if message["state"].string == "interrupted" {
                Text("Interrupted — inspect before retrying").font(.caption).foregroundStyle(
                  .orange)
              }
            }.padding().frame(maxWidth: .infinity, alignment: .leading).background(
              message["role"].string == "user"
                ? Color.indigo.opacity(0.08) : Color.secondary.opacity(0.05),
              in: RoundedRectangle(cornerRadius: 16))
          }
          ForEach(model.conversation["changes"].array, id: \.recordID) { review in
            ChangeReviewCard(review: review, enabled: model.canControl) { apply in
              Task { await model.decide(review, apply: apply) }
            }
          }
          if let error = model.conversation["error"].string {
            Label(error, systemImage: "exclamationmark.circle").foregroundStyle(.orange)
          }
        }.padding()
      }
      .scrollDismissesKeyboard(.interactively)
      Divider()
      HStack(alignment: .bottom, spacing: 12) {
        TextField("Message this Pod", text: $model.draft, axis: .vertical).lineLimit(1...6)
          .textFieldStyle(.roundedBorder).focused($composerFocused)
          .accessibilityIdentifier("chat.composer")
        Button {
          composerFocused = false
          Task { await model.sendChat() }
        } label: {
          Image(systemName: "arrow.up.circle.fill").font(.title)
        }.disabled(
          !model.canControl || model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || model.conversation["state"].string == "running"
        ).accessibilityLabel("Send message")
      }.padding()
    }
  }
  private var runList: some View {
    List {
      Section {
        Button {
          confirmingRun = true
        } label: {
          Label("Run once", systemImage: "play.fill")
        }.disabled(!model.canControl || model.pod["activeScript"].string == nil)
        Text(
          "Runs execute on your desktop. A sent cancellation becomes final only when the desktop reports it stopped."
        ).font(.caption).foregroundStyle(.secondary)
      }
      ForEach(Array(model.runs["approvals"].array.enumerated()), id: \.offset) { _, approval in
        if approval["state"].string == "pending" {
          Section("Approval needed") {
            Text(approval["title"].string ?? "Execution approval")
            if let url = approvalURL(approval) {
              Link("Review at identity provider", destination: url)
            }
            Text(
              "Returning from the browser does not approve the run. The desktop verifies the grant directly."
            ).font(.caption).foregroundStyle(.secondary)
          }
        }
      }
      ForEach(Array(model.runs["runs"].array.enumerated()), id: \.offset) { _, run in
        Section {
          LabeledContent("Status", value: run["state"].string ?? "Unknown")
          Text(run["summary"].string ?? "").textSelection(.enabled)
          if let error = run["error"].string {
            Text(error).foregroundStyle(.orange).textSelection(.enabled)
          }
          Text(run["id"].string ?? "").font(.caption.monospaced()).foregroundStyle(.secondary)
            .textSelection(.enabled)
          if run["state"].string == "running", let id = run["id"].string {
            Button("Request cancellation", role: .destructive) {
              Task { await model.cancel(runId: id) }
            }.disabled(!model.canControl)
          }
        }
      }
    }
  }
  private var setup: some View {
    List {
      Section("Desktop setup") {
        LabeledContent("Agent identity", value: model.pod["phase"].string ?? "Unknown")
        if let error = model.pod["error"].string { Text(error).foregroundStyle(.orange) }
        Text(
          "Local file selection, program installation, command permissions, provider sign-in and secret entry require the desktop. Continue this same conversation there, then refresh here."
        ).foregroundStyle(.secondary)
      }
      Section("Programs offered by your desktop") {
        ForEach(Array(model.catalog["programs"].array.enumerated()), id: \.offset) { _, item in
          Button("Review \(item["program"]["name"].string ?? "program")") {
            Task { await model.prepareAssignment(item) }
          }.disabled(!model.canControl)
        }
        if model.catalog["programs"].array.isEmpty {
          Text("Offer an installed CLI from Mobile access on your desktop.").foregroundStyle(
            .secondary)
        }
      }
      ForEach(Array(model.catalog["reviews"].array.enumerated()), id: \.offset) { _, review in
        Section("Program assignment") {
          AssignmentReviewCard(review: review, enabled: model.canControl) { approve in
            Task { await model.decideAssignment(review, approve: approve) }
          }
        }
      }
      Section("Execution") {
        LabeledContent("State", value: model.pod["lifecycle"].string ?? "Unknown")
        Button(
          model.pod["lifecycle"].string == "paused"
            ? "Resume automatic execution" : "Pause automatic execution"
        ) { Task { await model.setPaused(model.pod["lifecycle"].string != "paused") } }.disabled(
          !model.canControl)
      }
      ForEach(Array(model.conversation["proposals"].array.enumerated()), id: \.offset) {
        _, proposal in
        Section("Setup request") {
          Text(proposal["state"].string ?? "Pending")
          Text(proposal["body"]["description"].string ?? "Setup needed")
          if proposal["body"]["provider"].string == "variable",
            proposal["state"].string == "pending"
          {
            SetupAnswerCard(proposal: proposal, enabled: model.canControl) { value in
              Task { await model.answerSetup(proposal, value: value) }
            }
          } else {
            Text("Continue this permission request in the desktop Permissions tab.")
              .foregroundStyle(.secondary)
          }
        }
      }
    }
  }
  private func approvalURL(_ approval: JSONValue) -> URL? {
    guard let issuer = approval["issuer"].string, issuer == model.runtime?.owner.issuer,
      let grant = approval["grantId"].string,
      grant.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression) != nil,
      var url = URLComponents(string: issuer), url.scheme == "https", url.user == nil,
      url.password == nil
    else { return nil }
    url.path = "/grant-approval"
    url.queryItems = [URLQueryItem(name: "grant_id", value: grant)]
    return url.url
  }
}

private struct ChangeReviewCard: View {
  let review: JSONValue
  let enabled: Bool
  let decide: (Bool) -> Void
  @State private var confirming = false
  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      Label(
        review["kind"].string == "run" ? "Run review" : "Proposed changes",
        systemImage: "checkmark.shield"
      ).font(.headline)
      Text("State: \(review["state"].string ?? "Unknown")").font(.caption).foregroundStyle(
        .secondary)
      ForEach(Array(review["targets"].array.enumerated()), id: \.offset) { _, target in
        Text(target["name"].string ?? "Pod").font(.subheadline.bold())
        ForEach(Array(target["review"].array.enumerated()), id: \.offset) { _, change in
          Text(change["action"].string ?? "Change").font(.subheadline)
          DisclosureGroup("Before and after") {
            VStack(alignment: .leading, spacing: 8) {
              Text("Before").font(.caption.bold())
              Text(change["before"].string ?? "").font(.caption.monospaced())
                .textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
              Text("After").font(.caption.bold())
              Text(change["after"].string ?? "").font(.caption.monospaced())
                .textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityIdentifier("review.source.after")
            }
          }
        }
      }
      if let error = review["error"].string { Text(error).foregroundStyle(.orange) }
      if review["state"].string == "pending" {
        HStack {
          Button("Discard", role: .destructive) { decide(false) }
          Spacer()
          Button(review["kind"].string == "run" ? "Review run" : "Apply changes") {
            confirming = true
          }.buttonStyle(.borderedProminent)
        }.disabled(!enabled)
      }
    }.padding().background(Color.indigo.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
      .confirmationDialog(
        review["kind"].string == "run" ? "Start the reviewed run?" : "Apply these exact changes?",
        isPresented: $confirming, titleVisibility: .visible
      ) {
        Button(review["kind"].string == "run" ? "Start authorized run" : "Apply reviewed changes") {
          decide(true)
        }
      } message: {
        Text(
          "Concurrent edits invalidate this review. Existing execution and resource permissions remain authoritative."
        )
      }
  }
}

private struct SetupAnswerCard: View {
  let proposal: JSONValue
  let enabled: Bool
  let save: (String) -> Void
  @State private var value = ""
  @State private var confirming = false
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      TextField(proposal["body"]["alias"].string ?? "Configuration value", text: $value)
      Text(
        "Ordinary configuration is visible to the Pod assistant. Enter secrets only on the desktop."
      ).font(.caption).foregroundStyle(.secondary)
      Button("Review and save") { confirming = true }.disabled(
        !enabled || value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
          || value.count > 20000)
    }.confirmationDialog(
      "Save this configuration?", isPresented: $confirming, titleVisibility: .visible
    ) {
      Button("Save reviewed value") { save(value) }
    } message: {
      Text("\(proposal["body"]["alias"].string ?? "Value"): \(value)")
    }
  }
}

private struct AssignmentReviewCard: View {
  let review: JSONValue
  let enabled: Bool
  let decide: (Bool) -> Void
  @State private var confirming = false
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text(review["program"]["name"].string ?? "Program").font(.headline)
      Text(review["program"]["executable"].string ?? "").font(.caption.monospaced()).textSelection(
        .enabled)
      LabeledContent("State", value: review["state"].string ?? "Unknown")
      DisclosureGroup("Verify program hashes") {
        Text("Executable: \(review["program"]["executableHash"].string ?? "")").font(
          .caption.monospaced()
        ).textSelection(.enabled)
        Text("Descriptor: \(review["program"]["adapterHash"].string ?? "")").font(
          .caption.monospaced()
        ).textSelection(.enabled)
      }
      Text(
        "Network hosts: \(review["program"]["networkHosts"].array.compactMap(\.string).joined(separator: ", ").isEmpty ? "None" : review["program"]["networkHosts"].array.compactMap(\.string).joined(separator: ", "))"
      ).font(.caption)
      Text(
        "This assigns the offered program with empty private state. Execution still requires the applicable grant checks."
      ).font(.callout)
      if review["state"].string == "pending" {
        HStack {
          Button("Deny", role: .destructive) { decide(false) }
          Spacer()
          Button("Assign program") { confirming = true }.buttonStyle(.borderedProminent)
        }.disabled(!enabled)
      }
    }.confirmationDialog(
      "Assign this program to this Pod?", isPresented: $confirming, titleVisibility: .visible
    ) {
      Button("Assign reviewed program") { decide(true) }
    } message: {
      Text(review["program"]["name"].string ?? "Program")
    }
  }
}

extension JSONValue {
  fileprivate var recordID: String? { self["id"].string }
}
