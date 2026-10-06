import Foundation
import Testing

@testable import PodsCore

private struct Vector: Decodable {
  let sender: String
  let recipient: String
  let senderPublic: String
  let recipientPublic: String
  let envelope: Envelope
}
private func vector() throws -> Vector {
  let url = Bundle.module.url(
    forResource: "encrypted-v1", withExtension: "json", subdirectory: "Fixtures")!
  return try JSONDecoder().decode(Vector.self, from: Data(contentsOf: url))
}
@Test func opensTypeScriptEnvelope() throws {
  let fixture = try vector()
  let content = try ContentCrypto.open(
    fixture.envelope, agreement: fixture.recipient, signing: fixture.senderPublic)
  #expect(content["name"].string == "Synthetic Pod ✓")
}
@Test func rejectsDifferentSignerAndRecipient() throws {
  let fixture = try vector()
  let other = PrivateKeys.generate()
  #expect(throws: (any Error).self) {
    try ContentCrypto.open(
      fixture.envelope, agreement: other.agreement, signing: fixture.senderPublic)
  }
  #expect(throws: (any Error).self) {
    try ContentCrypto.open(
      fixture.envelope, agreement: fixture.recipient, signing: other.publicKeys().signing)
  }
}
@Test func swiftRoundTripAndExportedInteropVector() throws {
  let fixture = try vector()
  let content = JSONValue.object(["name": .string("Synthetic Pod ✓")])
  let sealed = try ContentCrypto.seal(
    route: fixture.envelope.route, body: content, recipient: fixture.recipientPublic,
    signing: fixture.sender)
  #expect(
    try ContentCrypto.open(sealed, agreement: fixture.recipient, signing: fixture.senderPublic)
      == content)
  if let output = ProcessInfo.processInfo.environment["PODS_VECTOR_OUTPUT"] {
    try JSONEncoder().encode(sealed).write(to: URL(fileURLWithPath: output), options: .atomic)
  }
}
@Test func rejectsUnknownVersionAndExpiredDelivery() throws {
  let fixture = try vector()
  #expect(throws: PodsError.expired) {
    try fixture.envelope.route.validate(now: Date(timeIntervalSince1970: 1_789_905_900))
  }
  var value =
    try JSONSerialization.jsonObject(with: JSONEncoder().encode(fixture.envelope.route))
    as! [String: Any]
  value["major"] = 2
  let route = try JSONDecoder().decode(
    Route.self, from: JSONSerialization.data(withJSONObject: value))
  #expect(throws: PodsError.invalidEnvelope) { try route.validate() }
}

@Test func assemblesLargeResponsesOnlyAfterCompleteDigestAndReceiptMatch() throws {
  let id = UUID().uuidString.lowercased()
  let receipt = JSONValue.object([
    "operationId": .string(id), "state": .string("completed"), "source": .string("desktop"),
  ])
  let result = JSONValue.object([
    "receipt": receipt,
    "data": .string(String(repeating: "Review this exact script. ", count: 1200)),
  ])
  let bytes = try JSONEncoder().encode(result)
  let count = Int(ceil(Double(bytes.count) / Double(24 * 1024)))
  let metadata = JSONValue.object([
    "operationId": .string(id), "count": .number(Double(count)),
    "digest": .string(ContentCrypto.digest(bytes)),
  ])
  var transfer = try ResponseTransfer(metadata: metadata)
  #expect(try transfer.append(.object(["transfer": metadata, "receipt": receipt])) == nil)
  for index in (0..<count).reversed() {
    let chunk = bytes.subdata(in: (index * 24 * 1024)..<min(bytes.count, (index + 1) * 24 * 1024))
    let message = JSONValue.object([
      "transfer": metadata, "index": .number(Double(index)), "chunk": .string(chunk.base64url),
    ])
    let complete = try transfer.append(message)
    #expect(complete == (index == 0 ? result : nil))
  }
  #expect(throws: PodsError.invalidEnvelope) {
    try transfer.append(
      .object([
        "transfer": metadata, "index": .number(0),
        "chunk": .string(Data("different".utf8).base64url),
      ]))
  }
}

@Test func continuedUseDoesNotExtendRetentionOfOldViewedContent() {
  let now = Date()
  var cache = CacheState()
  cache.viewed = ["old": .string("Old result"), "new": .string("New result")]
  cache.retainedAt = ["view:old": now.addingTimeInterval(-8 * 86400), "view:new": now]
  cache.updatedAt = now
  cache.expire(now: now)
  #expect(cache.viewed == ["new": .string("New result")])
}

@Test func runtimeRevocationRemovesItsViewedContentAndDrafts() {
  var cache = CacheState()
  let first = "runtime-a:inventory:::"
  let second = "runtime-b:inventory:::"
  cache.viewed = [
    first: .object(["pods": .array([.object(["id": .string("pod-a")])])]),
    second: .string("Other desktop"),
  ]
  cache.drafts = ["pod-a": "Private unsent draft", "pod-b": "Keep my other draft"]
  cache.retainedAt = [
    "view:" + first: Date(), "view:" + second: Date(), "draft:pod-a": Date(), "draft:pod-b": Date(),
  ]
  cache.forgetRuntime("runtime-a")
  #expect(cache.viewed == [second: .string("Other desktop")])
  #expect(cache.drafts == ["pod-b": "Keep my other draft"])
  #expect(cache.retainedAt["view:" + first] == nil)
}
