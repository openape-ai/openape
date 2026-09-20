import { RemoteController } from './remote/controller'
import { parseChatsCommand } from '../contracts/chats'
import { parseWorkflowCommand } from '../contracts/workflows'
import { searchPackages } from './package-catalog'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parseProgramCommand } from '../contracts/programs'
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
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, powerMonitor, protocol, session, shell, Tray } from 'electron'
import { mkdir, readFile, realpath } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { parseCommand } from '../contracts/control'
import { channels } from '../contracts/ipc'
import type { PodStatus } from '../contracts/ipc'
import { fixtureDirectory, localDirectory } from './fixture'
import { assertStatusRequest, assetPath, contentSecurityPolicy, rendererURL, rendererStyleNonce } from './security'
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
let preference: LanguagePreference
function t(key: MessageKey, parameters?: Parameters): string { return translate(preference.language, key, parameters) }
const status: PodStatus = { version: 1, mode: fixture ? 'fixture' : 'local', executionEnabled: true, worker: { state: 'starting', pid: null, error: null }, runtime: { electron: process.versions.electron, node: process.versions.node } }
let remote: RemoteController
const worker = new FixtureWorker((next) => {
  status.worker = next
  if (next.state === 'ready' && process.env.OPENAPE_PODS_REMOTE_ENABLED === '1') void remote.resume().catch((error: unknown) => { remote.error = error instanceof Error ? error.message : 'Remote access unavailable' })
  if (window && !window.isDestroyed()) window.webContents.send(channels.changed, status)
})
remote = new RemoteController(root, worker)
async function manageRemote(): Promise<void> {
  if (!window) return
  const action = await dialog.showMessageBox(window, { title: t('Mobile access'), message: t('OpenApe Pods on iPhone and iPad'), detail: translateDiagnostic(preference.language, remote.error) || t('Execution and credentials stay on this desktop. Mobile devices must be paired here before accessing Pods.'), buttons: [t('Cancel'), t('Register desktop'), t('Pair mobile device'), t('Disable mobile access'), t('Offer installed CLI'), t('Withdraw offered CLI'), t('Remove paired device')], defaultId: 0, cancelId: 0 })
  if (action.response === 1) { await remote.enable(await worker.remoteOwner()); return }
  if (action.response === 3) { await remote.disable(); return }
  if (action.response === 4) {
    const selected = await dialog.showOpenDialog(window, { title: t('Choose an installed application or CLI'), properties: ['openFile'] })
    if (selected.canceled || selected.filePaths.length !== 1) return
    const descriptor = await dialog.showOpenDialog(window, { title: t('Choose its apes command descriptor'), properties: ['openFile'], filters: [{ name: 'apes', extensions: ['toml'] }] })
    if (descriptor.canceled || descriptor.filePaths.length !== 1) return
    const definition = await programDefinition(selected.filePaths[0], descriptor.filePaths[0])
    const confirm = await dialog.showMessageBox(window, { title: t('Offer program to paired devices'), message: definition.name, detail: `${definition.executable}\nSHA-256: ${definition.executableHash}\n\n${t('Paired devices can review assignment to your Pods. Execution still requires existing grant checks.')}`, buttons: [t('Cancel'), t('Offer for review')], defaultId: 0, cancelId: 0 })
    if (confirm.response === 1) await worker.remote({ type: 'offerProgram', definition })
    return
  }
  if (action.response === 5) {
    const offered = await worker.remote({ type: 'programs' }) as { id: string, program: { name: string, executable: string } }[]
    for (const item of offered) {
      const confirm = await dialog.showMessageBox(window, { title: t('Withdraw program offer'), message: item.program.name, detail: `${item.program.executable}\n\n${t('This prevents new mobile assignments. Review existing Pod permissions separately.')}`, buttons: [t('Keep'), t('Withdraw offer')], defaultId: 0, cancelId: 0 })
      if (confirm.response === 1) await worker.remote({ type: 'revokeProgram', id: item.id })
    }
    return
  }
  if (action.response === 6) {
    for (const device of await remote.pairedDevices()) {
      const confirm = await dialog.showMessageBox(window, { title: t('Remove paired device'), message: device.id, detail: t('This device can no longer access this desktop. Authorized runs already started continue; cancel them separately.'), buttons: [t('Keep'), t('Remove pairing')], defaultId: 0, cancelId: 0 })
      if (confirm.response === 1) await remote.unpair(device.id)
    }
    return
  }
  if (action.response !== 2) return
  const candidates = remote.devices()
  if (!candidates.length) throw new Error('Sign in on your iPhone or iPad with the same owner first')
  for (const candidate of candidates) {
    const result = await dialog.showMessageBox(window, { title: t('Pair mobile device'), message: candidate.code, detail: `${t('Confirm only if this exact code appears in the app on your device.')}\n${t('Device: {id}', { id: candidate.device.id })}\n${t('Owner: {subject}', { subject: candidate.device.owner.subject })}`, buttons: [t('Skip'), t('Codes match — pair device')], defaultId: 0, cancelId: 0 })
    if (result.response === 1) await remote.pair(candidate.device)
  }
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
  view.once('ready-to-show', () => view.show())
  view.webContents.on('render-process-gone', (_event, details) => { console.error('Pods renderer stopped', details.reason); app.quit() })
  void view.loadURL(rendererURL).catch((error: unknown) => { console.error('Pods UI failed to load', error); app.quit() })
  return view
}
function updateMenus(): void {
  tray?.setToolTip(fixture ? t('OpenApe Pods · Fixture mode') : 'OpenApe Pods')
  tray?.setContextMenu(Menu.buildFromTemplate([{ label: t('Open Pods'), click: showWindow }, { label: t('Pause automatic runs'), click: () => { void worker.request({ type: 'pauseAll' }).catch((error: unknown) => dialog.showErrorBox(t('Could not pause Pods'), translateDiagnostic(preference.language, error instanceof Error ? error.message : 'Worker unavailable'))) } }, { label: t('Quit Pods'), click: () => app.quit() }]))
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'OpenApe Pods', submenu: [{ label: t('Open Pods'), click: showWindow }, ...(process.env.OPENAPE_PODS_REMOTE_ENABLED === '1' ? [{ label: t('Mobile access…'), click: () => { void manageRemote().catch((error: unknown) => dialog.showErrorBox(t('Mobile access'), translateDiagnostic(preference.language, error instanceof Error ? error.message : 'Remote access failed'))) } }] : []), { label: t('Quit Pods'), role: 'quit' }] }, { label: t('Edit'), submenu: [{ label: t('Undo'), role: 'undo' }, { label: t('Redo'), role: 'redo' }, { type: 'separator' }, { label: t('Cut'), role: 'cut' }, { label: t('Copy'), role: 'copy' }, { label: t('Paste'), role: 'paste' }, { label: t('Paste and match style'), role: 'pasteAndMatchStyle' }, { label: t('Delete'), role: 'delete' }, { label: t('Select all'), role: 'selectAll' }] }, { label: t('Window'), submenu: [{ label: t('Minimize'), role: 'minimize' }, { label: t('Close window'), role: 'close' }] }, ...(process.env.OPENAPE_PODS_ISSUE_REPORTING_ENABLED === '1' ? [{ label: t('Help'), submenu: [{ id: 'report-problem', label: t('Report a problem'), click: () => { void shell.openExternal('https://repos.openape.ai/report?product=pods').catch((error: unknown) => dialog.showErrorBox(t('Could not open issue reporting'), translateDiagnostic(preference.language, error instanceof Error ? error.message : 'Browser unavailable'))) } }] }] : [])]))
}
async function start(): Promise<void> {
  await app.whenReady()
  preference = new LanguagePreference(root, fixture ? 'en' : app.getPreferredSystemLanguages()[0] ?? app.getLocale())
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
    if (command.type === 'grant') {
      const resolved = await worker.programPreview(command)
      const answer = await dialog.showMessageBox(window, { type: 'question', title: t('Allow application command'), message: resolved.detail.display, detail: t('Permission: {permission}\n\nThis permission is assigned to this pod’s OpenApe agent. The pod stays paused.', { permission: resolved.permission }), buttons: [t('Cancel'), t('Allow command')], defaultId: 0, cancelId: 0 })
      if (answer.response !== 1) return unchanged()
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
    return worker.onboarding(command)
  })
  ipcMain.handle(channels.chats, (event, command: unknown, ...extra: unknown[]) => {
    assertStatusRequest(!!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererURL, extra)
    return worker.chats(parseChatsCommand(command))
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
  ipcMain.handle(channels.workspace, (event, command: unknown, ...extra: unknown[]) => {
    assertStatusRequest(!!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererURL, extra)
    return worker.request(parseCommand(command))
  })
  ipcMain.handle(channels.workflows, (event, command: unknown, ...extra: unknown[]) => {
    assertStatusRequest(!!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererURL, extra)
    return worker.workflows(parseWorkflowCommand(command))
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
  ipcMain.handle(channels.resources, async (event, value: unknown, ...extra: unknown[]) => {
    assertStatusRequest(!!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererURL, extra)
    const command = parseResourceCommand(value)
    if (command.type === 'assignHttp') {
      if (!window) throw new Error('Owner window is unavailable')
      const answer = await dialog.showMessageBox(window, { type: 'question', title: t('Allow HTTP destination'), message: command.permission.origin, detail: t('Allowed methods: {methods}\n\nScripts with this permission can send data to this destination. Token values remain in Variables and secrets. The pod stays paused.', { methods: command.permission.methods.join(', ') }), buttons: [t('Cancel'), t('Allow HTTP destination')], defaultId: 0, cancelId: 0 })
      if (answer.response !== 1) return worker.resources({ type: 'list', podId: command.podId })
    }
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
}
async function shutdown(): Promise<void> {
  try { await remote.stop(); await worker.stop(); stopped = true; tray?.destroy(); app.quit() }
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
