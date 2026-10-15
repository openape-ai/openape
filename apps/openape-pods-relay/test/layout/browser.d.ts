import 'vitest/browser'

declare module 'vitest/browser' {
  interface BrowserCommands {
    captureInbox: (name: string) => Promise<void>
  }
}
