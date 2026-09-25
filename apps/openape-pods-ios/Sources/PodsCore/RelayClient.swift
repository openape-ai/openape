import Foundation

public struct LoginFlow: Sendable {
  public let id: String
  public let browserURL: URL
  let verifier: String
}
private final class RedirectRejector: NSObject, URLSessionTaskDelegate, Sendable {
  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping @Sendable (URLRequest?) -> Void
  ) { completionHandler(nil) }
}
public actor RelayClient {
  public let origin: URL
  private let keys: PrivateKeys
  private var tokens: Tokens?
  private let storage: ProtectedCache
  private var cache: CacheState
  private let session: URLSession
  private var refreshing = false
  private var polling = false
  public init(origin: URL = URL(string: "https://pods.openape.ai")!, storage: ProtectedCache) throws
  {
    guard origin.scheme == "https", origin.path.isEmpty, origin.user == nil, origin.password == nil
    else { throw PodsError.invalidEnvelope }
    self.origin = origin
    self.storage = storage
    if let saved = try KeychainStore.load(PrivateKeys.self, account: "device") {
      keys = saved
    } else {
      let generated = PrivateKeys.generate()
      try KeychainStore.save(generated, account: "device")
      keys = generated
    }
    tokens = try KeychainStore.load(Tokens.self, account: "session")
    cache = try storage.load()
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = 15
    configuration.httpCookieStorage = nil
    configuration.urlCache = nil
    session = URLSession(
      configuration: configuration, delegate: RedirectRejector(), delegateQueue: nil)
  }
  public func signedIn() -> Bool { tokens != nil }
  public func cached(_ key: String) -> JSONValue {
    cache.expire()
    return cache.viewed[key] ?? .null
  }
  public func draft(_ id: String) -> String {
    cache.expire()
    return cache.drafts[id] ?? ""
  }
  public func saveDraft(_ id: String, text: String) throws {
    guard text.utf8.count <= 32000 else { throw PodsError.storage("The draft is too long.") }
    cache.drafts[id] = text
    cache.retainedAt["draft:" + id] = Date()
    cache.updatedAt = Date()
    try storage.save(cache)
  }
  private func request(
    _ path: String, method: String = "GET", body: Data? = nil, authenticated: Bool = true
  ) async throws -> Data {
    guard path.hasPrefix("/api/mobile/v1/") else { throw PodsError.invalidEnvelope }
    if authenticated { try await refreshIfNeeded() }
    var request = URLRequest(url: URL(string: path, relativeTo: origin)!)
    request.httpMethod = method
    request.httpBody = body
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    if authenticated {
      guard let tokens else { throw PodsError.service(401, "Sign in again") }
      request.setValue("Bearer \(tokens.accessToken)", forHTTPHeaderField: "Authorization")
      let requestId = UUID().uuidString.lowercased()
      let at = Route.formatter.string(from: Date())
      let digest = ContentCrypto.digest(String(data: body ?? Data(), encoding: .utf8) ?? "")
      let tuple = [method, path, ContentCrypto.digest(tokens.accessToken), at, digest]
      let nonce = String(
        data: try JSONSerialization.data(withJSONObject: tuple, options: [.withoutEscapingSlashes]),
        encoding: .utf8)!
      request.setValue(requestId, forHTTPHeaderField: "X-Pods-Request-Id")
      request.setValue(at, forHTTPHeaderField: "X-Pods-Request-At")
      request.setValue(digest, forHTTPHeaderField: "X-Pods-Body-Digest")
      request.setValue(
        try ContentCrypto.proof(
          purpose: "api-request", id: requestId, nonce: nonce, signing: keys.signing),
        forHTTPHeaderField: "X-Pods-Proof")
    }
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse, data.count <= 8 * 1024 * 1024 else {
      throw PodsError.invalidEnvelope
    }
    guard (200..<300).contains(http.statusCode) else {
      let problem = try? JSONDecoder().decode(JSONValue.self, from: data)
      throw PodsError.service(
        http.statusCode,
        problem?["code"].string ?? problem?["data"]["code"].string ?? problem?["statusMessage"]
          .string ?? "The service could not complete this request")
    }
    return data
  }
  private func refreshIfNeeded() async throws {
    guard let tokens, let expires = Route.formatter.date(from: tokens.expiresAt),
      expires < Date().addingTimeInterval(30)
    else { return }
    if refreshing {
      throw PodsError.service(409, "Session refresh in progress. Try again shortly.")
    }
    refreshing = true
    defer { refreshing = false }
    let data = try await request(
      "/api/mobile/v1/session/refresh", method: "POST",
      body: JSONEncoder().encode([
        "refreshToken": tokens.refreshToken,
        "signature": try ContentCrypto.proof(
          purpose: "session-refresh", id: keys.id, nonce: ContentCrypto.digest(tokens.refreshToken),
          signing: keys.signing),
      ]), authenticated: false)
    let renewed = try JSONDecoder().decode(Tokens.self, from: data)
    guard renewed.registration == tokens.registration else { throw PodsError.invalidEnvelope }
    try KeychainStore.save(renewed, account: "session")
    self.tokens = renewed
  }
  public func beginLogin(email: String) async throws -> LoginFlow {
    let service = try JSONDecoder().decode(
      Capabilities.self, from: await request("/api/mobile/v1/capabilities", authenticated: false))
    guard service.supports("inventory", query: true) else {
      throw PodsError.service(426, "Update OpenApe Pods to use this service.")
    }
    struct Begin: Encodable {
      let deviceId: String
      let kind = "mobile"
      let keys: DeviceKeys
      let challenge: String
      let email: String
    }
    struct Reply: Decodable {
      let id: String
      let browserUrl: URL
    }
    let verifier = ContentCrypto.verifier()
    let reply = try JSONDecoder().decode(
      Reply.self,
      from: await request(
        "/api/mobile/v1/session/begin", method: "POST",
        body: JSONEncoder().encode(
          Begin(
            deviceId: keys.id, keys: keys.publicKeys(),
            challenge: ContentCrypto.challenge(verifier), email: email)), authenticated: false))
    guard reply.browserUrl.scheme == origin.scheme, reply.browserUrl.host == origin.host,
      reply.browserUrl.port == origin.port, reply.browserUrl.user == nil,
      reply.browserUrl.password == nil,
      reply.browserUrl.path == "/mobile-auth/start"
    else { throw PodsError.invalidEnvelope }
    return LoginFlow(id: reply.id, browserURL: reply.browserUrl, verifier: verifier)
  }
  public func finishLogin(flow: LoginFlow, callback: URL) async throws {
    let values = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
    guard callback.scheme == origin.scheme, callback.host == origin.host,
      callback.port == origin.port, callback.user == nil, callback.password == nil,
      callback.path == "/mobile-auth/return",
      values.filter({ $0.name == "state" }).count == 1,
      values.first(where: { $0.name == "state" })?.value == flow.id,
      values.filter({ $0.name == "code" }).count == 1,
      let code = values.first(where: { $0.name == "code" })?.value
    else { throw PodsError.invalidEnvelope }
    let proof = try ContentCrypto.proof(
      purpose: "session-exchange", id: flow.id, nonce: ContentCrypto.challenge(flow.verifier),
      signing: keys.signing)
    let response = try await request(
      "/api/mobile/v1/session/exchange", method: "POST",
      body: JSONEncoder().encode([
        "id": flow.id, "code": code, "verifier": flow.verifier, "signature": proof,
      ]), authenticated: false)
    let received = try JSONDecoder().decode(Tokens.self, from: response)
    guard received.registration.id == keys.id,
      received.registration.keys == (try keys.publicKeys()), received.registration.kind == "mobile"
    else { throw PodsError.invalidEnvelope }
    try KeychainStore.save(received, account: "session")
    tokens = received
  }
  public func runtimes() async throws -> [Registration] {
    do {
      let runtimes = try JSONDecoder().decode(
        [Registration].self, from: await request("/api/mobile/v1/runtimes"))
      for pinned in cache.paired.values {
        if !runtimes.contains(where: {
          $0.id == pinned.id && $0.generation == pinned.generation && $0.keys == pinned.keys
            && $0.owner == pinned.owner
        }) {
          cache.forgetRuntime(pinned.id)
        }
      }
      try storage.save(cache)
      return runtimes
    } catch is URLError {
      return cache.paired.values.map {
        var offline = $0
        offline.online = false
        return offline
      }
    }
  }
  public func devices() async throws -> [Registration] {
    try JSONDecoder().decode([Registration].self, from: await request("/api/mobile/v1/devices"))
      .filter { $0.id != tokens?.registration.id }
  }
  public func revoke(_ registration: Registration) async throws {
    guard registration.owner == tokens?.registration.owner,
      ["mobile", "runtime"].contains(registration.kind), UUID(uuidString: registration.id) != nil
    else { throw PodsError.unpaired }
    let collection = registration.kind == "runtime" ? "runtimes" : "devices"
    _ = try await request("/api/mobile/v1/\(collection)/\(registration.id)", method: "DELETE")
    if registration.kind == "runtime" {
      cache.forgetRuntime(registration.id)
      try storage.save(cache)
    }
  }
  public func pairingCode(_ runtime: Registration) throws -> String {
    guard let device = tokens?.registration, runtime.owner == device.owner else {
      throw PodsError.unpaired
    }
    return try ContentCrypto.pairingCode(runtime: runtime, device: device)
  }
  public func pair(_ runtime: Registration) throws {
    guard runtime.owner == tokens?.registration.owner else { throw PodsError.unpaired }
    cache.paired[runtime.id] = runtime
    try storage.save(cache)
  }
  public func forgetPairing(_ runtimeId: String) throws {
    cache.paired.removeValue(forKey: runtimeId)
    try storage.save(cache)
  }
  public func isPaired(_ runtime: Registration) -> Bool {
    guard let pinned = cache.paired[runtime.id] else { return false }
    return pinned.keys == runtime.keys && pinned.generation == runtime.generation
      && pinned.owner == runtime.owner
  }
  public func send(runtime: Registration, kind: String, body: JSONValue, query: Bool = false)
    async throws -> JSONValue
  {
    guard runtime.online == true else { throw PodsError.offline }
    guard runtime.capabilities?.supports(kind, query: query) == true else {
      throw PodsError.service(426, "Update the desktop application to use this operation.")
    }
    guard isPaired(runtime), let device = tokens?.registration else { throw PodsError.unpaired }
    if !query,
      let pending = cache.pending.values.first(where: {
        $0.route.runtimeId == runtime.id && $0.route.direction == "command"
      })
    {
      throw PodsError.pending(pending.route.id)
    }
    let route = Route.request(runtime: runtime, device: device, kind: kind, query: query)
    let envelope = try ContentCrypto.seal(
      route: route, body: body, recipient: runtime.keys.agreement, signing: keys.signing)
    guard cache.pending.count < 100 else {
      throw PodsError.storage("Reconcile pending operations before continuing.")
    }
    cache.pending[route.id] = envelope
    if query {
      cache.pendingViews[route.id] = Self.viewKey(runtime: runtime.id, kind: kind, body: body)
    }
    try storage.save(cache)
    do { return try await transmit(envelope) } catch {
      if query {
        cache.pending.removeValue(forKey: route.id)
        cache.pendingViews.removeValue(forKey: route.id)
        try storage.save(cache)
      }
      throw error
    }
  }
  public static func viewKey(runtime: String, kind: String, body: JSONValue) -> String {
    [
      runtime, kind, body["podId"].string ?? "", body["conversationId"].string ?? "",
      body["runId"].string ?? "",
    ].joined(separator: ":")
  }
  private func outcome(_ id: String) throws -> JSONValue? {
    guard let result = cache.responses[id] else { return nil }
    if result["receipt"]["state"].string == "failed" {
      throw PodsError.service(409, result["data"]["code"].string ?? "Desktop operation failed")
    }
    if result["unavailable"].string != nil {
      throw PodsError.service(
        413,
        "This result is too large for mobile. Inspect it on the desktop; the operation will not be repeated."
      )
    }
    return result["data"]
  }
  public func retry(_ id: String) async throws -> JSONValue {
    guard let envelope = cache.pending[id] else {
      if let result = try outcome(id) { return result }
      throw PodsError.service(404, "Pending operation not found")
    }
    try await poll()
    if let result = try outcome(id) { return result }
    guard let runtime = try await runtimes().first(where: { $0.id == envelope.route.runtimeId })
    else { throw PodsError.offline }
    do {
      let result = try await send(
        runtime: runtime, kind: "operation", body: .object(["operationId": .string(id)]),
        query: true)
      guard result["receipt"]["operationId"].string == id else { throw PodsError.invalidEnvelope }
      try retain(result, operationId: id)
      if let value = try outcome(id) { return value }
      throw PodsError.pending(id)
    } catch PodsError.service(409, "not_found") {
      if let expiry = Route.formatter.date(from: envelope.route.expiresAt), expiry <= Date() {
        cache.pending.removeValue(forKey: id)
        try storage.save(cache)
        throw PodsError.service(
          410,
          "The desktop did not receive this expired operation. Review its current state before starting a new action."
        )
      }
      return try await transmit(envelope)
    }
  }
  private func retain(_ result: JSONValue, operationId: String) throws {
    guard
      ["applied", "started", "completed", "failed"].contains(
        result["receipt"]["state"].string ?? "")
    else { return }
    cache.responses[operationId] = result
    cache.retainedAt["response:" + operationId] = Date()
    if cache.pending.removeValue(forKey: operationId) != nil,
      let view = cache.pendingViews.removeValue(forKey: operationId),
      result["receipt"]["state"].string != "failed"
    {
      cache.viewed[view] = result["data"]
      cache.retainedAt["view:" + view] = Date()
    }
    try storage.save(cache)
  }
  private func transmit(_ envelope: Envelope) async throws -> JSONValue {
    do {
      _ = try await request(
        "/api/mobile/v1/operations", method: "POST", body: JSONEncoder().encode(envelope))
    } catch PodsError.service(let status, let code) {
      if [
        "runtime_offline", "runtime_queue_full", "operation_expired", "clock_skew",
        "pairing_required", "unsupported_operation", "unsupported_version",
      ].contains(code) {
        cache.pending.removeValue(forKey: envelope.route.id)
        cache.pendingViews.removeValue(forKey: envelope.route.id)
        // The desktop removed this pairing; forget the local pin so the next
        // refresh shows pairing instead of an apparently usable runtime.
        if code == "pairing_required" {
          cache.paired.removeValue(forKey: envelope.route.runtimeId)
          try storage.save(cache)
          throw PodsError.unpaired
        }
        try storage.save(cache)
      }
      throw PodsError.service(status, code)
    }
    for _ in 0..<30 {
      try await poll()
      if let result = try outcome(envelope.route.id) { return result }
      try await Task.sleep(for: .seconds(1))
    }
    throw PodsError.pending(envelope.route.id)
  }
  public func poll() async throws {
    guard !polling else { return }
    polling = true
    defer { polling = false }
    struct Page: Decodable { let events: [Event] }
    struct Event: Decodable {
      let cursor: String
      let envelope: Envelope
    }
    let page: Page
    do {
      page = try JSONDecoder().decode(
        Page.self, from: await request("/api/mobile/v1/events?cursor=\(cache.cursor)"))
    } catch PodsError.service(410, "resync_required") {
      struct Sync: Decodable { let cursor: String }
      let sync = try JSONDecoder().decode(Sync.self, from: await request("/api/mobile/v1/sync"))
      guard sync.cursor.range(of: "^(0|[1-9][0-9]{0,18})$", options: .regularExpression) != nil
      else { throw PodsError.invalidEnvelope }
      cache.cursor = sync.cursor
      cache.viewed = [:]
      try storage.save(cache)
      throw PodsError.service(
        410, "Refresh desktop snapshots and reconcile pending operations after the replay gap.")
    }
    for event in page.events {
      guard let runtime = cache.paired[event.envelope.route.runtimeId],
        let device = tokens?.registration,
        event.envelope.route.generation == runtime.generation,
        event.envelope.route.owner == device.owner,
        event.envelope.route.deviceId == device.id, event.envelope.route.keyEpoch == device.epoch,
        ["response", "event"].contains(event.envelope.route.direction)
      else { throw PodsError.invalidEnvelope }
      let result = try ContentCrypto.open(
        event.envelope, agreement: keys.agreement, signing: runtime.keys.signing)
      try event.envelope.route.validate(now: Date())
      if result["transfer"] != .null {
        let metadata = result["transfer"]
        let key = runtime.id + ":" + (metadata["operationId"].string ?? "")
        var transfer = try cache.transfers[key] ?? ResponseTransfer(metadata: metadata)
        if event.envelope.route.direction == "response" {
          guard event.envelope.route.id == transfer.operationId,
            result["receipt"]["source"].string == "desktop"
          else { throw PodsError.invalidEnvelope }
        } else {
          guard result["chunk"].string != nil else { throw PodsError.invalidEnvelope }
        }
        if let complete = try transfer.append(result) {
          try retain(complete, operationId: transfer.operationId)
          cache.transfers.removeValue(forKey: key)
        } else {
          cache.transfers[key] = transfer
        }
      } else {
        guard let operationId = result["receipt"]["operationId"].string,
          operationId == event.envelope.route.id,
          result["receipt"]["source"].string == "desktop"
        else { throw PodsError.invalidEnvelope }
        try retain(result, operationId: operationId)
      }
      cache.cursor = event.cursor
      cache.updatedAt = Date()
      try storage.save(cache)
    }
    if !page.events.isEmpty {
      _ = try await request(
        "/api/mobile/v1/events", method: "POST",
        body: JSONEncoder().encode(["cursor": cache.cursor]))
    }
  }
  public func pendingOperations() -> [String] { Array(cache.pending.keys).sorted() }
  public func signOut() async throws -> String? {
    var warning: String?
    do {
      _ = try await request("/api/mobile/v1/session/revoke", method: "POST", body: Data("{}".utf8))
    } catch {
      warning =
        "Signed out on this device. Remote revocation could not be confirmed: \(error.localizedDescription). Disable mobile access on your desktop to stop further remote access immediately."
    }
    try KeychainStore.remove(account: "session")
    try KeychainStore.remove(account: "device")
    try storage.remove()
    tokens = nil
    cache = CacheState()
    return warning
  }
}
