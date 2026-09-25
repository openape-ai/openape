import AuthenticationServices
import Foundation
import Observation
import SwiftUI

@MainActor @Observable
final class PodsModel: NSObject, ASWebAuthenticationPresentationContextProviding {
  var signedIn = false
  var busy = false
  var error: String?
  var runtimes: [Registration] = []
  var devices: [Registration] = []
  var runtime: Registration?
  var pods: [JSONValue] = []
  var selectedPod: String?
  var conversation = JSONValue.null
  var runs = JSONValue.null
  var catalog = JSONValue.null
  var draft = ""
  var pairingCode: String?
  var paired = false
  var pending: [String] = []
  var lastUpdated: Date?
  var reviewConflict = false
  private var client: RelayClient?
  private var authentication: ASWebAuthenticationSession?
  private var serviceOrigin = URL(string: "https://pods.openape.ai")!
  private var fixtureAuthentication = false
  var pod: JSONValue { pods.first(where: { $0["id"].string == selectedPod }) ?? .null }
  var online: Bool { runtime?.online == true }
  var canControl: Bool { online && paired && !busy && pending.isEmpty }

  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
      .first(where: \.isKeyWindow) ?? ASPresentationAnchor()
  }
  func restore() async {
    guard client == nil else { return }
    await perform {
      let folder = try FileManager.default.url(
        for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
      #if DEBUG && targetEnvironment(simulator)
        if let value = ProcessInfo.processInfo.environment["PODS_ACCEPTANCE_ORIGIN"] {
          guard let origin = URL(string: value), origin.scheme == "https",
            origin.host == "127.0.0.1", origin.path.isEmpty, origin.query == nil,
            origin.fragment == nil, origin.user == nil, origin.password == nil
          else { throw PodsError.invalidEnvelope }
          serviceOrigin = origin
          fixtureAuthentication = true
        }
      #endif
      client = try RelayClient(
        origin: serviceOrigin,
        storage: ProtectedCache(url: folder.appendingPathComponent("viewed-pods.json")))
      signedIn = await client!.signedIn()
      if signedIn { try await loadRuntimes() }
    }
  }
  func login(email: String) async {
    await perform {
      guard let client else { return }
      let flow = try await client.beginLogin(email: email)
      let callback = try await withCheckedThrowingContinuation {
        (continuation: CheckedContinuation<URL, Error>) in
        let session = ASWebAuthenticationSession(
          url: flow.browserURL,
          callback: authenticationCallback
        ) { url, error in
          if let url {
            continuation.resume(returning: url)
          } else {
            continuation.resume(throwing: error ?? PodsError.invalidEnvelope)
          }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        authentication = session
        if !session.start() {
          continuation.resume(throwing: PodsError.service(500, "Could not open sign-in"))
        }
      }
      try await client.finishLogin(flow: flow, callback: normalizedCallback(callback))
      authentication = nil
      signedIn = true
      try await loadRuntimes()
    }
  }
  private var authenticationCallback: ASWebAuthenticationSession.Callback {
    #if DEBUG && targetEnvironment(simulator)
      if fixtureAuthentication { return .customScheme("openape-pods-acceptance") }
    #endif
    return .https(host: "pods.openape.ai", path: "/mobile-auth/return")
  }
  private func normalizedCallback(_ callback: URL) throws -> URL {
    #if DEBUG && targetEnvironment(simulator)
      if fixtureAuthentication {
        guard callback.scheme == "openape-pods-acceptance", callback.host == "callback",
          callback.path.isEmpty, callback.user == nil, callback.password == nil,
          callback.fragment == nil,
          var url = URLComponents(url: serviceOrigin, resolvingAgainstBaseURL: false)
        else { throw PodsError.invalidEnvelope }
        url.path = "/mobile-auth/return"
        url.percentEncodedQuery =
          URLComponents(url: callback, resolvingAgainstBaseURL: false)?
          .percentEncodedQuery
        guard let result = url.url else { throw PodsError.invalidEnvelope }
        return result
      }
    #endif
    return callback
  }
  private func loadRuntimes() async throws {
    guard let client else { return }
    runtimes = try await client.runtimes()
    if let id = runtime?.id {
      runtime = runtimes.first(where: { $0.id == id })
    } else {
      runtime = runtimes.first
    }
    if let runtime {
      paired = await client.isPaired(runtime)
      if !paired { clearPodSelection() }
      pairingCode = paired ? nil : try await client.pairingCode(runtime)
      let cache = await client.cached(
        RelayClient.viewKey(runtime: runtime.id, kind: "inventory", body: .object([:])))
      if !cache["pods"].array.isEmpty { pods = cache["pods"].array }
      if paired && online { try await inventory() }
    } else {
      clearPodSelection()
    }
    pending = await client.pendingOperations()
  }
  private func clearPodSelection() {
    pods = []
    selectedPod = nil
    conversation = .null
    runs = .null
    catalog = .null
    draft = ""
    paired = false
    pairingCode = nil
  }
  func loadDevices() async {
    await perform { devices = try await client?.devices() ?? [] }
  }
  func revoke(_ registration: Registration) async {
    await perform {
      try await client?.revoke(registration)
      if runtime?.id == registration.id {
        runtime = nil
        clearPodSelection()
      }
      try await loadRuntimes()
      devices = try await client?.devices() ?? []
    }
  }
  func selectRuntime(_ id: String) async {
    await perform {
      runtime = runtimes.first(where: { $0.id == id })
      pods = []
      selectedPod = nil
      try await loadRuntimes()
    }
  }
  func confirmPairing() async {
    await perform {
      guard let client, let runtime else { return }
      try await client.pair(runtime)
      paired = true
      pairingCode = nil
      try await inventory()
    }
  }
  private func inventory() async throws {
    guard let client, let runtime else { return }
    let response = try await client.send(
      runtime: runtime, kind: "inventory", body: .object([:]), query: true)
    pods = response["pods"].array
    lastUpdated = Date()
  }
  func refresh() async {
    guard !busy else { return }
    await perform {
      try await loadRuntimes()
      if selectedPod != nil && online && paired { try await loadDetail() }
    }
  }
  func selectPod(_ id: String?) async {
    await perform {
      if let previous = selectedPod { try await client?.saveDraft(previous, text: draft) }
      selectedPod = id
      conversation = .null
      runs = .null
      catalog = .null
      draft = if let id { await client?.draft(id) ?? "" } else { "" }
      if let id, let runtime, let client {
        let body = JSONValue.object([
          "podId": .string(id), "conversationId": .string(pod["conversationId"].string ?? ""),
        ])
        conversation = await client.cached(
          RelayClient.viewKey(runtime: runtime.id, kind: "conversation", body: body))
        runs = await client.cached(
          RelayClient.viewKey(
            runtime: runtime.id, kind: "run", body: .object(["podId": .string(id)])))
        if online { try await loadDetail() }
      }
    }
  }
  func saveDraft() async {
    guard let selectedPod else { return }
    do { try await client?.saveDraft(selectedPod, text: draft) } catch {
      self.error = error.localizedDescription
    }
  }
  private func loadDetail() async throws {
    guard let client, let runtime, let id = selectedPod,
      let conversationId = pod["conversationId"].string
    else { return }
    conversation = try await client.send(
      runtime: runtime, kind: "conversation",
      body: .object(["podId": .string(id), "conversationId": .string(conversationId)]), query: true)
    runs = try await client.send(
      runtime: runtime, kind: "run", body: .object(["podId": .string(id)]), query: true)
    if runtime.capabilities?.supports("catalog", query: true) == true {
      catalog = try await client.send(
        runtime: runtime, kind: "catalog", body: .object(["podId": .string(id)]), query: true)
    } else {
      catalog = .null
    }
    lastUpdated = Date()
  }
  func create(name: String) async {
    await perform {
      guard let client, let runtime else { return }
      let result = try await client.send(
        runtime: runtime, kind: "pod.create", body: .object(["name": .string(name)]))
      try await inventory()
      selectedPod = result["pod"]["id"].string
      draft = ""
      try await loadDetail()
    }
  }
  private func expected(review: Int? = nil) -> JSONValue {
    var value: [String: JSONValue] = ["podRevision": .number(Double(pod["revision"].integer ?? 0))]
    if let revision = conversation["conversation"]["revision"].integer {
      value["contextRevision"] = .number(Double(revision))
    }
    if let review { value["reviewRevision"] = .number(Double(review)) }
    return .object(value)
  }
  func sendChat() async {
    let message = draft
    await perform {
      guard let client, let runtime, let id = selectedPod,
        let conversationId = pod["conversationId"].string
      else { return }
      _ = try await client.send(
        runtime: runtime, kind: "chat.send",
        body: .object([
          "podId": .string(id), "conversationId": .string(conversationId), "text": .string(message),
          "expected": expected(),
        ]))
      draft = ""
      try await client.saveDraft(id, text: "")
      try await loadDetail()
    }
  }
  func decide(_ review: JSONValue, apply: Bool) async {
    await perform {
      guard let client, let runtime, let podId = selectedPod,
        let conversationId = pod["conversationId"].string, let id = review["id"].string,
        let revision = review["revision"].integer
      else { return }
      _ = try await client.send(
        runtime: runtime, kind: apply ? "changes.apply" : "changes.discard",
        body: .object([
          "podId": .string(podId), "conversationId": .string(conversationId),
          "reviewId": .string(id), "expected": expected(review: revision),
        ]))
      try await inventory()
      try await loadDetail()
    }
  }
  func prepareAssignment(_ item: JSONValue) async {
    await perform {
      guard let client, let runtime, let podId = selectedPod, let catalogId = item["id"].string
      else { return }
      _ = try await client.send(
        runtime: runtime, kind: "review.prepare",
        body: .object([
          "podId": .string(podId), "catalogId": .string(catalogId),
          "expected": .object([
            "podRevision": .number(Double(pod["revision"].integer ?? 0)),
            "resourceEpoch": .number(Double(catalog["resourceEpoch"].integer ?? 0)),
          ]),
        ]))
      try await loadDetail()
    }
  }
  func decideAssignment(_ review: JSONValue, approve: Bool) async {
    await perform {
      guard let client, let runtime, let podId = selectedPod, let reviewId = review["id"].string
      else { return }
      _ = try await client.send(
        runtime: runtime, kind: "review.decide",
        body: .object([
          "podId": .string(podId), "reviewId": .string(reviewId),
          "decision": .string(approve ? "approve" : "deny"),
          "expected": .object([
            "podRevision": .number(Double(review["podRevision"].integer ?? 0)),
            "reviewRevision": .number(Double(review["revision"].integer ?? 0)),
            "resourceEpoch": .number(Double(review["resourceEpoch"].integer ?? 0)),
          ]),
        ]))
      try await inventory()
      try await loadDetail()
    }
  }
  func answerSetup(_ proposal: JSONValue, value: String) async {
    await perform {
      guard let client, let runtime, let id = selectedPod,
        let conversationId = pod["conversationId"].string, let proposalId = proposal["id"].string,
        let hash = proposal["hash"].string, let revision = proposal["variableRevision"].integer
      else { return }
      let expected = JSONValue.object([
        "podRevision": .number(Double(pod["revision"].integer ?? 0)),
        "contextRevision": .number(Double(conversation["conversation"]["revision"].integer ?? 0)),
        "variableRevision": .number(Double(revision)), "proposalHash": .string(hash),
      ])
      _ = try await client.send(
        runtime: runtime, kind: "setup.respond",
        body: .object([
          "podId": .string(id), "conversationId": .string(conversationId),
          "reviewId": .string(proposalId),
          "text": .string(value), "expected": expected,
        ]))
      try await loadDetail()
    }
  }
  func runOnce() async {
    await perform {
      guard let client, let runtime, let id = selectedPod, let hash = pod["activeScript"].string
      else { return }
      let expected = JSONValue.object([
        "podRevision": .number(Double(pod["revision"].integer ?? 0)),
        "resourceEpoch": .number(Double(pod["resourceEpoch"].integer ?? 0)),
        "scriptHash": .string(hash),
      ])
      _ = try await client.send(
        runtime: runtime, kind: "run.start",
        body: .object(["podId": .string(id), "expected": expected]))
      try await loadDetail()
    }
  }
  func cancel(runId: String) async {
    await perform {
      guard let client, let runtime, let id = selectedPod else { return }
      _ = try await client.send(
        runtime: runtime, kind: "run.cancel",
        body: .object(["podId": .string(id), "runId": .string(runId), "expected": expected()]))
      try await loadDetail()
    }
  }
  func setPaused(_ paused: Bool) async {
    await perform {
      guard let client, let runtime, let id = selectedPod else { return }
      _ = try await client.send(
        runtime: runtime, kind: paused ? "pod.pause" : "pod.resume",
        body: .object(["podId": .string(id), "expected": expected()]))
      try await inventory()
    }
  }
  func retry(_ id: String) async {
    await perform {
      _ = try await client?.retry(id)
      try await inventory()
    }
  }
  func logout() async {
    var warning: String?
    await perform {
      warning = try await client?.signOut()
      client = nil
      signedIn = false
      pods = []
      runtime = nil
      selectedPod = nil
      conversation = .null
      runs = .null
      catalog = .null
      draft = ""
    }
    if !signedIn {
      await restore()
      if let warning { error = warning }
    }
  }
  private func perform(_ action: () async throws -> Void) async {
    guard !busy else { return }
    busy = true
    error = nil
    defer { busy = false }
    do {
      try await action()
    } catch PodsError.service(_, "revision_conflict") {
      // The desktop changed what the phone reviewed; show the current version instead of a failure.
      reviewConflict = true
      do {
        try await inventory()
        try await loadDetail()
      } catch {
        self.error = error.localizedDescription
      }
    } catch {
      self.error = error.localizedDescription
    }
    pending = await client?.pendingOperations() ?? []
  }
}
