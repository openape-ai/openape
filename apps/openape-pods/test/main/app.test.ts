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
})
