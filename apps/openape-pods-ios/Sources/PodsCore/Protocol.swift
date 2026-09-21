import Foundation

public struct Owner: Codable, Equatable, Sendable {
  public let issuer: String
  public let subject: String
}
public struct DeviceKeys: Codable, Equatable, Sendable {
  public let signing: String
  public let agreement: String
}
public struct Capabilities: Codable, Equatable, Sendable {
  public let major: Int
  public let minor: Int
  public let commands: [String]
  public let queries: [String]
  public let contentModes: [String]
  public func supports(_ kind: String, query: Bool) -> Bool {
    major == 1 && minor >= 0 && contentModes.contains("encrypted-v1")
      && (query ? queries : commands).contains(kind)
  }
}
public struct Registration: Codable, Identifiable, Equatable, Sendable {
  public let id: String
  public let owner: Owner
  public let kind: String
  public let keys: DeviceKeys
  public let generation: String
  public let epoch: Int
  public var online: Bool?
  public var capabilities: Capabilities?
  public var paired: Bool?
}
public struct Route: Codable, Sendable {
  public let `protocol`: String
  public let major: Int
  public let minor: Int
  public let id: String
  public let runtimeId: String
  public let generation: String
  public let deviceId: String
  public let keyEpoch: Int
  public let owner: Owner
  public let direction: String
  public let kind: String
  public let kindVersion: Int
  public let issuedAt: String
  public let expiresAt: String
  public let sequence: String

  public func associatedData() throws -> Data {
    let tuple: [Any] = [
      `protocol`, major, minor, id, runtimeId, generation, deviceId, keyEpoch, owner.issuer,
      owner.subject, direction, kind, kindVersion, issuedAt, expiresAt, sequence,
    ]
    return try JSONSerialization.data(withJSONObject: tuple, options: [.withoutEscapingSlashes])
  }
  public func validate(now: Date? = nil) throws {
    guard `protocol` == "pods-mobile", major == 1, kindVersion == 1, minor >= 0,
      [id, runtimeId, generation, deviceId].allSatisfy({
        UUID(uuidString: $0) != nil && $0 == $0.lowercased()
      }),
      keyEpoch > 0, ["command", "query", "response", "event"].contains(direction),
      sequence.range(of: "^(0|[1-9][0-9]{0,18})$", options: .regularExpression) != nil,
      let issued = Self.formatter.date(from: issuedAt),
      let expires = Self.formatter.date(from: expiresAt), expires > issued
    else { throw PodsError.invalidEnvelope }
    if let now, expires <= now || issued > now.addingTimeInterval(30) { throw PodsError.expired }
  }
  public static var formatter: ISO8601DateFormatter {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }
  public static func request(
    runtime: Registration, device: Registration, kind: String, query: Bool, id: UUID = UUID(),
    now: Date = Date()
  ) -> Route {
    let duration: TimeInterval = query || ["pod.create", "chat.send"].contains(kind) ? 300 : 60
    return Route(
      protocol: "pods-mobile", major: 1, minor: 0, id: id.uuidString.lowercased(),
      runtimeId: runtime.id, generation: runtime.generation, deviceId: device.id,
      keyEpoch: device.epoch, owner: device.owner, direction: query ? "query" : "command",
      kind: kind, kindVersion: 1, issuedAt: formatter.string(from: now),
      expiresAt: formatter.string(from: now.addingTimeInterval(duration)), sequence: "0")
  }
}
public struct Envelope: Codable, Sendable {
  public let route: Route
  public let contentMode: String
  public let ephemeralKey: String
  public let nonce: String
  public let ciphertext: String
  public let signature: String
}
public struct Tokens: Codable, Sendable {
  public let accessToken: String
  public let refreshToken: String
  public let expiresAt: String
  public let registration: Registration
}
public enum JSONValue: Codable, Equatable, Sendable {
  case object([String: JSONValue])
  case array([JSONValue])
  case string(String)
  case number(Double)
  case bool(Bool)
  case null
  public init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    if container.decodeNil() {
      self = .null
    } else if let value = try? container.decode(Bool.self) {
      self = .bool(value)
    } else if let value = try? container.decode(String.self) {
      self = .string(value)
    } else if let value = try? container.decode(Double.self) {
      self = .number(value)
    } else if let value = try? container.decode([String: JSONValue].self) {
      self = .object(value)
    } else {
      self = .array(try container.decode([JSONValue].self))
    }
  }
  public func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .object(let value): try container.encode(value)
    case .array(let value): try container.encode(value)
    case .string(let value): try container.encode(value)
    case .number(let value): try container.encode(value)
    case .bool(let value): try container.encode(value)
    case .null: try container.encodeNil()
    }
  }
  public subscript(_ key: String) -> JSONValue {
    if case .object(let value) = self { return value[key] ?? .null }
    return .null
  }
  public var string: String? {
    if case .string(let value) = self { return value }
    return nil
  }
  public var integer: Int? {
    if case .number(let value) = self, value.isFinite, value.rounded() == value,
      value >= Double(Int.min), value < Double(Int.max)
    {
      return Int(value)
    }
    return nil
  }
  public var array: [JSONValue] {
    if case .array(let value) = self { return value }
    return []
  }
  public func decoded<T: Decodable>(_ type: T.Type) throws -> T {
    try JSONDecoder().decode(type, from: JSONEncoder().encode(self))
  }
}
public enum PodsError: Error, LocalizedError, Equatable, Sendable {
  case invalidEnvelope, expired, unpaired, offline
  case pending(String)
  case service(Int, String)
  case storage(String)
  public var errorDescription: String? {
    switch self {
    case .invalidEnvelope: "The message could not be authenticated."
    case .expired: "The request expired. Refresh its status before trying again."
    case .unpaired: "Compare the code and pair this device on your desktop first."
    case .offline: "The desktop is offline. Your draft stays on this device."
    case .pending(let id): "The outcome is still pending. Operation: \(id)"
    case .service(let code, let message): "\(message) (\(code))"
    case .storage(let message): message
    }
  }
}

