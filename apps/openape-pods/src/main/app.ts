import { app, BrowserWindow, ipcMain, Menu, nativeImage, protocol, session, Tray } from 'electron'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { parseCommand } from '../contracts/control'
import { channels } from '../contracts/ipc'
import type { PodStatus } from '../contracts/ipc'
import { fixtureDirectory } from './fixture'
import { assertStatusRequest, assetPath, contentSecurityPolicy, rendererURL } from './security'
import { FixtureWorker } from './worker'

app.setName('OpenApe Pods Fixture')
app.enableSandbox()
const root = fixtureDirectory(process.env.OPENAPE_PODS_FIXTURE_DIR)
app.setPath('userData', root)
app.setPath('sessionData', join(root, 'chromium'))
protocol.registerSchemesAsPrivileged([{ scheme: 'pods', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
let window: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let stopped = false
const status: PodStatus = { version: 1, mode: 'fixture', executionEnabled: false, worker: { state: 'starting', pid: null, error: null }, runtime: { electron: process.versions.electron, node: process.versions.node } }
const worker = new FixtureWorker((next) => {
  status.worker = next
  if (window && !window.isDestroyed()) window.webContents.send(channels.changed, status)
})
function showWindow(): void {
  if (!window) throw new Error('Pods window is not ready')
  if (window.isMinimized()) window.restore()
  window.show(); window.focus()
}
function createWindow(): BrowserWindow {
  const view = new BrowserWindow({ width: 1280, height: 840, minWidth: 880, minHeight: 640, show: false, title: 'OpenApe Pods', backgroundColor: '#f5f6f3', titleBarStyle: 'hiddenInset', webPreferences: { preload: join(__dirname, '../preload/index.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, webviewTag: false, spellcheck: false } })
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  view.webContents.on('will-navigate', event => event.preventDefault())
  view.webContents.on('will-frame-navigate', event => event.preventDefault())
  view.webContents.on('will-attach-webview', event => event.preventDefault())
  view.on('close', (event) => { if (!quitting) { event.preventDefault(); view.hide() } })
  view.once('ready-to-show', () => view.show())
  view.webContents.on('render-process-gone', (_event, details) => { console.error('Pods renderer stopped', details.reason); app.quit() })
  void view.loadURL(rendererURL).catch((error: unknown) => { console.error('Pods UI failed to load', error); app.quit() })
  return view
}
async function start(): Promise<void> {
  await app.whenReady()
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.on('will-download', event => event.preventDefault())
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('pods://app/') }))
  protocol.handle('pods', async (request) => {
    try {
      const file = assetPath(request.url, join(__dirname, '../renderer'))
      const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }
      const contentType = mime[extname(file)]
      if (!contentType) return new Response('Not found', { status: 404 })
      const bytes = await readFile(file)
      return new Response(bytes, { headers: { 'Content-Type': contentType, 'Content-Security-Policy': contentSecurityPolicy, 'X-Content-Type-Options': 'nosniff' } })
    }
    catch (error) { console.error('Rejected Pods asset request', error instanceof Error ? error.message : 'unknown error'); return new Response('Not found', { status: 404 }) }
  })
  ipcMain.handle(channels.status, (event, ...args: unknown[]) => {
    assertStatusRequest(!!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererURL, args)
    return status
  })
  ipcMain.handle(channels.workspace, (event, command: unknown, ...extra: unknown[]) => {
    assertStatusRequest(!!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererURL, extra)
    return worker.request(parseCommand(command))
  })
  window = createWindow()
  tray = new Tray(nativeImage.createEmpty()); tray.setTitle('Pods'); tray.setToolTip('OpenApe Pods · Fixture mode')
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open Pods', click: showWindow }, { label: 'Quit Pods', click: () => app.quit() }]))
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'OpenApe Pods', submenu: [{ label: 'Open Pods', click: showWindow }, { role: 'quit' }] }, { role: 'editMenu' }, { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] }]))
  worker.start(root)
}
async function shutdown(): Promise<void> {
  try { await worker.stop(); stopped = true; tray?.destroy(); app.quit() }
  catch (error) { console.error('Worker shutdown failed', error); app.exit(1) }
}
if (!app.requestSingleInstanceLock()) {
  app.quit()
}
else {
  app.on('second-instance', () => { if (window) showWindow() })
  app.on('activate', () => { if (window) showWindow() })
  // Electron otherwise quits when all windows close; the tray owns this lifecycle.
  app.on('window-all-closed', () => { /* Tray remains available. */ })
  app.on('before-quit', (event) => {
    quitting = true
    if (stopped) return
    event.preventDefault()
    void shutdown()
  })
  void start().catch((error: unknown) => { console.error('Pods startup failed', error); app.exit(1) })
}
