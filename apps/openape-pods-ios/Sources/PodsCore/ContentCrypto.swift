import CryptoKit
import Foundation

public struct PrivateKeys: Codable, Sendable {
  public let id: String
  public let signing: String
  public let agreement: String
  public static func generate() -> PrivateKeys {
    PrivateKeys(
      id: UUID().uuidString.lowercased(),
      signing: P256.Signing.PrivateKey().rawRepresentation.base64url,
      agreement: P256.KeyAgreement.PrivateKey().rawRepresentation.base64url)
  }
  public func publicKeys() throws -> DeviceKeys {
    DeviceKeys(
      signing: try P256.Signing.PrivateKey(rawRepresentation: Data(base64url: signing)).publicKey
        .x963Representation.base64url,
      agreement: try P256.KeyAgreement.PrivateKey(rawRepresentation: Data(base64url: agreement))
        .publicKey.x963Representation.base64url)
  }
}
extension Data {
  public var base64url: String {
    base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(
      of: "/", with: "_"
    ).replacingOccurrences(of: "=", with: "")
  }
  public init(base64url: String) throws {
    guard base64url.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil,
      let decoded = Data(
        base64Encoded: base64url.replacingOccurrences(of: "-", with: "+").replacingOccurrences(
          of: "_", with: "/") + String(repeating: "=", count: (4 - base64url.count % 4) % 4)),
      decoded.base64url == base64url
    else { throw PodsError.invalidEnvelope }
    self = decoded
  }
}
public enum ContentCrypto {
  private static let info = Data("OpenApe Pods encrypted-v1 P256 HKDF-SHA256 AES256GCM".utf8)
  public static func digest(_ value: String) -> String {
    digest(Data(value.utf8))
  }
  public static func digest(_ value: Data) -> String {
    SHA256.hash(data: value).map { String(format: "%02x", $0) }.joined()
  }
  public static func challenge(_ value: String) -> String {
    Data(SHA256.hash(data: Data(value.utf8))).base64url
  }
  public static func verifier() -> String { P256.Signing.PrivateKey().rawRepresentation.base64url }
  public static func proof(purpose: String, id: String, nonce: String, signing: String) throws
    -> String
  {
    let bytes = try JSONSerialization.data(
      withJSONObject: ["pods-mobile-proof", 1, purpose, id, nonce],
      options: [.withoutEscapingSlashes])
    return try sign(bytes, privateKey: signing)
  }
  private static func sign(_ bytes: Data, privateKey: String) throws -> String {
    try P256.Signing.PrivateKey(rawRepresentation: Data(base64url: privateKey)).signature(
      for: bytes
    ).rawRepresentation.base64url
  }
  private static func signedBytes(
    route: Route, ephemeral: String, nonce: String, ciphertext: String
  ) throws -> Data {
    var data = Data("OpenApe Pods envelope-v1\0".utf8)
    data.append(try route.associatedData())
    data.append(0)
    data.append(try Data(base64url: ephemeral))
    data.append(try Data(base64url: nonce))
    data.append(try Data(base64url: ciphertext))
    return data
  }
  public static func seal(route: Route, body: JSONValue, recipient: String, signing: String) throws
    -> Envelope
  {
    try route.validate()
    let ephemeral = P256.KeyAgreement.PrivateKey()
    let recipient = try P256.KeyAgreement.PublicKey(x963Representation: Data(base64url: recipient))
    let associated = try route.associatedData()
    let shared = try ephemeral.sharedSecretFromKeyAgreement(with: recipient)
    let key = shared.hkdfDerivedSymmetricKey(
      using: SHA256.self, salt: Data(SHA256.hash(data: associated)), sharedInfo: info,
      outputByteCount: 32)
    let sealed = try AES.GCM.seal(
      JSONEncoder().encode(body), using: key, authenticating: associated)
    let ephemeralKey = ephemeral.publicKey.x963Representation.base64url
    let nonce = Data(sealed.nonce).base64url
    let ciphertext = (sealed.ciphertext + sealed.tag).base64url
    let signature = try sign(
      signedBytes(route: route, ephemeral: ephemeralKey, nonce: nonce, ciphertext: ciphertext),
      privateKey: signing)
    let envelope = Envelope(
      route: route, contentMode: "encrypted-v1", ephemeralKey: ephemeralKey, nonce: nonce,
      ciphertext: ciphertext, signature: signature)
    guard try JSONEncoder().encode(envelope).count <= 65536 else { throw PodsError.invalidEnvelope }
    return envelope
  }
  public static func open(_ envelope: Envelope, agreement: String, signing: String) throws
    -> JSONValue
  {
    try envelope.route.validate()
    guard envelope.contentMode == "encrypted-v1", try JSONEncoder().encode(envelope).count <= 65536
    else { throw PodsError.invalidEnvelope }
    let signer = try P256.Signing.PublicKey(x963Representation: Data(base64url: signing))
    let signature = try P256.Signing.ECDSASignature(
      rawRepresentation: Data(base64url: envelope.signature))
    guard
      try signer.isValidSignature(
        signature,
        for: signedBytes(
          route: envelope.route, ephemeral: envelope.ephemeralKey, nonce: envelope.nonce,
          ciphertext: envelope.ciphertext))
    else { throw PodsError.invalidEnvelope }
    let own = try P256.KeyAgreement.PrivateKey(rawRepresentation: Data(base64url: agreement))
    let peer = try P256.KeyAgreement.PublicKey(
      x963Representation: Data(base64url: envelope.ephemeralKey))
    let associated = try envelope.route.associatedData()
    let key = try own.sharedSecretFromKeyAgreement(with: peer).hkdfDerivedSymmetricKey(
      using: SHA256.self, salt: Data(SHA256.hash(data: associated)), sharedInfo: info,
      outputByteCount: 32)
    let ciphertext = try Data(base64url: envelope.ciphertext)
    guard ciphertext.count >= 16 else { throw PodsError.invalidEnvelope }
    let box = try AES.GCM.SealedBox(
      nonce: AES.GCM.Nonce(data: Data(base64url: envelope.nonce)),
      ciphertext: ciphertext.dropLast(16), tag: ciphertext.suffix(16))
    return try JSONDecoder().decode(
      JSONValue.self, from: AES.GCM.open(box, using: key, authenticating: associated))
  }
  public static func pairingCode(runtime: Registration, device: Registration) throws -> String {
    let tuple: [Any] = [
      "pods-pairing-v1", runtime.owner.issuer, runtime.owner.subject, runtime.id,
      runtime.generation, runtime.keys.signing, runtime.keys.agreement, device.id, device.epoch,
      device.keys.signing, device.keys.agreement,
    ]
    let bytes = try JSONSerialization.data(
      withJSONObject: tuple, options: [.withoutEscapingSlashes])
    let hex = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    let prefix = Array(hex.prefix(12))
    return stride(from: 0, to: 12, by: 4).map { String(prefix[$0..<($0 + 4)]) }.joined(
      separator: " ")
  }
}
