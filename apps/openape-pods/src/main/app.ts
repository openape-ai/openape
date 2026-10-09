import { AutomaticUpdate } from './automatic-update'
import { parseUpdateCommand } from '../contracts/updates'
import { randomUUID } from 'node:crypto'
import { sharingLimits } from '@openape/pods-protocol'
import { parseSharingCommand } from '../contracts/sharing'
import { parseDefinitionCommand } from '../contracts/definitions'
import { McpOwnerSessions } from './codex/session'
import { parseMcpSessionCommand } from '../contracts/mcp-session'
import { CentralController, offlineAlert } from './central/controller'
import { centralObject } from '../contracts/central'
import { RemoteController, RemoteServiceError } from './remote/controller'
import { InboxDecisions } from './inbox/decisions'
import { parseNetworkCommand } from '../contracts/networks'
import { searchPackages } from './package-catalog'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parseProgramCommand } from '../contracts/programs'
import { parseSecretsCommand } from '../contracts/secrets'
import { applicationDefinition } from './programs/application'
import { programDefinition, suggestedProgram } from './programs/definition'
import { LanguagePreference } from './language'
import { parseLanguageCommand } from '../contracts/language'
import { translate, translateDiagnostic } from '../i18n'
import type { MessageKey, Parameters } from '../i18n'
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
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, powerMonitor, protocol, session, shell, Tray } from 'electron'
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { parseCommand } from '../contracts/control'
import { channels } from '../contracts/ipc'
import type { PodStatus } from '../contracts/ipc'
import { fixtureDirectory, localDirectory } from './fixture'
import { assertStatusRequest, assetPath, contentSecurityPolicy, rendererURL, rendererStyleNonce } from './security'
import { FixtureWorker } from './worker'
import { CodexControlServer } from './codex/server'
import { refreshLauncher } from './codex/launcher'
import { CodexRegistration } from './codex/registration'
import { parseCodexCommand } from '../contracts/codex'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'

