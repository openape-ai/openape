// @vitest-environment node
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { channels } from '../../src/contracts/ipc'
import { startMain } from './app-harness'
import type { MainHarness } from './app-harness'

const podId = '00000000-0000-4000-8000-000000000001'
let main: MainHarness | undefined
afterEach(async () => { await main?.close(); main = undefined })

it('retains central authority on ordinary launches once adoption has started', async () => {
  main = await startMain({ OPENAPE_PODS_CENTRAL_ENABLED: '0' }, async (root) => {
    await mkdir(join(root, 'central'))
  })
  expect(await main.invoke(channels.central, { type: 'status' })).toMatchObject({ enabled: true, online: false })
  expect(process.env.OPENAPE_PODS_CENTRAL_ENABLED).toBe('1')
  await main.close()
  main = await startMain({ OPENAPE_PODS_CENTRAL_ENABLED: '0' })
  expect(await main.invoke(channels.central, { type: 'status' })).toMatchObject({ enabled: false })
})

describe('main process owner dialogs', () => {
  it('assigns an HTTP destination only after the owner confirms the native dialog', async () => {
    main = await startMain()
    const permission = { origin: 'https://api.telegram.org', methods: ['POST'] }
    main.dialog.showMessageBox.mockResolvedValueOnce({ response: 0, checkboxChecked: false })
    await main.invoke(channels.resources, { type: 'assignHttp', podId, epoch: 1, permission })
    expect(main.worker.resources).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'assignHttp' }))
    main.dialog.showMessageBox.mockResolvedValueOnce({ response: 1, checkboxChecked: false })
    await main.invoke(channels.resources, { type: 'assignHttp', podId, epoch: 1, permission })
    expect(main.worker.resources).toHaveBeenCalledWith({ type: 'assignHttp', podId, epoch: 1, permission })
    expect(main.dialog.showMessageBox.mock.calls[0]![1]).toMatchObject({ message: 'https://api.telegram.org', buttons: ['Cancel', 'Allow HTTP destination'], cancelId: 0 })
  })

  it('adds an installed program only from the files the owner picks, asking for its descriptor when none is registered', async () => {
    main = await startMain()
    const executable = join(main.root, 'invoice-cli'); const adapter = join(main.root, 'invoice-cli.toml')
    await writeFile(executable, '#!/bin/sh\necho DO_NOT_EXECUTE\nexit 1\n', { mode: 0o700 })
    await writeFile(adapter, 'schema="openape-shapes/v1"\n[cli]\nid="invoice-cli"\nexecutable="invoice-cli"\naudience="shapes"\n[[operation]]\nid="read"\ncommand=["read"]\ndisplay="Read fixture mail"\naction="read"\nrisk="low"\nresource_chain=["fixture:*"]\n')
    main.worker.program.mockImplementation(async (_command: unknown, definition?: { adapterPath?: string }) => { if (!definition?.adapterPath?.endsWith('.toml')) throw new Error('No adapter found for invoice-cli'); return { resources: [], epoch: 2 } })
    await main.invoke(channels.programs, { type: 'add', podId, epoch: 1 })
    expect(main.worker.program).not.toHaveBeenCalled()
    main.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [executable] }).mockResolvedValueOnce({ canceled: true, filePaths: [] })
    await main.invoke(channels.programs, { type: 'add', podId, epoch: 1 })
    expect(main.worker.program.mock.calls.every(([, definition]) => !(definition as { adapterPath?: string }).adapterPath?.endsWith('.toml'))).toBe(true)
    main.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [executable] }).mockResolvedValueOnce({ canceled: false, filePaths: [adapter] })
    await main.invoke(channels.programs, { type: 'add', podId, epoch: 1 })
    expect(main.worker.program).toHaveBeenLastCalledWith({ type: 'add', podId, epoch: 1 }, expect.objectContaining({ name: 'invoice-cli', executable, cliId: 'invoice-cli', adapterPath: adapter }))
    expect(main.execFile).not.toHaveBeenCalled()
  })

  it('assigns a requested folder only with the access the owner confirms, and re-checks the permission revision first', async () => {
    main = await startMain()
    const folder = join(main.root, 'Invoices'); await mkdir(folder)
    main.worker.resources.mockResolvedValue({ resources: [], epoch: 3 })
    await expect(main.invoke(channels.resources, { type: 'reviewDirectory', podId, epoch: 2, path: folder, access: 'readWrite' })).rejects.toThrow('Directory permissions changed')
    expect(main.dialog.showMessageBox).not.toHaveBeenCalled()
    main.dialog.showMessageBox.mockResolvedValueOnce({ response: 0, checkboxChecked: false })
    await main.invoke(channels.resources, { type: 'reviewDirectory', podId, epoch: 3, path: folder, access: 'readWrite' })
    expect(main.worker.resources).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'assignDirectory' }))
    main.dialog.showMessageBox.mockResolvedValueOnce({ response: 1, checkboxChecked: false })
    await main.invoke(channels.resources, { type: 'reviewDirectory', podId, epoch: 3, path: folder, access: 'readWrite' })
    expect(main.worker.resources).toHaveBeenLastCalledWith({ type: 'assignDirectory', podId, epoch: 3, path: folder, access: 'readWrite' })
    expect(main.dialog.showMessageBox.mock.calls.at(-1)![1]).toMatchObject({ message: folder, buttons: ['Cancel', 'Read and write'] })
  })

  it('opens Terminal.app only with the launcher the worker prepared, and never when preparation fails', async () => {
    main = await startMain()
    main.worker.program.mockRejectedValueOnce(new Error('Sign in with your DDISA account before setting up a pod'))
    await expect(main.invoke(channels.programs, { type: 'openShell', podId })).rejects.toThrow('DDISA')
    expect(main.execFile).not.toHaveBeenCalled()
    main.worker.program.mockResolvedValueOnce('/fixture/shell-launchers/pod/open-terminal.command')
    await main.invoke(channels.programs, { type: 'openShell', podId })
    expect(main.execFile).toHaveBeenCalledOnce()
    expect(main.execFile.mock.calls[0]!.slice(0, 2)).toEqual(['/usr/bin/open', ['-a', '/System/Applications/Utilities/Terminal.app', '/fixture/shell-launchers/pod/open-terminal.command']])
  })

  it('releases the prepared terminal when Terminal.app cannot be opened', async () => {
    main = await startMain()
    main.worker.program.mockResolvedValueOnce('/fixture/shell-launchers/pod/open-terminal.command')
    main.execFile.mockImplementationOnce((_file: string, _args: string[], callback: (error: Error | null) => void) => callback(new Error('open failed')))
    await expect(main.invoke(channels.programs, { type: 'openShell', podId })).rejects.toThrow('open failed')
    expect(main.worker.cancelProgram).toHaveBeenCalledWith(podId)
  })

  it('prepares script dependencies only after the owner confirms the listed packages', async () => {
    main = await startMain()
    const draftId = '00000000-0000-4000-8000-000000000061'
    main.worker.scripts.mockImplementation(async () => ({ pod: { id: podId, revision: 1 }, source: { revision: 2, packages: { dependencies: { 'sample-package': '1.0.0' } } } }))
    const command = { type: 'prepareDependencies', podId, revision: 1, draftId, draftRevision: 2 }
    main.dialog.showMessageBox.mockResolvedValueOnce({ response: 0, checkboxChecked: false })
    await main.invoke(channels.scripts, command)
    expect(main.worker.scripts).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'prepareDependencies' }))
    expect(main.dialog.showMessageBox.mock.calls[0]![1]).toMatchObject({ detail: expect.stringContaining('sample-package@1.0.0'), cancelId: 0 })
    main.dialog.showMessageBox.mockResolvedValueOnce({ response: 1, checkboxChecked: false })
    await main.invoke(channels.scripts, command)
    expect(main.worker.scripts).toHaveBeenLastCalledWith(command)
  })
})

