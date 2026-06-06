import { describe, expect, it, vi } from 'vitest'
import {
  AGENT_NAME_REGEX,
  buildAgentAuthJson,
  buildSpawnSetupScript,
  CLAUDE_SETTINGS_JSON,
  issueAgentToken,
  registerAgentAtIdp,
  shQuote,
  SSH_ED25519_REGEX,
} from '../src/lib/agent-bootstrap'

vi.mock('../src/http.js', () => ({
  apiFetch: vi.fn(),
  getAgentChallengeEndpoint: vi.fn(async (idp: string) => `${idp}/api/agent/challenge`),
  getAgentAuthenticateEndpoint: vi.fn(async (idp: string) => `${idp}/api/agent/authenticate`),
}))

describe('AGENT_NAME_REGEX', () => {
  it.each([
    ['agent-a', true],
    ['a', true],
    ['agent-1', true],
    ['ABC', false],
    ['1agent', false],
    ['-leading', false],
    [`too-long-${'x'.repeat(50)}`, false],
    ['has space', false],
    ['', false],
  ])('matches %s -> %s', (name, expected) => {
    expect(AGENT_NAME_REGEX.test(name)).toBe(expected)
  })
})

describe('SSH_ED25519_REGEX', () => {
  it('accepts a typical key with comment', () => {
    expect(SSH_ED25519_REGEX.test('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBz1WSDX me@host')).toBe(true)
  })
  it('accepts a key without comment', () => {
    expect(SSH_ED25519_REGEX.test('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBz1WSDX')).toBe(true)
  })
  it('rejects rsa', () => {
    expect(SSH_ED25519_REGEX.test('ssh-rsa AAAA')).toBe(false)
  })
  it('rejects empty', () => {
    expect(SSH_ED25519_REGEX.test('')).toBe(false)
  })
})

describe('shQuote', () => {
  it('wraps simple strings', () => {
    expect(shQuote('agent-a')).toBe(`'agent-a'`)
  })
  it('escapes embedded single quotes', () => {
    expect(shQuote(`it's`)).toBe(`'it'\\''s'`)
  })
})

describe('buildAgentAuthJson', () => {
  it('emits a stable, parseable auth.json with key_path + owner_email', () => {
    const out = buildAgentAuthJson({
      idp: 'https://id.openape.ai',
      accessToken: 'tok',
      email: 'agent-a+patrick+hofmann_eco@id.openape.ai',
      expiresAt: 1234567890,
      keyPath: '/Users/agent-a/.ssh/id_ed25519',
      ownerEmail: 'patrick@hofmann.eco',
    })
    const parsed = JSON.parse(out)
    expect(parsed).toEqual({
      idp: 'https://id.openape.ai',
      access_token: 'tok',
      email: 'agent-a+patrick+hofmann_eco@id.openape.ai',
      expires_at: 1234567890,
      // key_path lets cli-auth refresh in-process via challenge-response
      // (#259) — without this the daemon would crash-restart hourly.
      key_path: '/Users/agent-a/.ssh/id_ed25519',
      // owner_email backs the contact handshake — see #257.
      owner_email: 'patrick@hofmann.eco',
    })
    expect(out.endsWith('\n')).toBe(true)
  })
})

describe('CLAUDE_SETTINGS_JSON', () => {
  it('registers a Bash PreToolUse hook pointing at the bundled script path', () => {
    const parsed = JSON.parse(CLAUDE_SETTINGS_JSON)
    const matchers = parsed.hooks.PreToolUse
    expect(matchers).toHaveLength(1)
    expect(matchers[0].matcher).toBe('Bash')
    expect(matchers[0].hooks[0].command).toBe('$HOME/.claude/hooks/bash-via-ape-shell.sh')
  })
})