const fixture = !!process.env.OPENAPE_PODS_FIXTURE_DIR
// Fixture runs keep their windows hidden so test suites do not interrupt the
// developer; set OPENAPE_PODS_FIXTURE_SHOW=1 to watch a fixture run.
const hiddenFixture = fixture && process.env.OPENAPE_PODS_FIXTURE_SHOW !== '1'
app.setName(fixture ? 'OpenApe Pods Fixture' : 'OpenApe Pods')
// Chromium's mock keychain keeps safeStorage working with a fixed key and never
// touches the login keychain, whose access prompts would wait for a person.
if (fixture && process.env.NODE_ENV === 'test' && process.env.OPENAPE_PODS_TEST_REAL_KEYCHAIN !== '1') app.commandLine.appendSwitch('use-mock-keychain')
app.enableSandbox()
const profileBase = fixture ? fixtureDirectory(process.env.OPENAPE_PODS_FIXTURE_DIR) : localDirectory(join(app.getPath('appData'), 'OpenApe Pods'))
const root = selectedProfile(profileBase)
if (existsSync(join(root, 'central'))) process.env.OPENAPE_PODS_CENTRAL_ENABLED = '1'
app.setPath('userData', root)
app.setPath('sessionData', join(root, 'chromium'))
protocol.registerSchemesAsPrivileged([{ scheme: 'pods', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
let window: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let stopped = false
let automaticUpdate: AutomaticUpdate
let updateTimer: ReturnType<typeof setInterval> | undefined
let preference: LanguagePreference
function t(key: MessageKey, parameters?: Parameters): string { return translate(preference.language, key, parameters) }
const status: PodStatus = { version: 1, mode: fixture ? 'fixture' : 'local', executionEnabled: true, worker: { state: 'starting', pid: null, error: null }, runtime: { electron: process.versions.electron, node: process.versions.node } }
let central: CentralController | null = null
const worker = new FixtureWorker((next) => {
  status.worker = next
  if (next.state === 'ready') central?.start()
  if (window && !window.isDestroyed()) window.webContents.send(channels.changed, status)
})
const remote = new RemoteController(root, worker)
if (process.env.OPENAPE_PODS_CENTRAL_ENABLED === '1') {
  central = new CentralController(root, body => remote.workspaceRequest(body), { snapshot: format => worker.centralSnapshot(format), networkRead: command => worker.centralNetworkRead(command), version: () => worker.centralVersion(), execute: command => worker.centralExecute(command), gate: until => worker.centralGate(until) }, join(__dirname, '../native/pods-helper').replace('/app.asar/', '/app.asar.unpacked/'))
  worker.central = central
  worker.inbox = new InboxDecisions(worker, t)
}
const codexDirectory = join(profileBase, 'codex')
const codexTarget = { executable: process.execPath, script: join(__dirname, '../runtime/codex-mcp.mjs').replace('/app.asar/', '/app.asar.unpacked/'), socket: join(codexDirectory, 'control.sock') }
// Acceptance runs of the fixture app have no reachable identity provider; they
// replace only the browser sign-in and still need the native confirmation.
const syntheticMcpOwner = fixture && process.env.NODE_ENV === 'test' && process.env.OPENAPE_PODS_FIXTURE_MCP_OWNER === 'synthetic'
const mcpSessions = new McpOwnerSessions({
  login: signal => syntheticMcpOwner ? Promise.resolve() : worker.verifyMcpOwner(signal, ({ url }) => { void shell.openExternal(url).catch((error: unknown) => console.error('Could not open the MCP sign-in', error)) }),
  confirm: confirmMcpSession,
})
const codexServer = new CodexControlServer(codexTarget.socket, request => worker.codex(request), mcpSessions)
// The IdP answers a signed-in browser without a prompt, so the owner confirms here
// that this sign-in belongs to a request he just made.
async function confirmMcpSession(signal: AbortSignal): Promise<boolean> {
  if (!window) return false
  if (!hiddenFixture) { showWindow(); app.focus({ steal: true }) }
  const answer = await dialog.showMessageBox(window, { type: 'warning', title: t('MCP session'), message: t('Codex requests full Pods access for one hour'), detail: t('Allow only if you just asked Codex or another MCP client to work with Pods. It can then change Pods, scripts, resources and schedules and start runs. Grants are still decided only at your identity provider. End the session in App settings at any time.'), buttons: [t('Cancel'), t('Allow for one hour')], defaultId: 0, cancelId: 0, signal })
  return answer.response === 1
}
// Fixture runs must name an isolated Codex home; they never touch the owner's.
const codexHome = fixture ? process.env.OPENAPE_PODS_FIXTURE_CODEX_HOME : process.env.CODEX_HOME || join(homedir(), '.codex')
async function codexRegistration(): Promise<CodexRegistration> {
  if (!codexHome) throw new Error('Fixture runs need OPENAPE_PODS_FIXTURE_CODEX_HOME')
  const vendor = join(__dirname, '../vendor').replace('/app.asar/', '/app.asar.unpacked/')
  const manifest = JSON.parse(await readFile(join(vendor, 'manifest.json'), 'utf8')) as { binaryHash: string }
  return new CodexRegistration({ binary: join(vendor, 'codex'), binaryHash: manifest.binaryHash }, codexHome, codexDirectory, codexTarget)
}
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
  view.once('ready-to-show', () => { if (!hiddenFixture) view.show() })
  view.webContents.on('render-process-gone', (_event, details) => { console.error('Pods renderer stopped', details.reason); app.quit() })
  void view.loadURL(rendererURL).catch((error: unknown) => { console.error('Pods UI failed to load', error); app.quit() })
  return view
}
function updateMenus(): void {
  tray?.setToolTip(fixture ? t('OpenApe Pods · Fixture mode') : 'OpenApe Pods')
  tray?.setContextMenu(Menu.buildFromTemplate([{ label: t('Open Pods'), click: showWindow }, { label: t('Pause automatic runs'), click: () => { void worker.request({ type: 'pauseAll' }).catch((error: unknown) => dialog.showErrorBox(t('Could not pause Pods'), translateDiagnostic(preference.language, error instanceof Error ? error.message : 'Worker unavailable'))) } }, { label: t('Quit Pods'), click: () => app.quit() }]))
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'OpenApe Pods', submenu: [{ label: t('Open Pods'), click: showWindow }, { label: t('Quit Pods'), role: 'quit' }] }, { label: t('Edit'), submenu: [{ label: t('Undo'), role: 'undo' }, { label: t('Redo'), role: 'redo' }, { type: 'separator' }, { label: t('Cut'), role: 'cut' }, { label: t('Copy'), role: 'copy' }, { label: t('Paste'), role: 'paste' }, { label: t('Paste and match style'), role: 'pasteAndMatchStyle' }, { label: t('Delete'), role: 'delete' }, { label: t('Select all'), role: 'selectAll' }] }, { label: t('Window'), submenu: [{ label: t('Minimize'), role: 'minimize' }, { label: t('Close window'), role: 'close' }] }, ...(process.env.OPENAPE_PODS_ISSUE_REPORTING_ENABLED === '1' ? [{ label: t('Help'), submenu: [{ id: 'report-problem', label: t('Report a problem'), click: () => { void shell.openExternal('https://repos.openape.ai/report?product=pods').catch((error: unknown) => dialog.showErrorBox(t('Could not open issue reporting'), translateDiagnostic(preference.language, error instanceof Error ? error.message : 'Browser unavailable'))) } }] }] : [])]))
}
async function start(): Promise<void> {
  await app.whenReady()
  automaticUpdate = new AutomaticUpdate(app.getVersion(), null)
  preference = new LanguagePreference(root, fixture ? 'en' : app.getPreferredSystemLanguages()[0] ?? app.getLocale())
  ipcMain.handle(channels.updates, async (event, value: unknown, ...extra: unknown[]) => {
    assertStatusRequest(!!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererURL, extra)
    const command = parseUpdateCommand(value)
    if (command.type === 'check') return automaticUpdate.check()
    if (command.type === 'install') {
      if (!window) throw new Error('Owner window is unavailable')
      const answer = await dialog.showMessageBox(window, { type: 'question', title: t('Install update'), message: t('Back up this workspace and restart to install the update?'), detail: t('Active work must finish first. Your Pods, credentials and schedules stay on this Mac.'), buttons: [t('Later'), t('Restart and install')], defaultId: 0, cancelId: 0 })
      if (answer.response === 1) return automaticUpdate.install()
    }
    return { ...automaticUpdate.view }
  })
  ipcMain.handle(channels.language, (event, value: unknown, ...extra: unknown[]) => {
    assertStatusRequest(!!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererURL, extra)
    const command = parseLanguageCommand(value)
    if (command.type === 'set') { preference.set(command.language); updateMenus() }
    return preference.language
  })
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
      const body = contentType === 'text/html' ? bytes.toString('utf8').replace('<head>', `<head><meta name="pods-style-nonce" content="${rendererStyleNonce}">`) : bytes
      return new Response(body, { headers: { 'Content-Type': contentType, 'Content-Security-Policy': contentSecurityPolicy, 'X-Content-Type-Options': 'nosniff' } })
    }
    catch (error) { console.error('Rejected Pods asset request', error instanceof Error ? error.message : 'unknown error'); return new Response('Not found', { status: 404 }) }
  })
  ipcMain.handle(channels.central, async (event, value: unknown, ...extra: unknown[]) => {
    assertStatusRequest(!!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererURL, extra)
    const command = centralObject(value)
    if (command.type === 'status') return { enabled: !!central, online: central?.available ?? false, ...central?.status() }
    if (!central) throw new Error('Central workspace is not enabled')
    if (command.type === 'register') { await remote.enable(await worker.remoteOwner()); return { ok: true } }
    try { return await central.query(command) }
    catch (error) {
      if (error instanceof RemoteServiceError) return { requestError: { status: error.status, message: error.message } }
      throw error
    }
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
      const answer = await dialog.showMessageBox(window, { type: 'warning', title: t('Delete local pod'), message: t('Permanently delete {p0}?', { p0: command.name }), detail: t('This removes this archived pod’s local workspace, scripts, knowledge, source history, run history and pod key. Shared account connections and original reference files remain. OpenApe remote identities/grants are not deleted. Export a backup first if you need this history.'), buttons: [t('Cancel'), t('Delete local pod')], defaultId: 0, cancelId: 0 })
      if (answer.response !== 1) return worker.data({ type: 'status' })
    }
    if (command.type === 'backup' || command.type === 'restore') {
      const selected = await dialog.showOpenDialog(window, { title: command.type === 'backup' ? t('Choose backup destination') : t('Choose an OpenApe Pods backup folder'), properties: ['openDirectory'] })
      if (selected.canceled || selected.filePaths.length !== 1) return worker.data({ type: 'status' })
      const path = await realpath(selected.filePaths[0])
      if (command.type === 'backup') return worker.data({ type: 'backup', parent: path })
      const answer = await dialog.showMessageBox(window, { type: 'question', title: t('Restore and restart'), message: t('Restore this backup into a new profile?'), detail: t('The current profile is retained. Connections require reconnection, resources require review, and schedules remain disabled. Pods will restart after verification.'), buttons: [t('Cancel'), t('Restore and restart')], defaultId: 0, cancelId: 0 })
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
      const selection = await dialog.showOpenDialog(window, { title: t('Choose a signed OpenApe Pods update'), properties: ['openFile'], filters: [{ name: t('Application'), extensions: ['app'] }] })
      if (selection.canceled || selection.filePaths.length !== 1) return state
      const candidate = await realpath(selection.filePaths[0]); const installed = dirname(dirname(dirname(process.execPath)))
      const update = await verifyUpdate(installed, candidate)
      const destination = await dialog.showOpenDialog(window, { title: t('Choose the pre-update backup destination'), properties: ['openDirectory'] })
      if (destination.canceled || destination.filePaths.length !== 1) return state
      const result = await worker.data({ type: 'backup', parent: await realpath(destination.filePaths[0]) })
      await verifyUpdate(installed, candidate)
      if (result.result?.kind !== 'backup') throw new Error('Backup result is missing')
      const answer = await dialog.showMessageBox(window, { type: 'info', title: t('Update verified'), message: t('Version {p0} is ready for manual installation', { p0: update.version }), detail: t('Backup: {p0}\n\nQuit Pods, then replace the installed app with the verified app. Keep the previous app and this backup for rollback. This verification does not install or launch the update.', { p0: result.result.path }), buttons: [t('Keep working'), t('Quit Pods')], defaultId: 0, cancelId: 0 }); if (answer.response === 1) app.quit()
      return result
    }
    return worker.data(command)
  })
  ipcMain.handle(channels.programs, async (event, value: unknown, ...extra: unknown[]) => {
    assertStatusRequest(!!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererURL, extra)
    if (!window) throw new Error('Owner window is unavailable')
    const command = parseProgramCommand(value)
    if (command.type === 'openFolder') {
      // The owner's editor opens the Pod folder (home and workspace); no Pod process is involved.
      const failure = await shell.openPath(join(root, 'pods', command.podId))
      if (failure) throw new Error('Could not open the Pod folder')
      return worker.resources({ type: 'list', podId: command.podId })
    }
    if (command.type === 'openShell') {
      const launcher = await worker.program(command)
      if (typeof launcher !== 'string') throw new Error('Invalid pod terminal launcher')
      try { await promisify(execFile)('/usr/bin/open', ['-a', '/System/Applications/Utilities/Terminal.app', launcher]) }
      catch (error) { worker.cancelProgram(command.podId); throw error }
      return worker.resources({ type: 'list', podId: command.podId })
    }
    const unchanged = () => worker.resources({ type: 'list', podId: command.podId })
    if (command.type === 'add' || command.type === 'replace') {
      const defaultPath = command.type === 'add' && command.suggestedName ? await suggestedProgram(command.suggestedName, `${process.env.PATH ?? ''}:/opt/homebrew/bin:/usr/local/bin:${app.getPath('home')}/.local/bin`) : undefined
      const executable = await dialog.showOpenDialog(window, { title: t('Choose an installed application or CLI'), properties: ['openFile'], ...(defaultPath ? { defaultPath } : {}) })
      if (executable.canceled || executable.filePaths.length !== 1) return unchanged()
      const path = executable.filePaths[0]
      const icon = (await app.getFileIcon(path, { size: 'normal' })).resize({ width: 32, height: 32 }).toDataURL()
      if (path.endsWith('.app')) return worker.program(command, { ...await applicationDefinition(path, join(app.getPath('userData'), 'application-definitions')), icon })
      try { return await worker.program(command, { ...await programDefinition(path), icon }) }
      catch (error) { if (!(error instanceof Error) || !error.message.startsWith('No adapter found for ')) throw error }
      const adapter = await dialog.showOpenDialog(window, { title: t('Choose its apes command descriptor'), properties: ['openFile'], filters: [{ name: 'apes', extensions: ['toml'] }] })
      if (adapter.canceled || adapter.filePaths.length !== 1) return unchanged()
      return worker.program(command, { ...await programDefinition(path, adapter.filePaths[0]), icon })
    }
    if (command.type === 'importState') {
      const selected = await dialog.showOpenDialog(window, { title: t('Import an existing application state file'), properties: ['openFile', 'showHiddenFiles'] })
      if (selected.canceled || selected.filePaths.length !== 1) return unchanged()
      const answer = await dialog.showMessageBox(window, { type: 'question', title: t('Copy application state'), message: t('Copy this file into the application’s protected state?'), detail: t('Only this assigned program receives the copy. The original file stays unchanged. This does not verify sign-in or enable scheduled runs.'), buttons: [t('Cancel'), t('Copy application state')], defaultId: 0, cancelId: 0 })
      if (answer.response !== 1) return unchanged()
      return worker.program(command, undefined, selected.filePaths[0])
    }
    return worker.program(command)
  })
  ipcMain.handle(channels.onboarding, async (event, value: unknown, ...extra: unknown[]) => {
    assertStatusRequest(!!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererURL, extra)
    const command = parseOnboardingCommand(value)
    if (command.type === 'openLogin') {
      const state = await worker.onboarding({ type: 'list' }); const login = state.connections.find(item => item.id === command.id && item.state === 'connecting')?.login
      if (!login) throw new Error('Sign-in expired; start again')
      await shell.openExternal(login.url); return state
    }
    if (command.type === 'openGrants') {
      const { owner } = await worker.remoteOwner()
      await shell.openExternal(new URL('/grants', owner.issuer).href)
      return worker.onboarding({ type: 'list' })
    }
    return worker.onboarding(command)
  })
  ipcMain.handle(channels.mcpSession, (event, value: unknown, ...extra: unknown[]) => {
    assertStatusRequest(!!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererURL, extra)
    if (parseMcpSessionCommand(value).type === 'end') mcpSessions.end()
    return mcpSessions.view()
  })
  ipcMain.handle(channels.codex, async (event, value: unknown, ...extra: unknown[]) => {
    assertStatusRequest(!!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererURL, extra)
    const command = parseCodexCommand(value)
    // Without a launcher the app never connected; reading Codex's configuration waits for the owner.
    if (command.type === 'status' && !existsSync(join(codexDirectory, 'openape-pods-mcp'))) return { state: 'disconnected', home: codexHome ?? '', manual: 'codex mcp remove openape-pods' }
    const registration = await codexRegistration()
    if (command.type === 'status') return registration.status()
    if (command.type === 'connect') return registration.connect()
    return registration.disconnect()
  })
  ipcMain.handle(channels.master, (event, command: unknown, ...extra: unknown[]) => {
    assertStatusRequest(!!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererURL, extra)
    return worker.master(parseMasterCommand(command))
  })
  let catalogBusy = false
  ipcMain.handle(channels.packages, async (event, value: unknown, ...extra: unknown[]) => {
    assertStatusRequest(!!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererURL, extra)
    if (catalogBusy) throw new Error('An npm search is already running')
    catalogBusy = true
    try { return await searchPackages(value) }
    finally { catalogBusy = false }
  })
  ipcMain.handle(channels.scripts, async (event, value: unknown, ...extra: unknown[]) => {
    assertStatusRequest(!!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererURL, extra)
    const command = parseScriptCommand(value)
    if (command.type === 'prepareDependencies') {
      const view = await worker.scripts({ type: 'list', podId: command.podId, selection: { kind: 'draft', id: command.draftId } })
      if (!window || view.pod.revision !== command.revision || view.source?.revision !== command.draftRevision) throw new Error('Draft or pod changed during dependency preparation')
      const packages = Object.entries(view.source.packages?.dependencies ?? {}).map(([name, version]) => `${name}@${version}`).join('\n')
      const answer = await dialog.showMessageBox(window, { type: 'question', title: t('Prepare dependencies'), message: t('Download these script dependencies?'), detail: t('Packages: {packages}\n\nThe pod will be paused. Preparation uses only the public npm registry, without secrets or installation scripts. Imported libraries receive the same access as your script. No automatic updates.', { packages }), buttons: [t('Cancel'), t('Prepare dependencies')], defaultId: 0, cancelId: 0 })
      if (answer.response !== 1) return view
    }
    if (command.type === 'approveCredentials') {
      const view = await worker.scripts({ type: 'list', podId: command.podId, selection: { kind: 'version', id: command.hash } })
      if (!window || view.pod.revision !== command.revision || view.resourceEpoch !== command.epoch || !view.source?.validated) throw new Error('Pod or resources changed during credential review')
      const aliases = view.source.capabilities.filter(item => item.startsWith('credential.')).map(item => item.slice(11))
      const answer = await dialog.showMessageBox(window, { type: 'warning', title: t('Approve script credentials'), message: t('Allow this exact script to read the selected credentials?'), detail: t('Pod: {pod}\nSHA-256: {hash}\nCredentials: {aliases}\n\nThe script can explicitly write these values into files, logs or AI prompts. Review the full source before approving. Changes to the script or resources require a new approval.', { pod: view.pod.name, hash: command.hash, aliases: aliases.join(', ') }), buttons: [t('Cancel'), t('Approve script credentials')], defaultId: 0, cancelId: 0 })
      if (answer.response !== 1) return view
    }
    return worker.scripts(command)
  })
  ipcMain.handle(channels.details, (event, command: unknown, ...extra: unknown[]) => {
    assertStatusRequest(!!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererURL, extra)
    return worker.details(parseDetailsCommand(command))
  })
  ipcMain.handle(channels.secrets, async (event, value: unknown, ...extra: unknown[]) => {
    assertStatusRequest(!!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererURL, extra)
    if (!window) throw new Error('Owner window is unavailable')
    const command = parseSecretsCommand(value)
    if (command.type !== 'importFile') return worker.secrets(command)
    const selected = await dialog.showOpenDialog(window, { title: t('Choose a private file on this Mac'), properties: ['openFile', 'showHiddenFiles'] })
    if (!selected.canceled && selected.filePaths[0]) await worker.importSecretFile(command.podId, command.alias, selected.filePaths[0])
    return worker.secrets({ type: 'list' })
  })
  ipcMain.handle(channels.workspace, (event, command: unknown, ...extra: unknown[]) => {
    assertStatusRequest(!!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererURL, extra)
    return worker.request(parseCommand(command))
  })
  ipcMain.handle(channels.definitions, (event, command: unknown, ...extra: unknown[]) => {
    assertStatusRequest(!!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererURL, extra)
    return worker.definitions(parseDefinitionCommand(command))
  })
  ipcMain.handle(channels.networks, (event, command: unknown, ...extra: unknown[]) => {
    assertStatusRequest(!!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererURL, extra)
    return worker.networks(parseNetworkCommand(command))
  })
  ipcMain.handle(channels.scheduling, (event, command: unknown, ...extra: unknown[]) => {
    assertStatusRequest(!!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererURL, extra)
    return worker.scheduling(parseScheduleCommand(command))
  })
  ipcMain.handle(channels.runs, async (event, value: unknown, ...extra: unknown[]) => {
    assertStatusRequest(!!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererURL, extra)
    const command = parseRunCommand(value)
    if (command.type === 'resolveHttp') {
      if (!window) throw new Error('Owner window is unavailable')
      const answer = await dialog.showMessageBox(window, { type: 'warning', title: t('Resolve uncertain delivery'), message: command.applied ? t('Record this request as already delivered?') : t('Allow this request to be sent again?'), detail: command.evidence, buttons: [t('Cancel'), t('Confirm observation')], defaultId: 0, cancelId: 0 })
      if (answer.response !== 1) return worker.runs({ type: 'list', podId: command.podId, runId: command.runId })
    }
    return worker.runs(command)
  })
  ipcMain.handle(channels.sharing, async (event, value: unknown, ...extra: unknown[]) => {
    assertStatusRequest(!!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererURL, extra)
    const command = parseSharingCommand(value)
    // Package bytes enter only through the dialog below, never from the renderer.
    if (command.scope === 'import' && (command.type === 'stage' || command.type === 'inspect')) throw new Error('File selection requires the owner window')
    if (command.scope === 'import' && command.type === 'pickFile') {
      if (!window) throw new Error('Owner window is unavailable')
      const selection = await dialog.showOpenDialog(window, { title: t('Open portable package'), properties: ['openFile'], filters: [{ name: t('OpenApe package'), extensions: ['openape'] }] })
      if (selection.canceled || selection.filePaths.length !== 1) return worker.sharing({ scope: 'import', type: 'list' })
      const path = await realpath(selection.filePaths[0])
      const info = await stat(path)
      if (!info.isFile()) throw new Error('Choose a regular package file')
      if (info.size > sharingLimits.transferBytes) throw new Error('Portable archive exceeds the 25 MiB transfer limit')
      // The file is read once here; the worker validates every byte before anything is stored.
      return worker.sharing({ scope: 'import', type: 'stage', id: randomUUID(), archive: new Uint8Array(await readFile(path)) })
    }
    if (command.scope === 'export' && command.type === 'download') {
      if (!window) throw new Error('Owner window is unavailable')
      const state = await worker.sharing(command)
      if (!state.archive) throw new Error('Portable export returned no archive')
      const target = await dialog.showSaveDialog(window, { title: t('Save portable package'), defaultPath: `pods-package-${new Date().toISOString().slice(0, 10)}.openape`, filters: [{ name: t('OpenApe package'), extensions: ['openape'] }] })
      if (target.canceled || !target.filePath) return { imports: state.imports, saved: null }
      // Written privately next to the target and moved into place, so a partial file never looks like a package.
      const partial = join(dirname(target.filePath), `.${basename(target.filePath)}.${randomUUID()}.partial`)
      await writeFile(partial, state.archive, { mode: 0o600, flag: 'wx' })
      try { await rename(partial, target.filePath) }
      catch (failure) { await rm(partial, { force: true }); throw failure }
      return { imports: state.imports, saved: target.filePath }
    }
    return worker.sharing(command)
  })
  ipcMain.handle(channels.resources, async (event, value: unknown, ...extra: unknown[]) => {
    assertStatusRequest(!!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererURL, extra)
    const command = parseResourceCommand(value)
    if (command.type === 'pickDirectory' || command.type === 'changeDirectory' || command.type === 'reviewDirectory') {
      if (!window) throw new Error('Owner window is unavailable')
      const state = await worker.resources({ type: 'list', podId: command.podId })
      if (state.epoch !== command.epoch) throw new Error('Directory permissions changed; reload before assigning access')
      let path: string
      if (command.type === 'pickDirectory') {
        const selection = await dialog.showOpenDialog(window, { title: t('Add directory'), properties: ['openDirectory'] })
        if (selection.canceled || selection.filePaths.length !== 1) return state
        path = await realpath(selection.filePaths[0])
      }
      else if (command.type === 'reviewDirectory') {
        path = await realpath(command.path)
      }
      else {
        const resource = state.resources.find(item => item.id === command.id && item.revision === command.revision && item.kind === 'directory' && item.state === 'ready')
        if (!resource) throw new Error('Directory permission is no longer available')
        path = resource.configuration.path as string
      }
      const buttons = command.type === 'pickDirectory' ? [t('Cancel'), t('Read'), t('Read and write')] : [t('Cancel'), t(command.access === 'read' ? 'Read' : 'Read and write')]
      const approval = await dialog.showMessageBox(window, { type: 'question', title: t('Directory permissions'), message: path, detail: t('Allow direct access to this folder and its contents? Read and write also allows changing and deleting files. The pod will be paused.'), buttons, defaultId: 0, cancelId: 0 })
      if (approval.response === 0) return state
      const access = command.type !== 'pickDirectory' ? command.access : approval.response === 1 ? 'read' : 'readWrite'
      return worker.resources({ type: 'assignDirectory', podId: command.podId, epoch: command.epoch, path, access })
    }
    if (command.type !== 'pickReference') return worker.resources(command)
    if (!window) throw new Error('Owner window is unavailable')
    const pods = await worker.request({ type: 'list' })
    const pod = pods.pods.find(candidate => candidate.id === command.podId)
    if (!pod) throw new Error('Pod not found')
    const selection = await dialog.showOpenDialog(window, { title: t('Choose a read-only reference'), properties: ['openFile'] })
    if (selection.canceled || selection.filePaths.length !== 1) return worker.resources({ type: 'list', podId: pod.id })
    const path = await realpath(selection.filePaths[0])
    const approval = await dialog.showMessageBox(window, { type: 'question', title: t('Assign read-only reference'), message: t('Allow {p0} to read snapshots of this file?', { p0: pod.name }), detail: t('{p0}\n\nEach run receives a separate read-only copy. Later source changes apply to later runs. The original file is never edited.', { p0: path }), buttons: [t('Cancel'), t('Assign reference')], defaultId: 0, cancelId: 0 })
    if (approval.response !== 1) return worker.resources({ type: 'list', podId: pod.id })
    return worker.resources({ type: 'assignReference', podId: pod.id, name: basename(path), path })
  })
  window = createWindow()
  tray = new Tray(nativeImage.createEmpty()); tray.setTitle('Pods'); tray.setToolTip('OpenApe Pods')
  updateMenus()
  powerMonitor.on('suspend', () => worker.lifecycle('suspend'))
  powerMonitor.on('resume', () => worker.lifecycle('resume'))
  worker.start(root)
  if (central) watchCentral(central)
  // Pod notifications wait in the worker outbox until the account inbox acknowledges them.
  setInterval(() => { remote.deliverInbox().catch((error: unknown) => console.error('Could not deliver Pod notifications', error)) }, 15000).unref()
  // Always grants of finished network approval batches would stay active at the IdP; a few batches are released per minute.
  setInterval(() => { worker.releaseNetworkGrants(AbortSignal.timeout(50000)).catch((error: unknown) => console.error('Could not release network approval grants', error)) }, 60000).unref()
  // Decisions are taken through the central workspace, so they are published only while it is online.
  setInterval(() => {
    const inbox = worker.inbox
    if (!central?.available || !inbox) return
    remote.publishDecisions(() => inbox.collect()).catch((error: unknown) => console.error('Could not publish owner decisions', error))
  }, 10000).unref()
  await refreshLauncher(join(codexDirectory, 'openape-pods-mcp'), codexTarget)
  await codexServer.start()
  if (app.isPackaged && !fixture && process.platform === 'darwin' && process.arch === 'arm64') {
    try {
      const { createAutomaticUpdate } = await import('./update-runtime')
      automaticUpdate = await createAutomaticUpdate({ version: app.getVersion(), installed: dirname(dirname(dirname(process.execPath))), executable: process.execPath, profile: root, backups: join(app.getPath('appData'), 'OpenApe Pods Rollback'), freeze: () => worker.prepareUpdate(), resume: () => worker.releaseUpdate(), beforeQuit: () => { quitting = true } })
      void automaticUpdate.check()
      updateTimer = setInterval(() => { void automaticUpdate.check() }, 6 * 60 * 60 * 1000)
      updateTimer.unref()
    }
    catch (error) { automaticUpdate.fail(error) }
  }
}
// Tells the owner once when scheduling has been paused for five minutes, and again when it resumes.
function watchCentral(controller: CentralController): void {
  let alerted = false
  setInterval(() => {
    const status = controller.status()
    const alert = offlineAlert(status, alerted, Date.now())
    if (!alert || !Notification.isSupported()) return
    alerted = alert === 'alert'
    new Notification(alerted
      ? { title: t('Pods scheduling paused'), body: t('The central workspace has been offline for five minutes: {reason}', { reason: status.error ?? t('connecting') }) }
      : { title: t('Pods scheduling resumed'), body: t('This desktop is connected to the central workspace again.') }).show()
  }, 30000).unref()
}
async function shutdown(): Promise<void> {
  clearInterval(updateTimer)
  try { mcpSessions.end(); await codexServer.stop(); await central?.stop(); remote.stop(); await worker.stop(); stopped = true; tray?.destroy(); app.quit() }
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
  void start().catch((error: unknown) => { console.error('Pods startup failed', error); dialog.showErrorBox('OpenApe Pods', `Start fehlgeschlagen / Startup failed:\n${error instanceof Error ? error.message : String(error)}`); app.exit(1) })
}
