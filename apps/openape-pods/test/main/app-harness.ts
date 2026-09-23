import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'
import type { Mock } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import { rendererURL } from '../../src/main/security'
import type { WorkerStatus } from '../../src/contracts/ipc'

// Loads the unchanged src/main/app.ts in Node with Electron replaced by
// recording fakes. The owner window, native dialogs, menus, power events and
// the worker process are the only substitutes; every IPC handler, its sender
// check and its dialog gating run as shipped. Assertions are about which
// worker command the owner's answer produces — the observable contract of the
// main process — so the former packaged E2E checks can live here.
type Handler = (event: unknown, value: unknown, ...extra: unknown[]) => unknown
export interface MainHarness {
  root: string
  invoke: (channel: string, value?: unknown) => Promise<unknown>
  dialog: { showMessageBox: Mock, showOpenDialog: Mock, showErrorBox: Mock }
  worker: Record<string, Mock> & { publish: (status: WorkerStatus) => void }
  shell: { openExternal: Mock }
  execFile: Mock
  app: { relaunch: Mock, quit: Mock, exit: Mock }
  paths: Map<string, string>
  menu: () => MenuItemConstructorOptions[]
  power: (event: 'suspend' | 'resume') => void
  close: () => Promise<void>
}

export async function startMain(env: Record<string, string> = {}, prepare: (root: string) => Promise<void> = async () => {}): Promise<MainHarness> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-main-')))
  await prepare(root)
  const paths = new Map<string, string>()
  const handlers = new Map<string, Handler>()
  const powerListeners = new Map<string, () => void>()
  let applicationMenu: MenuItemConstructorOptions[] = []
  const windows: { webContents: Record<string, unknown> }[] = []
  const dialog = { showMessageBox: vi.fn(async () => ({ response: 0, checkboxChecked: false })), showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })), showErrorBox: vi.fn() }
  const shell = { openExternal: vi.fn(async () => {}) }
  const execFile = vi.fn((_file: string, _args: string[], callback: (error: Error | null, stdout: string, stderr: string) => void) => callback(null, '', ''))
  const lifecycle = { relaunch: vi.fn(), quit: vi.fn(), exit: vi.fn() }
  const methods = new Map<string, Mock>()
  let publish: (status: WorkerStatus) => void = () => {}
  const worker = new Proxy({} as MainHarness['worker'], {
    get: (_target, key: string) => {
      if (key === 'publish') return (status: WorkerStatus) => publish(status)
      if (!methods.has(key)) methods.set(key, vi.fn(async () => ({ resources: [], epoch: 0 })))
      return methods.get(key)
    },
  })
  class FakeWindow {
    webContents: Record<string, unknown>
    constructor() {
      const mainFrame = { url: rendererURL }
      this.webContents = { mainFrame, setWindowOpenHandler: () => {}, on: () => {}, send: () => {}, setBackgroundThrottling: () => {} }
      windows.push(this)
    }

    on() {} once() {} loadURL() { return Promise.resolve() } show() {} hide() {} focus() {} restore() {} isMinimized() { return false } isDestroyed() { return false }
  }
  vi.resetModules()
  vi.doMock('electron', () => ({
    app: {
      setName: () => {}, enableSandbox: () => {}, setPath: (name: string, path: string) => paths.set(name, path), getPath: (name: string) => join(root, name), getAppPath: () => root,
      requestSingleInstanceLock: () => true, on: () => {}, whenReady: () => Promise.resolve(), getPreferredSystemLanguages: () => ['en'], getLocale: () => 'en',
      getFileIcon: async () => ({ resize: () => ({ toDataURL: () => 'data:image/png;base64,' }) }), ...lifecycle,
    },
    BrowserWindow: FakeWindow,
    dialog,
    ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler), on: () => {} },
    Menu: { buildFromTemplate: (template: MenuItemConstructorOptions[]) => template, setApplicationMenu: (template: MenuItemConstructorOptions[]) => { applicationMenu = template } },
    nativeImage: { createEmpty: () => ({}) },
    powerMonitor: { on: (event: string, listener: () => void) => powerListeners.set(event, listener) },
    protocol: { registerSchemesAsPrivileged: () => {}, handle: () => {} },
    session: { defaultSession: { setPermissionRequestHandler: () => {}, setPermissionCheckHandler: () => {}, on: () => {}, webRequest: { onBeforeRequest: () => {} } } },
    shell,
    Tray: class { setTitle() {} setToolTip() {} setContextMenu() {} destroy() {} },
  }))
  vi.doMock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), execFile }))
  vi.doMock('../../src/main/worker', () => ({ FixtureWorker: class { constructor(callback: typeof publish) { publish = callback; return worker } } }))
  vi.doMock('../../src/main/remote/controller', () => ({ RemoteController: class { error = '' } }))
  const previous = { ...process.env }
  Object.assign(process.env, { OPENAPE_PODS_FIXTURE_DIR: root, NODE_ENV: 'test' }, env)
  await import('../../src/main/app')
  await vi.waitFor(() => { if (!handlers.has('pods:resources') || !windows.length) throw new Error('Main process has not started') })
  return {
    root,
    invoke: async (channel, value) => {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`No IPC handler for ${channel}`)
      const { webContents } = windows[0]!
      return handler({ sender: webContents, senderFrame: webContents.mainFrame }, value)
    },
    dialog,
    worker,
    shell,
    execFile,
    app: lifecycle,
    paths,
    menu: () => applicationMenu,
    power: event => powerListeners.get(event)!(),
    close: async () => { process.env = previous; vi.doUnmock('electron'); vi.doUnmock('node:child_process'); vi.doUnmock('../../src/main/worker'); vi.doUnmock('../../src/main/remote/controller'); await rm(root, { recursive: true, force: true }) },
  }
}
