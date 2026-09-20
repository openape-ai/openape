import SwiftUI

@main
struct OpenApePodsApp: App {
  @State private var model = PodsModel()
  var body: some Scene {
    WindowGroup { PodsRootView(model: model).task { await model.restore() } }
  }
}
