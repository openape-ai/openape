import Foundation
import Testing

@testable import PodsCore

/// Keeps device keys and session tokens in memory instead of the Keychain.
private final class MemorySecretStore: SecretStore, @unchecked Sendable {
  private let lock = NSLock()
  private var values: [String: Data] = [:]
  func load<T: Decodable>(_ type: T.Type, account: String) throws -> T? {
    lock.lock()
    defer { lock.unlock() }
    guard let data = values[account] else { return nil }
    return try JSONDecoder().decode(type, from: data)
  }
  func save<T: Encodable>(_ value: T, account: String) throws {
    lock.lock()
    defer { lock.unlock() }
    values[account] = try JSONEncoder().encode(value)
  }
  func remove(account: String) throws {
    lock.lock()
    defer { lock.unlock() }
    values.removeValue(forKey: account)
  }
}

/// Answers every request of the test session from the current handler; tests run serialized.
private final class StubRelay: URLProtocol {
  typealias Handler =
    @Sendable (_ method: String, _ path: String, _ body: Data) throws -> (
      Int, Data
    )
  nonisolated(unsafe) static var handler: Handler = { _, path, _ in
    throw PodsError.service(500, "unexpected request \(path)")
  }
  nonisolated(unsafe) static var requests: [String] = []
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    let url = request.url!
    let path = url.path + (url.query.map { "?" + $0 } ?? "")
    let method = request.httpMethod ?? "GET"
    Self.requests.append(method + " " + path)
    do {
      let (status, data) = try Self.handler(method, path, request.httpBody ?? Self.read(request))
      let response = HTTPURLResponse(
        url: url, statusCode: status, httpVersion: nil,
        headerFields: ["Content-Type": "application/json"])!
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: data)
      client?.urlProtocolDidFinishLoading(self)
    } catch {
      client?.urlProtocol(self, didFailWithError: error)
    }
  }
  override func stopLoading() {}
  private static func read(_ request: URLRequest) -> Data {
    guard let stream = request.httpBodyStream else { return Data() }
    stream.open()
    defer { stream.close() }
    var data = Data()
    var buffer = [UInt8](repeating: 0, count: 4096)
    while stream.hasBytesAvailable {
      let count = stream.read(&buffer, maxLength: buffer.count)
      if count <= 0 { break }
      data.append(buffer, count: count)
    }
    return data
  }
}

private final class Box<Value>: @unchecked Sendable {
  var value: Value
  init(_ value: Value) { self.value = value }
}

private func json(_ value: [String: Any]) -> Data {
  try! JSONSerialization.data(withJSONObject: value)
}

/// A signed-in device paired with one online desktop, backed by memory and a stubbed relay.
private struct Relay {
  let secrets = MemorySecretStore()
  let storage: ProtectedCache
  let device = PrivateKeys.generate()
  let runtimeKeys = PrivateKeys.generate()
  let owner = Owner(issuer: "https://id.example", subject: "owner@example.test")
  let runtime: Registration
  let registration: Registration
  init() throws {
    storage = ProtectedCache(
      url: FileManager.default.temporaryDirectory.appendingPathComponent(
        "pods-relay-\(UUID().uuidString)/viewed.json"))
    runtime = Registration(
      id: UUID().uuidString.lowercased(), owner: owner, kind: "runtime",
      keys: try runtimeKeys.publicKeys(), generation: UUID().uuidString.lowercased(), epoch: 1,
      online: true,
      capabilities: Capabilities(
        major: 1, minor: 0, commands: ["run.start"], queries: ["inventory", "operation"],
        contentModes: ["encrypted-v1"]), paired: true)
    registration = Registration(
      id: device.id, owner: owner, kind: "mobile", keys: try device.publicKeys(),
      generation: UUID().uuidString.lowercased(), epoch: 1)
    try secrets.save(device, account: "device")
    try secrets.save(
      Tokens(
        accessToken: "access", refreshToken: "refresh",
        expiresAt: Route.formatter.string(from: Date().addingTimeInterval(3600)),
        registration: registration), account: "session")
    StubRelay.requests = []
  }
  func client() throws -> RelayClient {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [StubRelay.self]
    return try RelayClient(
      origin: URL(string: "https://relay.test")!, storage: storage, secrets: secrets,
      configuration: configuration)
  }
  func runtimes(paired: Bool = true) throws -> Data {
    var listed = runtime
    listed.paired = paired
    return try JSONEncoder().encode([listed])
  }
  /// Seals a desktop response for the phone the way the real desktop does.
  func response(operationId: String, body: JSONValue, cursor: String) throws -> Data {
    let now = Date()
    let route = Route(
      protocol: "pods-mobile", major: 1, minor: 0, id: operationId, runtimeId: runtime.id,
      generation: runtime.generation, deviceId: registration.id, keyEpoch: 1, owner: owner,
      direction: "response", kind: "receipt", kindVersion: 1,
      issuedAt: Route.formatter.string(from: now),
      expiresAt: Route.formatter.string(from: now.addingTimeInterval(60)), sequence: "1")
    struct Event: Encodable {
      let cursor: String
      let envelope: Envelope
    }
    struct Page: Encodable { let events: [Event] }
    let envelope = try ContentCrypto.seal(
      route: route, body: body, recipient: registration.keys.agreement,
      signing: runtimeKeys.signing)
    return try JSONEncoder().encode(Page(events: [Event(cursor: cursor, envelope: envelope)]))
  }
}

