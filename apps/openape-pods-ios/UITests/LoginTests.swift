import XCTest

final class LoginTests: XCTestCase {
  @MainActor func testLoginRequiresAnEmailAndKeepsDesktopDependencyVisible() {
    let app = XCUIApplication()
    app.launch()
    let email = app.textFields["login.email"]
    XCTAssertTrue(email.waitForExistence(timeout: 10))
    let button = app.buttons["login.continue"]
    XCTAssertFalse(button.isEnabled)
    email.tap()
    email.typeText("owner@example.test")
    XCTAssertTrue(button.isEnabled)
    XCTAssertTrue(app.staticTexts["Pair once with your registered desktop"].exists)
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name =
      "Native login on \(UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone")"
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}

extension LoginTests {
  @MainActor private func fixture(_ path: String, body: [String: String] = [:]) async throws
    -> [String: Any]
  {
    let environment = ProcessInfo.processInfo.environment
    let origin = try XCTUnwrap(environment["PODS_ACCEPTANCE_CONTROL"])
    var request = URLRequest(url: try XCTUnwrap(URL(string: origin + path)))
    request.httpMethod = "POST"
    request.setValue(environment["PODS_ACCEPTANCE_TOKEN"], forHTTPHeaderField: "x-fixture-token")
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    request.httpBody = try JSONSerialization.data(withJSONObject: body)
    let (data, response) = try await URLSession.shared.data(for: request)
    XCTAssertEqual(
      (response as? HTTPURLResponse)?.statusCode, 200, String(decoding: data, as: UTF8.self))
    return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
  }

