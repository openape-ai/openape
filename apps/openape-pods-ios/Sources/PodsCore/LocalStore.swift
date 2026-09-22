import Foundation
import Security

/// Protected storage for device keys and session tokens; the Keychain in the app, memory in tests.
public protocol SecretStore: Sendable {
  func load<T: Decodable>(_ type: T.Type, account: String) throws -> T?
  func save<T: Encodable>(_ value: T, account: String) throws
  func remove(account: String) throws
}
public struct KeychainStore: SecretStore {
  private static let service = "ai.openape.pods.mobile"
  public init() {}
  public func load<T: Decodable>(_ type: T.Type, account: String) throws -> T? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: Self.service,
      kSecAttrAccount as String: account, kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = result as? Data else {
      throw PodsError.storage("Unlock this device to access your Pods session.")
    }
    return try JSONDecoder().decode(type, from: data)
  }
  public func save<T: Encodable>(_ value: T, account: String) throws {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: Self.service,
      kSecAttrAccount as String: account,
    ]
    let data = try JSONEncoder().encode(value)
    let update = SecItemUpdate(
      query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if update == errSecSuccess { return }
    guard update == errSecItemNotFound else {
      throw PodsError.storage("Could not update the protected session.")
    }
    var insert = query
    insert[kSecValueData as String] = data
    insert[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    guard SecItemAdd(insert as CFDictionary, nil) == errSecSuccess else {
      throw PodsError.storage("Could not save the protected session.")
    }
  }
  public func remove(account: String) throws {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: Self.service,
      kSecAttrAccount as String: account,
    ]
    let status = SecItemDelete(query as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw PodsError.storage("Could not remove the protected session.")
    }
  }
}
public struct CacheState: Codable, Sendable {
  public var cursor = "0"
  public var paired: [String: Registration] = [:]
  public var pending: [String: Envelope] = [:]
  public var responses: [String: JSONValue] = [:]
  public var viewed: [String: JSONValue] = [:]
  public var drafts: [String: String] = [:]
  public var transfers: [String: ResponseTransfer] = [:]
  public var pendingViews: [String: String] = [:]
  public var retainedAt: [String: Date] = [:]
  public var updatedAt = Date()
  public mutating func forgetRuntime(_ id: String) {
    let prefix = id + ":"
    let podIds = viewed.filter { $0.key.hasPrefix(prefix) }.values.flatMap {
      $0["pods"].array.compactMap { $0["id"].string }
    }
    for podId in podIds {
      drafts.removeValue(forKey: podId)
      retainedAt.removeValue(forKey: "draft:" + podId)
    }
    let operations = pending.filter { $0.value.route.runtimeId == id }.keys
    for operation in operations {
      pending.removeValue(forKey: operation)
      pendingViews.removeValue(forKey: operation)
    }
    viewed = viewed.filter { !$0.key.hasPrefix(prefix) }
    transfers = transfers.filter { !$0.key.hasPrefix(prefix) }
    responses = [:]
    retainedAt = retainedAt.filter {
      !$0.key.hasPrefix("view:" + prefix) && !$0.key.hasPrefix("response:")
    }
    paired.removeValue(forKey: id)
  }
  public mutating func expire(now: Date = Date()) {
    transfers = transfers.filter { now.timeIntervalSince($0.value.createdAt) < 86400 }
    let oldest = now.addingTimeInterval(-7 * 86400)
    viewed = viewed.filter { retainedAt["view:" + $0.key, default: .distantPast] > oldest }
    responses = responses.filter {
      retainedAt["response:" + $0.key, default: .distantPast] > oldest
    }
    drafts = drafts.filter { retainedAt["draft:" + $0.key, default: .distantPast] > oldest }
    retainedAt = retainedAt.filter { $0.value > oldest }
  }
  public init() {}
}
public struct ProtectedCache: Sendable {
  public let url: URL
  public init(url: URL) { self.url = url }
  public func load(now: Date = Date()) throws -> CacheState {
    guard FileManager.default.fileExists(atPath: url.path) else { return CacheState() }
    let values = try url.resourceValues(forKeys: [.fileSizeKey])
    guard let size = values.fileSize, size <= 50 * 1024 * 1024 else {
      throw PodsError.storage("The local cache exceeds its limit. Sign out to clear it.")
    }
    var cache = try JSONDecoder().decode(CacheState.self, from: Data(contentsOf: url))
    cache.expire(now: now)
    try save(cache)
    return cache
  }
  public func save(_ cache: CacheState) throws {
    var retained = cache
    retained.expire()
    let data = try JSONEncoder().encode(retained)
    guard data.count <= 50 * 1024 * 1024 else {
      throw PodsError.storage("The local cache is full. Clear viewed history before continuing.")
    }
    try FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    #if os(iOS)
      try data.write(to: url, options: [.atomic, .completeFileProtection])
    #else
      try data.write(to: url, options: .atomic)
    #endif
    var file = url
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try file.setResourceValues(values)
  }
  public func remove() throws {
    if FileManager.default.fileExists(atPath: url.path) {
      try FileManager.default.removeItem(at: url)
    }
  }
}