@Suite(.serialized) struct RelayClientTests {
  @Test func resyncRequiredResetsTheCursorAndSurvivesReinitialization() async throws {
    let relay = try Relay()
    StubRelay.handler = { _, path, _ in
      switch path {
      case "/api/mobile/v1/events?cursor=0": return (410, json(["code": "resync_required"]))
      case "/api/mobile/v1/sync": return (200, json(["cursor": "42"]))
      case "/api/mobile/v1/events?cursor=42": return (200, json(["events": []]))
      default: throw PodsError.service(500, path)
      }
    }
    let client = try relay.client()
    await #expect(
      throws: PodsError.service(
        410, "Refresh desktop snapshots and reconcile pending operations after the replay gap.")
    ) { try await client.poll() }
    try await client.poll()
    #expect(StubRelay.requests.contains("GET /api/mobile/v1/events?cursor=42"))
    StubRelay.requests = []
    try await relay.client().poll()
    #expect(StubRelay.requests == ["GET /api/mobile/v1/events?cursor=42"])
  }

  @Test func pendingCommandsSurviveReinitializationAndBlockDuplicates() async throws {
    let relay = try Relay()
    StubRelay.handler = { _, _, _ in (503, json(["code": "relay_unavailable"])) }
    let client = try relay.client()
    try await client.pair(relay.runtime)
    await #expect(throws: PodsError.service(503, "relay_unavailable")) {
      try await client.send(runtime: relay.runtime, kind: "run.start", body: .object([:]))
    }
    let pending = await client.pendingOperations()
    #expect(pending.count == 1)
    let restarted = try relay.client()
    #expect(await restarted.pendingOperations() == pending)
    await #expect(throws: PodsError.pending(pending[0])) {
      try await restarted.send(runtime: relay.runtime, kind: "run.start", body: .object([:]))
    }
  }

  @Test func retryReturnsTheOriginalReceiptWithoutRepeatingTheCommand() async throws {
    let relay = try Relay()
    StubRelay.handler = { _, _, _ in (503, json(["code": "relay_unavailable"])) }
    let client = try relay.client()
    try await client.pair(relay.runtime)
    _ = try? await client.send(
      runtime: relay.runtime, kind: "run.start", body: .object(["podId": .string("pod-1")]))
    let id = try #require(await client.pendingOperations().first)
    let original = JSONValue.object([
      "receipt": .object([
        "operationId": .string(id), "state": .string("started"), "source": .string("desktop"),
        "runId": .string("run-1"),
      ]),
      "data": .object(["runId": .string("run-1")]),
    ])
    let query = Box<String?>(nil)
    StubRelay.handler = { method, path, body in
      switch (method, path) {
      case ("GET", "/api/mobile/v1/runtimes"): return (200, try relay.runtimes())
      case ("POST", "/api/mobile/v1/operations"):
        query.value = try JSONDecoder().decode(Envelope.self, from: body).route.id
        return (202, json([:]))
      case ("GET", "/api/mobile/v1/events?cursor=0"):
        guard let queryId = query.value else { return (200, json(["events": []])) }
        let body = JSONValue.object([
          "receipt": .object([
            "operationId": .string(queryId), "state": .string("completed"),
            "source": .string("desktop"),
          ]), "data": original,
        ])
        return (200, try relay.response(operationId: queryId, body: body, cursor: "7"))
      case ("POST", "/api/mobile/v1/events"): return (200, json([:]))
      default: throw PodsError.service(500, path)
      }
    }
    StubRelay.requests = []
    let result = try await client.retry(id)
    #expect(result == original["data"])
    #expect(await client.pendingOperations().isEmpty)
    // Only the status query went out; the original command was never re-sent.
    #expect(StubRelay.requests.filter { $0 == "POST /api/mobile/v1/operations" }.count == 1)
    #expect(query.value != nil && query.value != id)
    let again = try await client.retry(id)
    #expect(again == original["data"])
    #expect(StubRelay.requests.filter { $0 == "POST /api/mobile/v1/operations" }.count == 1)
  }

  @Test func relayReportedUnpairingDropsOnlyTheLocalPin() async throws {
    let relay = try Relay()
    StubRelay.handler = { _, _, _ in (200, try relay.runtimes(paired: false)) }
    let client = try relay.client()
    try await client.pair(relay.runtime)
    try await client.saveDraft("pod-1", text: "kept draft")
    _ = try await client.runtimes()
    #expect(await client.isPaired(relay.runtime) == false)
    #expect(await client.draft("pod-1") == "kept draft")
    let restarted = try relay.client()
    #expect(await restarted.isPaired(relay.runtime) == false)
  }

  @Test func pairingRequiredRefusalDropsThePinAndThePendingCommand() async throws {
    let relay = try Relay()
    StubRelay.handler = { _, _, _ in (403, json(["code": "pairing_required"])) }
    let client = try relay.client()
    try await client.pair(relay.runtime)
    await #expect(throws: PodsError.unpaired) {
      try await client.send(runtime: relay.runtime, kind: "run.start", body: .object([:]))
    }
    #expect(await client.isPaired(relay.runtime) == false)
    #expect(await client.pendingOperations().isEmpty)
  }
}
