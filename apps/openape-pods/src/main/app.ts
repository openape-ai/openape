import { parseScriptCommand } from '../contracts/scripts'
import { verifyUpdate } from './update'
import { selectedProfile, selectProfile } from './profile'
import { parseDataCommand } from '../contracts/data'
import { restoreBackup } from '../worker/data/backup'
import { schemaVersion } from '../worker/storage/database'
import { parseOnboardingCommand } from '../contracts/onboarding'
import { parseMasterCommand } from '../contracts/master'
import { parseDetailsCommand } from '../contracts/details'
import { parseScheduleCommand } from '../contracts/scheduling'
import { parseRunCommand } from '../contracts/runs'
import { parseResourceCommand } from '../contracts/resources'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, powerMonitor, protocol, session, shell, Tray } from 'electron'
import { mkdir, readFile, realpath } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { parseCommand } from '../contracts/control'
import { channels } from '../contracts/ipc'
import type { PodStatus } from '../contracts/ipc'
import { fixtureDirectory, localDirectory } from './fixture'
import { assertStatusRequest, assetPath, contentSecurityPolicy, rendererURL } from './security'
import { FixtureWorker } from './worker'

const fixture = !!process.env.OPENAPE_PODS_FIXTURE_DIR
app.setName(fixture ? 'OpenApe Pods Fixture' : 'OpenApe Pods')
app.enableSandbox()
const profileBase = fixture ? fixtureDirectory(process.env.OPENAPE_PODS_FIXTURE_DIR) : localDirectory(join(app.getPath('appData'), 'OpenApe Pods'))
const root = selectedProfile(profileBase)
app.setPath('userData', root)
app.setPath('sessionData', join(root, 'chromium'))
protocol.registerSchemesAsPrivileged([{ scheme: 'pods', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
let window: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let stopped = false
const status: PodStatus = { version: 1, mode: fixture ? 'fixture' : 'local', executionEnabled: true, worker: { state: 'starting', pid: null, error: null }, runtime: { electron: process.versions.electron, node: process.versions.node } }
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
  const view = new BrowserWindow({ width: 1280, height: 840, minWidth: 560, minHeight: 560, show: false, title: 'OpenApe Pods', backgroundColor: '#f5f6f3', titleBarStyle: 'hiddenInset', webPreferences: { preload: join(__dirname, '../preload/index.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, webviewTag: false, spellcheck: false } })
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
  ipcMain.handle(channels.data, async (event, value: unknown, ...extra: unknown[]) => {
    assertStatusRequest(!!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererURL, extra)
    const command = parseDataCommand(value)
    if (!window) throw new Error('Owner window is unavailable')
    if (command.type === 'deletePod') {
      const answer = await dialog.showMessageBox(window, { type: 'warning', title: 'Delete local pod', message: `Permanently delete ${command.name}?`, detail: 'This removes this archived pod’s local workspace, scripts, knowledge, source history, run history and pod key. Shared account connections and original reference files remain. OpenApe remote identities/grants are not deleted. Export a backup first if you need this history.', buttons: ['Cancel', 'Delete local pod'], defaultId: 0, cancelId: 0 })
      if (answer.response !== 1) return worker.data({ type: 'status' })
    }
    if (command.type === 'backup' || command.type === 'restore') {
      const selected = await dialog.showOpenDialog(window, { title: command.type === 'backup' ? 'Choose backup destination' : 'Choose an OpenApe Pods backup folder', properties: ['openDirectory'] })
      if (selected.canceled || selected.filePaths.length !== 1) return worker.data({ type: 'status' })
      const path = await realpath(selected.filePaths[0])
      if (command.type === 'backup') return worker.data({ type: 'backup', parent: path })
      const answer = await dialog.showMessageBox(window, { type: 'question', title: 'Restore and restart', message: 'Restore this backup into a new profile?', detail: 'The current profile is retained. Connections require reconnection, resources require review, and schedules remain disabled. Pods will restart after verification.', buttons: ['Cancel', 'Restore and restart'], defaultId: 0, cancelId: 0 })
      if (answer.response !== 1) return worker.data({ type: 'status' })
      if (status.worker.state === 'starting') throw new Error('Wait for startup to finish before restoring')
      const parent = join(await realpath(profileBase), 'profiles'); await mkdir(parent, { recursive: true, mode: 0o700 })
      const result = status.worker.state === 'ready' ? await worker.data({ type: 'restore', source: path, parent }) : { usedBytes: 0, freeBytes: 0, limitBytes: 10 * 1024 ** 3, pendingDeletion: 0, busy: false, error: null, result: { kind: 'restore' as const, path: await restoreBackup(path, parent, schemaVersion) } }
      if (!result.result || result.result.kind !== 'restore') throw new Error('Restored profile is missing')
      selectProfile(profileBase, result.result.path); app.relaunch(); app.quit(); return result
    }
    if (command.type === 'update') {
      const state = await worker.data({ type: 'status' })
      if (state.busy) throw new Error('Finish or recover active work before preparing an update')
      const selection = await dialog.showOpenDialog(window, { title: 'Choose a signed OpenApe Pods update', properties: ['openFile'], filters: [{ name: 'Application', extensions: ['app'] }] })
      if (selection.canceled || selection.filePaths.length !== 1) return state
      const candidate = await realpath(selection.filePaths[0]); const installed = dirname(dirname(dirname(process.execPath)))
      const update = await verifyUpdate(installed, candidate)
      const destination = await dialog.showOpenDialog(window, { title: 'Choose the pre-update backup destination', properties: ['openDirectory'] })
      if (destination.canceled || destination.filePaths.length !== 1) return state
      const result = await worker.data({ type: 'backup', parent: await realpath(destination.filePaths[0]) })
      await verifyUpdate(installed, candidate)
      const answer = await dialog.showMessageBox(window, { type: 'info', title: 'Update verified', message: `Version ${update.version} is ready for manual installation`, detail: `Backup: ${result.result?.path}\n\nQuit Pods, then replace the installed app with the verified app. Keep the previous app and this backup for rollback. This verification does not install or launch the update.`, buttons: ['Keep working', 'Quit Pods'], defaultId: 0, cancelId: 0 }); if (answer.response === 1) app.quit()
      return result
    }
    return worker.data(command)
  })
  ipcMain.handle(channels.onboarding, async (event, value: unknown, ...extra: unknown[]) => {
    assertStatusRequest(!!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererURL, extra)
    const command = parseOnboardingCommand(value)
    if (command.type === 'openLogin') {
      const state = await worker.onboarding({ type: 'list' }); const login = state.connections.find(item => item.id === command.id && item.state === 'connecting')?.login
      if (!login) throw new Error('Sign-in expired; start again')
      await shell.openExternal(login.url); return state
    }
    if (command.type === 'assign') {
      if (!window) throw new Error('Owner window is unavailable')
      const setup = command.setup
      const answer = await dialog.showMessageBox(window, { type: 'question', title: 'Assign read-only mail', message: `Allow this pod to read ${setup.account}?`, detail: `Folders: ${setup.folders.map(folder => folder.name).join(', ')}\nHistory: ${setup.since ?? 'All available history'}\nAttachments: ${setup.attachments ? 'Allowed for in-scope messages' : 'Not allowed'}\n\nRead content may be sent to your connected ChatGPT account for analysis. A separate OpenApe agent receives these read permissions. The pod stays paused.`, buttons: ['Cancel', 'Assign read-only mail'], defaultId: 0, cancelId: 0 })
      if (answer.response !== 1) return worker.onboarding({ type: 'list' })
    }
    return worker.onboarding(command)
  })
  ipcMain.handle(channels.master, (event, command: unknown, ...extra: unknown[]) => {
    assertStatusRequest(!!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererURL, extra)
    return worker.master(parseMasterCommand(command))
  })
  ipcMain.handle(channels.scripts, (event, command: unknown, ...extra: unknown[]) => {
    assertStatusRequest(!!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererURL, extra)
    return worker.scripts(parseScriptCommand(command))
  })
  ipcMain.handle(channels.details, (event, command: unknown, ...extra: unknown[]) => {
    assertStatusRequest(!!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererURL, extra)
    return worker.details(parseDetailsCommand(command))
  })
  ipcMain.handle(channels.workspace, (event, command: unknown, ...extra: unknown[]) => {
    assertStatusRequest(!!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererURL, extra)
    return worker.request(parseCommand(command))
  })
  ipcMain.handle(channels.scheduling, (event, command: unknown, ...extra: unknown[]) => {
    assertStatusRequest(!!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererURL, extra)
    return worker.scheduling(parseScheduleCommand(command))
  })
  ipcMain.handle(channels.runs, (event, command: unknown, ...extra: unknown[]) => {
    assertStatusRequest(!!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererURL, extra)
    return worker.runs(parseRunCommand(command))
  })
  ipcMain.handle(channels.resources, async (event, value: unknown, ...extra: unknown[]) => {
    assertStatusRequest(!!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererURL, extra)
    const command = parseResourceCommand(value)
    if (command.type !== 'pickReference') return worker.resources(command)
    if (!window) throw new Error('Owner window is unavailable')
    const pods = await worker.request({ type: 'list' })
    const pod = pods.pods.find(candidate => candidate.id === command.podId)
    if (!pod) throw new Error('Pod not found')
    const selection = await dialog.showOpenDialog(window, { title: 'Choose a read-only reference', properties: ['openFile'] })
    if (selection.canceled || selection.filePaths.length !== 1) return worker.resources({ type: 'list', podId: pod.id })
    const path = await realpath(selection.filePaths[0])
    const approval = await dialog.showMessageBox(window, { type: 'question', title: 'Assign read-only reference', message: `Allow ${pod.name} to read snapshots of this file?`, detail: `${path}\n\nEach run receives a separate read-only copy. Later source changes apply to later runs. The original file is never edited.`, buttons: ['Cancel', 'Assign reference'], defaultId: 0, cancelId: 0 })
    if (approval.response !== 1) return worker.resources({ type: 'list', podId: pod.id })
    return worker.resources({ type: 'assignReference', podId: pod.id, name: basename(path), path })
  })
  window = createWindow()
  tray = new Tray(nativeImage.createEmpty()); tray.setTitle('Pods'); tray.setToolTip(fixture ? 'OpenApe Pods · Fixture mode' : 'OpenApe Pods')
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open Pods', click: showWindow }, { label: 'Pause automatic runs', click: () => { void worker.request({ type: 'pauseAll' }).catch((error: unknown) => dialog.showErrorBox('Could not pause Pods', error instanceof Error ? error.message : 'Worker unavailable')) } }, { label: 'Quit Pods', click: () => app.quit() }]))
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'OpenApe Pods', submenu: [{ label: 'Open Pods', click: showWindow }, { role: 'quit' }] }, { role: 'editMenu' }, { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] }]))
  powerMonitor.on('suspend', () => worker.lifecycle('suspend'))
  powerMonitor.on('resume', () => worker.lifecycle('resume'))
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
