import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { prepareConsole, podWorkspace } from '../../src/main/programs/console'
import type { ResourceState } from '../../src/contracts/resources'

const podId = '00000000-0000-4000-8000-000000000001'
const applicationId = '00000000-0000-4000-8000-000000000002'
it('accepts a complete command once, provides bare-CLI help and never executes help', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pods-console-'))
  const adapterPath = join(root, 'adapter.toml')
  const source = 'schema="openape-shapes/v1"\n[cli]\nid="o365-cli"\nexecutable="o365-cli"\naudience="shapes"\n[[operation]]\nid="setup"\ncommand=["login"]\nrequired_options=["account"]\ndisplay="Set up {account}"\naction="login"\nrisk="medium"\nresource_chain=["account:email={account}"]\n'
  await writeFile(adapterPath, source)
  const state: ResourceState = { epoch: 2, resources: [{ id: applicationId, podId, kind: 'tool', state: 'ready', name: 'Office', revision: 1, configuration: { type: 'program', cliId: 'o365-cli', adapterPath, adapterHash: createHash('sha256').update(source).digest('hex'), grants: [] } }] }
  try {
    const prepared = await prepareConsole(root, podId, state, 'o365-cli login --account user@example.test')
    expect(prepared.command).toEqual({ type: 'start', podId, applicationId, epoch: 2, argv: ['login', '--account', 'user@example.test'] })
    expect(prepared.needsGrant).toBe(true)
    const help = await prepareConsole(root, podId, state, 'o365-cli')
    expect(help.command).toBeNull(); expect(help.output).toContain('o365-cli login --account <account>')
    expect((await prepareConsole(root, podId, state, 'pwd')).output).toBe(await podWorkspace(root, podId))
    for (const command of ['zsh', '/bin/sh', 'o365-cli login; touch /tmp/bad', 'o365-cli $(whoami)']) await expect(prepareConsole(root, podId, state, command)).rejects.toThrow()
    const duplicate = structuredClone(state); duplicate.resources.push({ ...duplicate.resources[0]!, id: '00000000-0000-4000-8000-000000000003' })
    await expect(prepareConsole(root, podId, duplicate, 'o365-cli login')).rejects.toThrow('ambiguous')
    state.resources[0]!.state = 'revoked'
    await expect(prepareConsole(root, podId, state, 'o365-cli')).rejects.toThrow('not assigned')
  }
  finally { await rm(root, { recursive: true, force: true }) }
})
it('refuses a workspace redirected outside the pod through a symlink', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pods-console-link-'))
  try {
    await mkdir(join(root, 'elsewhere')); await mkdir(join(root, 'pods', podId), { recursive: true })
    await symlink(join(root, 'elsewhere'), join(root, 'pods', podId, 'workspace'))
    await expect(podWorkspace(root, podId)).rejects.toThrow('symbolic')
  }
  finally { await rm(root, { recursive: true, force: true }) }
})