describe('buildSpawnSetupScript (linux)', () => {
  const baseInput = {
    name: 'coder',
    homeDir: '/var/lib/openape/homes/coder',
    shellPath: '/bin/bash',
    privateKeyPem: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n',
    publicKeySshLine: 'ssh-ed25519 AAAAFAKE',
    x25519PrivateKey: 'PRIVB64',
    x25519PublicKey: 'PUBB64',
    authJson: '{"idp":"https://id.openape.ai"}\n',
    claudeSettingsJson: null,
    hookScriptSource: null,
  }

  it('creates the agent user via useradd, not dscl', () => {
    const s = buildSpawnSetupScript(baseInput)
    expect(s).toContain('useradd --create-home --home-dir "$HOME_DIR" --shell "$SHELL_PATH" --comment "OpenApe Agent $NAME" "$NAME"')
    expect(s).not.toContain('dscl')
    expect(s).not.toContain('launchctl')
    expect(s).not.toContain('NFSHomeDirectory')
    expect(s).not.toContain('Library/Application Support')
  })

  it('guards user creation behind a getent existence check (idempotent)', () => {
    const s = buildSpawnSetupScript(baseInput)
    expect(s).toContain('if ! getent passwd "$NAME" >/dev/null 2>&1; then')
  })

  it('writes the identity files and locks down perms', () => {
    const s = buildSpawnSetupScript(baseInput)
    expect(s).toContain('"$HOME_DIR/.ssh/id_ed25519"')
    expect(s).toContain('"$HOME_DIR/.config/apes/auth.json"')
    expect(s).toContain('"$HOME_DIR/.config/openape/agent-x25519.key"')
    expect(s).toContain('chmod 600 "$HOME_DIR/.ssh/id_ed25519"')
    expect(s).toContain('chown -R "$NAME:" "$HOME_DIR"')
  })

  it('creates the agent-sync task dir under ~/.openape (not ~/Library)', () => {
    const s = buildSpawnSetupScript(baseInput)
    expect(s).toContain('mkdir -p "$HOME_DIR/.openape/agent/tasks"')
  })

  it('includes the claude hook + settings only when provided', () => {
    const withHook = buildSpawnSetupScript({
      ...baseInput,
      claudeSettingsJson: '{"hooks":{}}',
      hookScriptSource: '#!/bin/bash\necho hi\n',
    })
    expect(withHook).toContain('.claude/settings.json')
    expect(withHook).toContain('.claude/hooks/bash-via-ape-shell.sh')
  })

  it('never provisions a Claude OAuth token (subscription-first; removed in M4)', () => {
    const s = buildSpawnSetupScript({ ...baseInput, claudeSettingsJson: '{"hooks":{}}', hookScriptSource: '#!/bin/bash\n' })
    expect(s).not.toContain('CLAUDE_CODE_OAUTH_TOKEN')
    expect(s).not.toContain('claude-token.env')
  })
})

describe('registerAgentAtIdp', () => {
  it('POSTs to /api/enroll with name + publicKey and returns the IdP response', async () => {
    const http = await import('../src/http.js')
    ;(http.apiFetch as any).mockResolvedValue({
      email: 'agent-a+patrick+hofmann_eco@id.openape.ai',
      name: 'agent-a',
      owner: 'patrick@hofmann.eco',
      approver: 'patrick@hofmann.eco',
      status: 'active',
    })

    const result = await registerAgentAtIdp({
      name: 'agent-a',
      publicKey: 'ssh-ed25519 AAAA...',
      idp: 'https://id.openape.ai',
    })
    expect(http.apiFetch).toHaveBeenCalledWith('/api/enroll', {
      method: 'POST',
      body: { name: 'agent-a', publicKey: 'ssh-ed25519 AAAA...' },
      idp: 'https://id.openape.ai',
    })
    expect(result.email).toBe('agent-a+patrick+hofmann_eco@id.openape.ai')
  })
})

describe('issueAgentToken', () => {
  it('sends the canonical `id` field (not legacy agent_id) to challenge + authenticate', async () => {
    const { generateKeyPairSync } = await import('node:crypto')
    const { privateKey } = generateKeyPairSync('ed25519')
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string

    const calls: Array<{ url: string, body: any }> = []
    const fetchMock = vi.fn(async (url: string, init: any) => {
      calls.push({ url, body: JSON.parse(init.body) })
      if (url.endsWith('/challenge')) {
        return { ok: true, json: async () => ({ challenge: 'a-challenge-string' }) } as any
      }
      return { ok: true, json: async () => ({ token: 'tok', expires_in: 3600 }) } as any
    })
    vi.stubGlobal('fetch', fetchMock)

    try {
      const res = await issueAgentToken({
        idp: 'https://id.openape.ai',
        agentEmail: 'agent-a@id.openape.ai',
        privateKeyPem: pem,
      })
      expect(res).toEqual({ token: 'tok', expiresIn: 3600 })

      // The M3 canonical endpoints expect `id`; the legacy `agent_id`
      // field name must never be sent (that was the spawn-time 400).
      expect(calls[0]!.body).toEqual({ id: 'agent-a@id.openape.ai' })
      expect(calls[1]!.body).toMatchObject({ id: 'agent-a@id.openape.ai', challenge: 'a-challenge-string' })
      expect(calls[1]!.body).not.toHaveProperty('agent_id')
      expect(typeof calls[1]!.body.signature).toBe('string')
    }
    finally {
      vi.unstubAllGlobals()
    }
  })
})