describe('main process menus', () => {
  interface Item { id?: string, label?: string, submenu?: Item[], click?: () => void }
  const items = (menu: Item[]) => menu.flatMap(item => [item, ...(item.submenu ?? [])])

  it('offers problem reporting only after opt-in and opens only the fixed product URL', async () => {
    main = await startMain()
    expect(items(main.menu() as Item[]).some(item => item.id === 'report-problem')).toBe(false)
    await main.close()
    main = await startMain({ OPENAPE_PODS_ISSUE_REPORTING_ENABLED: '1' })
    const report = items(main.menu() as Item[]).find(item => item.id === 'report-problem')!
    report.click!()
    expect(main.shell.openExternal).toHaveBeenCalledExactlyOnceWith('https://repos.openape.ai/report?product=pods')
  })

  it('rebuilds native menus and dialogs in German after a language switch', async () => {
    main = await startMain()
    await main.invoke(channels.language, { type: 'set', language: 'de' })
    const menu = main.menu() as Item[]
    expect(menu.map(item => item.label)).toEqual(['OpenApe Pods', 'Bearbeiten', 'Fenster'])
    expect(menu[0]!.submenu!.map(item => item.label)).toContain('Pods beenden')
    main.worker.data.mockResolvedValue({ usedBytes: 0, freeBytes: 1, limitBytes: 1, pendingDeletion: 0, busy: false, error: null })
    await main.invoke(channels.data, { type: 'deletePod', podId, revision: 1, name: 'Order review' })
    expect(main.dialog.showMessageBox.mock.calls[0]![1]).toMatchObject({ title: 'Lokalen Pod löschen', buttons: ['Abbrechen', 'Lokalen Pod löschen'] })
  })
})

it('forwards macOS suspend and resume to the worker', async () => {
  main = await startMain()
  main.power('suspend'); main.power('resume')
  expect(main.worker.lifecycle.mock.calls).toEqual([['suspend'], ['resume']])
})