  @MainActor private func tap(_ element: XCUIElement, in app: XCUIApplication) async throws {
    for _ in 0..<30 {
      if element.exists && element.isHittable && element.isEnabled {
        element.tap()
        return
      }
      if element.exists && !element.isEnabled {
        try await Task.sleep(for: .milliseconds(500))
        continue
      }
      app.coordinate(withNormalizedOffset: CGVector(dx: 0.75, dy: 0.8)).press(
        forDuration: 0.05,
        thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.75, dy: 0.3)))
      try await Task.sleep(for: .milliseconds(300))
    }
    let failure = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    failure.name = "Unavailable native control"
    failure.lifetime = .keepAlways
    add(failure)
    XCTFail("Control never became available: \(element)\n\(app.debugDescription)")
    throw NSError(domain: "NativeAcceptance", code: 1)
  }

  @MainActor func testNativeCreationChatAuthorizedDesktopRunAndSharedResult() async throws {
    let environment = ProcessInfo.processInfo.environment
    let app = XCUIApplication()
    app.launchEnvironment["PODS_ACCEPTANCE_ORIGIN"] = try XCTUnwrap(
      environment["PODS_ACCEPTANCE_ORIGIN"])
    app.launch()
    let email = app.textFields["login.email"]
    XCTAssertTrue(email.waitForExistence(timeout: 10))
    email.tap()
    email.typeText(try XCTUnwrap(environment["PODS_ACCEPTANCE_EMAIL"]))
    app.buttons["login.continue"].tap()
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    for _ in 0..<20 {
      let choices = [
        app.alerts.buttons["Continue"], app.alerts.buttons["Fortfahren"],
        springboard.alerts.buttons["Continue"], springboard.alerts.buttons["Fortfahren"],
      ]
      if let consent = choices.first(where: { $0.exists }) {
        consent.tap()
        break
      }
      try await Task.sleep(for: .milliseconds(500))
    }
    let authenticationScreen = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    authenticationScreen.name = "System authentication handoff"
    authenticationScreen.lifetime = .keepAlways
    add(authenticationScreen)
    let qrMode = app.webViews.buttons["Sign in with phone (QR)"]
    // The disposable IdP compiles its pages on first use; allow a slow first load.
    XCTAssertTrue(qrMode.waitForExistence(timeout: 120), app.debugDescription)
    for _ in 0..<20 {
      if !qrMode.exists { break }
      qrMode.tap()
      try await Task.sleep(for: .seconds(1))
    }
    let qr = app.webViews.buttons["Sign in with phone"]
    XCTAssertTrue(qr.waitForExistence(timeout: 30), app.debugDescription)
    qr.tap()
    for _ in 0..<20 {
      if !qr.exists { break }
      try await Task.sleep(for: .seconds(1))
      if qr.exists && qr.isHittable { qr.tap() }
    }
    let code = app.staticTexts["pairing.code"]
    XCTAssertTrue(code.waitForExistence(timeout: 30), app.debugDescription)
    _ = try await fixture("/pair", body: ["code": code.label])
    try await tap(app.buttons["Codes match — trust desktop"], in: app)
    try await tap(app.buttons["pod.create"], in: app)
    let name = app.textFields["Pod name"]
    XCTAssertTrue(name.waitForExistence(timeout: 5))
    name.tap()
    name.typeText("Native acceptance")
    try await tap(app.buttons["Create"], in: app)
    XCTAssertTrue(
      app.segmentedControls.buttons["Setup"].waitForExistence(timeout: 15), app.debugDescription)
    app.segmentedControls.buttons["Setup"].tap()
    try await tap(app.buttons["Review mobile-acceptance"], in: app)
    try await tap(app.buttons["Assign program"], in: app)
    try await tap(app.buttons["Assign reviewed program"], in: app)
    XCTAssertTrue(
      app.staticTexts["State, approved"].waitForExistence(timeout: 15), app.debugDescription)
    _ = try await fixture("/authorize-program")
    app.segmentedControls.buttons["Chat"].tap()
    let composer = app.textFields["chat.composer"]
    XCTAssertTrue(composer.waitForExistence(timeout: 5))
    composer.tap()
    composer.typeText("Prepare the assigned read command.")
    try await tap(app.buttons["Send message"], in: app)
    try await tap(app.buttons["Before and after"].firstMatch, in: app)
    let source = app.staticTexts["review.source.after"].firstMatch
    XCTAssertTrue(source.waitForExistence(timeout: 5))
    XCTAssertTrue(source.label.hasSuffix("completedInputIds:[],gapIds:[]}; }"))
    for _ in 0..<30 {
      if app.buttons["Apply changes"].isEnabled { break }
      try await Task.sleep(for: .milliseconds(500))
    }
    XCTAssertTrue(app.buttons["Apply changes"].isEnabled)
    let review = XCTAttachment(screenshot: app.screenshot())
    review.name = "Native exact script review"
    review.lifetime = .keepAlways
    add(review)
    try await tap(app.buttons["Apply changes"], in: app)
    try await tap(app.buttons["Apply reviewed changes"], in: app)
    app.segmentedControls.buttons["Runs"].tap()
    try await tap(app.buttons["Run once"], in: app)
    try await tap(app.buttons["Start authorized run"], in: app)
    var complete = false
    for _ in 0..<90 {
      let state = try await fixture("/state")
      let runs = state["runs"] as? [[String: Any]] ?? []
      if runs.first?["state"] as? String == "completed" {
        complete = true
        break
      }
      if let error = runs.first?["error"] as? String { XCTFail(error) }
      let approvals = state["approvals"] as? [[String: Any]] ?? []
      if approvals.contains(where: { $0["state"] as? String == "pending" }) {
        try await tap(app.buttons["Refresh Pod"], in: app)
        XCTAssertTrue(
          app.links["Review at identity provider"].waitForExistence(timeout: 10),
          app.debugDescription)
        let approval = XCTAttachment(screenshot: app.screenshot())
        approval.name = "Waiting for original IdP grant"
        approval.lifetime = .keepAlways
        add(approval)
        _ = try await fixture("/approve")
      }
      try await Task.sleep(for: .seconds(1))
    }
    XCTAssertTrue(complete, app.debugDescription)
    try await tap(app.buttons["Refresh Pod"], in: app)
    let evidence = try await fixture("/verify")
    let result = try XCTUnwrap(evidence["result"] as? String)
    XCTAssertTrue(app.staticTexts[result].waitForExistence(timeout: 10), app.debugDescription)
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = "Native shared desktop result"
    attachment.lifetime = .keepAlways
    add(attachment)

    // Restarting the native app keeps the signed-in session, Pod, chat and result.
    app.terminate()
    app.launch()
    try await tap(app.buttons["pod.row"].firstMatch, in: app)
    XCTAssertTrue(
      app.staticTexts["Prepare the assigned read command."].waitForExistence(timeout: 20),
      app.debugDescription)
    app.segmentedControls.buttons["Runs"].tap()
    XCTAssertTrue(app.staticTexts[result].waitForExistence(timeout: 20), app.debugDescription)

    // Restarting the desktop reconnects the same registration and serves the same run.
    _ = try await fixture("/restart-desktop")
    for _ in 0..<30 {
      if app.staticTexts["Desktop online"].exists { break }
      try await tap(app.buttons["Refresh Pod"], in: app)
      try await Task.sleep(for: .seconds(1))
    }
    XCTAssertTrue(app.staticTexts["Desktop online"].exists, app.debugDescription)
    XCTAssertTrue(app.staticTexts[result].waitForExistence(timeout: 20), app.debugDescription)
    let reconnected = XCTAttachment(screenshot: app.screenshot())
    reconnected.name = "Same result after desktop restart"
    reconnected.lifetime = .keepAlways
    add(reconnected)

    // Removing the pairing on the desktop refuses further commands without a new run.
    _ = try await fixture("/revoke-device")
    try await tap(app.buttons["Run once"], in: app)
    try await tap(app.buttons["Start authorized run"], in: app)
    XCTAssertTrue(app.alerts.firstMatch.waitForExistence(timeout: 30), app.debugDescription)
    let refused = XCTAttachment(screenshot: app.screenshot())
    refused.name = "Revoked device refused"
    refused.lifetime = .keepAlways
    add(refused)
    app.alerts.buttons["OK"].tap()
    let refusal = try await fixture("/refused")
    XCTAssertEqual(refusal["runs"] as? Int, 1)
    try await tap(app.buttons["Refresh Pod"], in: app)
    // Compact layouts keep the empty detail column; return to the Pod list.
    if !app.staticTexts["pairing.code"].waitForExistence(timeout: 10) {
      app.navigationBars.buttons.element(boundBy: 0).tap()
    }
    XCTAssertTrue(
      app.staticTexts["pairing.code"].waitForExistence(timeout: 20), app.debugDescription)
    XCTAssertFalse(app.buttons["pod.create"].isEnabled)
  }
}
