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
