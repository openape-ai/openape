import SwiftUI

@main
struct OpenApePodsApp: App {
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
    WindowGroup { PodsRootView(model: model).task { await model.restore() } }
  }
}
