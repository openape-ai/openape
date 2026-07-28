import { describe, expect, it } from 'vitest'
import {
  makeDocsCommand,
  makeLoginCommand,
  makeLogoutCommand,
  makeWhoamiCommand,
} from '../src/index'

const d = {
  name: 'tasks',
  endpoint: 'https://tasks.openape.ai',
  envVar: 'APE_TASKS_ENDPOINT',
  aud: 'tasks.openape.ai',
  configFile: 'auth-tasks.json',
} as const

// A minimal SpClient stand-in — the builders only read resolveEndpoint/apiCall.
const fakeClient = {
  configPath: '',
  resolveEndpoint: (o?: string | null) => o ?? d.endpoint,
  loadConfig: () => ({}),
  saveConfig: () => {},
  apiCall: async () => ({}),
  _request: async () => ({}),
} as any

describe('proof-cli command builders', () => {
  it('interpolate the app name into shared command meta', () => {
    expect(makeLoginCommand(d).meta).toMatchObject({ name: 'login' })

    const logout = makeLogoutCommand(d, fakeClient)
    expect((logout.meta as any).description).toContain('tasks SP-token')

    const whoami = makeWhoamiCommand(d, fakeClient)
    expect((whoami.meta as any).name).toBe('whoami')
    // drift bug from the donor is gone: arg help names the right app
    expect((whoami.args as any).endpoint.description).toBe('Override tasks endpoint.')
  })

  it('docs builds its topic list + description from the passed map', () => {
    const docs = makeDocsCommand(d, { cli: '# cli', agent: '# agent' })
    expect((docs.meta as any).description).toBe('Print documentation. Topics: agent, cli.')
  })
})
