import { execFile } from 'node:child_process'
import type { ElectronApplication } from 'playwright'

// macOS shows keychain and authorization prompts as SecurityAgent windows; the
// process itself may stay idle without one. Window owners need no permission.
const countDialogs = 'ObjC.import("CoreGraphics"); ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, 0))).filter(w => w.kCGWindowOwnerName === "SecurityAgent").length'

// An automated run must never wait for a person to answer a dialog (issue 1450).
export function failOnKeychainDialog(app: ElectronApplication): void {
  let stopped = false
  const timer = setInterval(() => {
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', countDialogs], (error, stdout) => {
      if (stopped || (!error && stdout.trim() === '0')) return
      stopped = true
      console.error(error
        ? `Keychain dialog guard failed: ${error.message}`
        : 'A macOS keychain or authorization dialog is open; the Pods app was stopped instead of waiting for a person. Synthetic fixtures use the mock keychain; OPENAPE_PODS_TEST_REAL_KEYCHAIN=1 needs a human or an unlocked dedicated keychain. The dialog stays open until someone answers it.')
      app.process().kill('SIGKILL')
    })
  }, 500)
  timer.unref()
  app.once('close', () => { stopped = true; clearInterval(timer) })
}
