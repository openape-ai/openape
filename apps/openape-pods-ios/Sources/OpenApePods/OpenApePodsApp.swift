import SwiftUI

@main
struct OpenApePodsApp: App {
  @UIApplicationDelegateAdaptor(NotificationCoordinator.self) private var coordinator
  @State private var model = PodsModel()
  init() {
    #if DEBUG && targetEnvironment(simulator)
      // XCUITest waits for UIKit animations to settle before every action; the
      // iPad split view kept some running and stalled acceptance runs.
      if ProcessInfo.processInfo.environment["PODS_ACCEPTANCE_ORIGIN"] != nil {
        UIView.setAnimationsEnabled(false)
      }
    #endif
  }
  var body: some Scene {
    WindowGroup {
      PodsRootView(model: model).task {
        NotificationCoordinator.shared?.model = model
        await model.restore()
        if model.notificationsEnabled {
          await NotificationCoordinator.shared?.requestRegistration()
        }
      }
    }
  }
}
