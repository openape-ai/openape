import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { prepareConsole, podWorkspace } from '../../src/main/programs/console'
import type { ResourceState } from '../../src/contracts/resources'

const podId = '00000000-0000-4000-8000-000000000001'
const applicationId = '00000000-0000-4000-8000-000000000002'
// Issue 1473, revision 4: a terminal line maps to an assigned application and its exact argv; the IdP decides it at start.
it('maps a complete command to its application without resolving it, lists applications and never executes help', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pods-console-'))
  const state: ResourceState = { epoch: 2, resources: [{ id: applicationId, podId, kind: 'tool', state: 'ready', name: 'Office', revision: 1, configuration: { type: 'program', cliId: 'o365-cli', executable: '/fixture/o365-cli', executableHash: 'a'.repeat(64) } }] }
  try {
    const prepared = await prepareConsole(root, podId, state, 'o365-cli login --account user@example.test')
    expect(prepared).toMatchObject({ command: { type: 'start', podId, applicationId, epoch: 2, argv: ['login', '--account', 'user@example.test'] }, needsGrant: false, permission: null })
    const help = await prepareConsole(root, podId, state, 'help')
    expect(help.command).toBeNull(); expect(help.output).toBe('o365-cli')
    const bare = await prepareConsole(root, podId, state, 'o365-cli')
    expect(bare.command).toBeNull(); expect(bare.output).toContain('o365-cli --help')
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
