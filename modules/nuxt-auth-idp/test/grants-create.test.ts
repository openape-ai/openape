import { computeArgvHash, computeCmdHash } from '@openape/core'
import { InMemoryGrantStore } from '@openape/grants'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const readBodyMock = vi.fn()
const setResponseStatusMock = vi.fn()
let grantStore = new InMemoryGrantStore()

vi.mock('h3', () => ({
  defineEventHandler: (fn: any) => fn,
  readBody: (...args: any[]) => readBodyMock(...args),
  setResponseStatus: (...args: any[]) => setResponseStatusMock(...args),
  createError: (opts: any) => Object.assign(new Error(opts.statusMessage), { statusCode: opts.statusCode, data: opts.data }),
}))

vi.mock('../src/runtime/server/utils/agent-auth', () => ({
  tryAgentAuth: vi.fn(async () => null),
}))

vi.mock('../src/runtime/server/utils/grant-stores', () => ({
  useGrantStores: () => ({
    grantStore,
  }),
}))

function shapesDetail(permission = 'gh.owner[login=openape].repo[*]#list') {
  return {
    type: 'openape_cli' as const,
    cli_id: 'gh',
    operation_id: 'repo.list',
    resource_chain: [
      { resource: 'owner', selector: { login: 'openape' } },
      { resource: 'repo' },
    ],
    action: 'list',
    permission,
    display: 'List repositories for owner openape',
    risk: 'low' as const,
  }
}

describe('grant create endpoint', () => {
  beforeEach(() => {
    readBodyMock.mockReset()
    setResponseStatusMock.mockReset()
    grantStore = new InMemoryGrantStore()
  })

  it('creates a shapes grant and canonicalizes execution fields', async () => {
    readBodyMock.mockResolvedValue({
      requester: 'agent@example.com',
      target_host: 'macmini',
      audience: 'shapes',
      grant_type: 'once',
      authorization_details: [shapesDetail()],
      execution_context: {
        argv: ['gh', 'repo', 'list', 'openape'],
        argv_hash: 'SHA-256:deadbeef',
        adapter_id: 'gh',
        adapter_version: '1',
        adapter_digest: 'SHA-256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        resolved_executable: 'gh',
      },
    })

    const { default: handler } = await import('../src/runtime/server/api/grants/index.post')
    const result = await handler({} as any)

    expect(setResponseStatusMock).toHaveBeenCalledWith(expect.anything(), 201)
    expect(result.request.permissions).toEqual(['gh.owner[login=openape].repo[*]#list'])
    expect(result.request.command).toEqual(['gh', 'repo', 'list', 'openape'])
    expect(result.request.execution_context.argv_hash).toBe(await computeArgvHash(['gh', 'repo', 'list', 'openape']))
    expect(result.request.cmd_hash).toBe(await computeCmdHash('gh repo list openape'))
  })

  it('rejects invalid canonical CLI permission strings', async () => {
    readBodyMock.mockResolvedValue({
      requester: 'agent@example.com',
      target_host: 'macmini',
      audience: 'shapes',
      grant_type: 'once',
      authorization_details: [shapesDetail('wrong.permission')],
    })

    const { default: handler } = await import('../src/runtime/server/api/grants/index.post')
    await expect(handler({} as any)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('reuses an existing approved reusable shapes grant when details and adapter digest match', async () => {
    await grantStore.save({
      id: 'existing-grant',
      status: 'approved',
      created_at: Math.floor(Date.now() / 1000),
      decided_at: Math.floor(Date.now() / 1000),
      request: {
        requester: 'agent@example.com',
        target_host: 'macmini',
        audience: 'shapes',
        grant_type: 'always',
        permissions: ['gh.owner[login=openape].repo[*]#list'],
        authorization_details: [shapesDetail()],
        execution_context: {
          argv: ['gh', 'repo', 'list', 'openape'],
          argv_hash: await computeArgvHash(['gh', 'repo', 'list', 'openape']),
          adapter_id: 'gh',
          adapter_version: '1',
          adapter_digest: 'SHA-256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          resolved_executable: 'gh',
        },
        cmd_hash: await computeCmdHash('gh repo list openape'),
      },
    } as any)

    readBodyMock.mockResolvedValue({
      requester: 'agent@example.com',
      target_host: 'macmini',
      audience: 'shapes',
      grant_type: 'always',
      authorization_details: [shapesDetail()],
      execution_context: {
        argv: ['gh', 'repo', 'list', 'openape'],
        argv_hash: 'SHA-256:deadbeef',
        adapter_id: 'gh',
        adapter_version: '1',
        adapter_digest: 'SHA-256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        resolved_executable: 'gh',
      },
    })

    const { default: handler } = await import('../src/runtime/server/api/grants/index.post')
    const result = await handler({} as any)

    expect(result.id).toBe('existing-grant')
    expect(setResponseStatusMock).not.toHaveBeenCalled()
  })
})