public struct ResponseTransfer: Codable, Sendable {
  public let operationId: String
  public let digest: String
  public let count: Int
  public var chunks: [Int: String] = [:]
  public var receipt: JSONValue = .null
  public let createdAt: Date
  public init(metadata: JSONValue, now: Date = Date()) throws {
    guard let id = metadata["operationId"].string, UUID(uuidString: id) != nil,
      let digest = metadata["digest"].string,
      digest.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
      let count = metadata["count"].integer, (1...86).contains(count)
    else { throw PodsError.invalidEnvelope }
    self.operationId = id
    self.digest = digest
    self.count = count
    self.createdAt = now
  }
  public mutating func append(_ body: JSONValue) throws -> JSONValue? {
    let metadata = body["transfer"]
    guard metadata["operationId"].string == operationId, metadata["digest"].string == digest,
      metadata["count"].integer == count
    else { throw PodsError.invalidEnvelope }
    if let chunk = body["chunk"].string {
      guard let index = body["index"].integer, (0..<count).contains(index),
        try Data(base64url: chunk).count <= 24 * 1024,
        chunks[index] == nil || chunks[index] == chunk
      else { throw PodsError.invalidEnvelope }
      chunks[index] = chunk
    } else {
      guard body["receipt"]["operationId"].string == operationId else {
        throw PodsError.invalidEnvelope
      }
      receipt = body["receipt"]
    }
    guard chunks.count == count, receipt != .null else { return nil }
    var data = Data()
    for index in 0..<count { data.append(try Data(base64url: chunks[index]!)) }
    guard data.count <= 2 * 1024 * 1024, ContentCrypto.digest(data) == digest else {
      throw PodsError.invalidEnvelope
    }
    let result = try JSONDecoder().decode(JSONValue.self, from: data)
    guard result["receipt"] == receipt else { throw PodsError.invalidEnvelope }
    return result
  }
}
