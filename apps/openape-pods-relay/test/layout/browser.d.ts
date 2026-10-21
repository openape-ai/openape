import 'vitest/browser'

declare module 'vitest/browser' {
  interface BrowserCommands {
    captureInbox: (name: string) => Promise<void>
    touchDrag: (from: [number, number], to: [number, number], screenshot?: string) => Promise<void>
  }
}
