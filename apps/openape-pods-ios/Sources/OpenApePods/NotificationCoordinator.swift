import SwiftUI
import UserNotifications

/// Bridges APNs registration and notification taps to the model. Notifications carry
/// no content; a tap opens the named runtime and the app fetches through the relay.
@MainActor
final class NotificationCoordinator: NSObject, UIApplicationDelegate,
  UNUserNotificationCenterDelegate
{
  // Set by the delegate adaptor; a self-referencing static initializer would re-enter itself.
  nonisolated(unsafe) static weak var shared: NotificationCoordinator?
  weak var model: PodsModel?
  override init() {
    super.init()
    NotificationCoordinator.shared = self
  }
  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    UNUserNotificationCenter.current().delegate = self
    return true
  }
  func requestRegistration() async {
    let center = UNUserNotificationCenter.current()
    let granted =
      (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
    guard granted else {
      model?.notificationsEnabled = false
      UserDefaults.standard.set(false, forKey: "notifications.enabled")
      return
    }
    UIApplication.shared.registerForRemoteNotifications()
  }
  func application(
    _ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
  ) {
    let token = deviceToken.map { String(format: "%02x", $0) }.joined()
    Task { await model?.registerPush(token: token) }
  }
  func application(
    _ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error
  ) {
    model?.error = "Notifications are unavailable on this device: \(error.localizedDescription)"
  }
  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse
  ) async {
    let runtime = response.notification.request.content.userInfo["runtime"] as? String
    await MainActor.run {
      guard let runtime, runtime.range(of: "^[a-f0-9-]{36}$", options: .regularExpression) != nil
      else { return }
      Task { await self.model?.openRuntime(runtime) }
    }
  }
  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, willPresent notification: UNNotification
  ) async -> UNNotificationPresentationOptions {
    // In the foreground the app resyncs itself; the banner is enough.
    await MainActor.run { Task { await self.model?.refresh() } }
    return [.banner]
  }
}
