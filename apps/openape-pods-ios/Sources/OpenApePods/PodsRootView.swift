import SwiftUI

struct PodsRootView: View {
  @Bindable var model: PodsModel
  @State private var email = ""
  @State private var compactColumn = NavigationSplitViewColumn.sidebar
  @State private var creating = false
  @State private var name = ""
  @State private var managingDevices = false
  @State private var revoking: Registration?
  @Environment(\.scenePhase) private var scenePhase
  var body: some View {
    Group {
      if model.signedIn { workspace } else { login }
    }
    .tint(.indigo)
    .alert(
      "OpenApe Pods",
      isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })
    ) {
      Button("OK") { model.error = nil }
    } message: {
      Text(model.error ?? "")
    }
    .onChange(of: scenePhase) { _, phase in
      Task {
        if phase == .active && model.signedIn { await model.refresh() }
        if phase != .active { await model.saveDraft() }
      }
    }
  }
  private var login: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 28) {
          Image(systemName: "square.stack.3d.up.fill").font(.system(size: 56)).foregroundStyle(
            .indigo
          ).accessibilityHidden(true)
          VStack(alignment: .leading, spacing: 12) {
            Text("Your Pods.\nWherever you are.").font(.largeTitle.bold())
            Text(
              "Create, chat and review results. Your desktop does the work and keeps your files and credentials."
            ).font(.title3).foregroundStyle(.secondary)
          }
          VStack(alignment: .leading, spacing: 14) {
            TextField("OpenApe email", text: $email).textContentType(.emailAddress).keyboardType(
              .emailAddress
            ).textInputAutocapitalization(.never).autocorrectionDisabled().textFieldStyle(
              .roundedBorder
            ).accessibilityIdentifier("login.email")
            Button {
              Task { await model.login(email: email) }
            } label: {
              HStack {
                Spacer()
                if model.busy { ProgressView() }
                Text("Continue with OpenApe")
                Spacer()
              }.padding(.vertical, 8)
            }.buttonStyle(.borderedProminent).disabled(model.busy || !email.contains("@"))
              .accessibilityIdentifier("login.continue")
          }
          Label("Pair once with your registered desktop", systemImage: "lock.shield")
            .foregroundStyle(.secondary)
          Text(
            "Your desktop must be online to create or run Pods. You can read previously viewed results offline."
          ).font(.footnote).foregroundStyle(.secondary)
        }.padding(28).frame(maxWidth: 560, alignment: .leading).frame(maxWidth: .infinity)
      }.navigationTitle("OpenApe Pods").navigationBarTitleDisplayMode(.inline)
    }
  }
  private var workspace: some View {
    NavigationSplitView(preferredCompactColumn: $compactColumn) {
      List {
        Section("Desktop") {
          if model.runtimes.isEmpty {
            Text("Register a desktop in OpenApe Pods → Mobile access.").foregroundStyle(.secondary)
          }
          ForEach(model.runtimes) { runtime in
            Button {
              Task { await model.selectRuntime(runtime.id) }
            } label: {
              HStack {
                Image(systemName: "desktopcomputer")
                VStack(alignment: .leading) {
                  Text(String(runtime.id.prefix(8)))
                  Text(runtime.online == true ? "Online" : "Offline").font(.caption)
                    .foregroundStyle(.secondary)
                }
                Spacer()
                if runtime.id == model.runtime?.id { Image(systemName: "checkmark") }
              }
            }
          }
        }
        if let code = model.pairingCode {
          Section("Pair this device") {
            Text(code).font(.title2.monospaced().bold()).textSelection(.enabled)
            Text(
              "On your desktop, open Mobile access → Pair mobile device. Confirm this exact code on both devices."
            ).font(.callout)
            Button("Codes match — trust desktop") { Task { await model.confirmPairing() } }
              .disabled(model.busy)
          }
        }
        Section("Pods") {
          ForEach(Array(model.pods.enumerated()), id: \.offset) { _, pod in
            Button {
              Task {
                await model.selectPod(pod["id"].string)
                compactColumn = .detail
              }
            } label: {
              VStack(alignment: .leading, spacing: 5) {
                Text(pod["name"].string ?? "Pod").font(.headline)
                Text(pod["lifecycle"].string ?? "").font(.caption).foregroundStyle(.secondary)
              }.padding(.vertical, 4)
            }.accessibilityIdentifier("pod.row")
          }
          Button {
            creating = true
          } label: {
            Label("New Pod", systemImage: "plus")
          }.disabled(!model.canControl).accessibilityIdentifier("pod.create")
        }
        if !model.pending.isEmpty {
          Section("Awaiting confirmation") {
            ForEach(model.pending, id: \.self) { id in
              Button("Check \(id.prefix(8))") { Task { await model.retry(id) } }.disabled(
                model.busy)
            }
            Text(
              "An acknowledgement does not mean execution completed. Keep the original operation when reconnecting."
            ).font(.caption)
          }
        }
      }
      .navigationTitle("Pods")
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button {
            Task { await model.refresh() }
          } label: {
            Image(systemName: "arrow.clockwise")
          }.disabled(model.busy).accessibilityLabel("Refresh Pods")
        }
        ToolbarItem(placement: .bottomBar) {
          HStack {
            Button("Devices") { managingDevices = true }.disabled(model.busy)
            Spacer()
            Button("Sign out") { Task { await model.logout() } }.disabled(model.busy)
          }
        }
      }
      .refreshable { await model.refresh() }
    } detail: {
      if model.selectedPod != nil {
        PodDetailView(model: model)
      } else {
        ContentUnavailableView(
          "Choose a Pod", systemImage: "square.stack.3d.up",
          description: Text(
            "Your desktop remains the execution runtime. Select a Pod or create one on an online desktop."
          ))
      }
    }
    .sheet(isPresented: $managingDevices) {
      NavigationStack {
        List {
          Section("Desktops") {
            ForEach(model.runtimes) { registration in deviceRow(registration) }
          }
          Section("Other mobile devices") {
            ForEach(model.devices) { registration in deviceRow(registration) }
            if model.devices.isEmpty {
              Text("No other registered devices").foregroundStyle(.secondary)
            }
          }
          Section {
            Text(
              "Revoking access blocks new remote commands. Authorized runs already started continue. Use Sign out to remove this device."
            )
          }
        }.navigationTitle("Device access")
          .task { await model.loadDevices() }
          .toolbar {
            ToolbarItem(placement: .confirmationAction) {
              Button("Done") { managingDevices = false }
            }
          }
          .confirmationDialog(
            "Revoke this device?",
            isPresented: Binding(get: { revoking != nil }, set: { if !$0 { revoking = nil } }),
            titleVisibility: .visible
          ) {
            if let registration = revoking {
              Button("Revoke access", role: .destructive) {
                Task {
                  await model.revoke(registration)
                  revoking = nil
                }
              }
            }
          } message: {
            Text("The device must register and pair again before accessing Pods.")
          }
      }
    }
    .sheet(isPresented: $creating) {
      NavigationStack {
        Form {
          TextField("Pod name", text: $name)
          Text("The new Pod starts paused. Setup and permission reviews continue in chat.")
            .foregroundStyle(.secondary)
        }.navigationTitle("New Pod").toolbar {
          ToolbarItem(placement: .cancellationAction) { Button("Cancel") { creating = false } }
          ToolbarItem(placement: .confirmationAction) {
            Button("Create") {
              creating = false
              Task {
                await model.create(name: name)
                if model.selectedPod != nil { compactColumn = .detail }
                name = ""
              }
            }.disabled(
              name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || name.count > 100
                || !model.canControl)
          }
        }
      }
    }
  }
  private func deviceRow(_ registration: Registration) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(registration.id).font(.caption.monospaced()).textSelection(.enabled)
      Button("Revoke access", role: .destructive) { revoking = registration }.disabled(model.busy)
    }
  }
}
