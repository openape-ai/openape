import { describe, expect, it, vi } from 'vitest'
import {
  AGENT_NAME_REGEX,
  buildAgentAuthJson,
  buildDestroyTeardownScript,
  buildSpawnSetupScript,
  CLAUDE_SETTINGS_JSON,
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

describe('buildSpawnSetupScript', () => {
  const baseInput = {
    name: 'agent-a',
    macOSUsername: 'openape-agent-agent-a',
    homeDir: '/var/openape/homes/openape-agent-agent-a',
    shellPath: '/usr/local/bin/ape-shell',
    privateKeyPem: '-----BEGIN PRIVATE KEY-----\nDEADBEEF\n-----END PRIVATE KEY-----\n',
    publicKeySshLine: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBz1WSDX',
    authJson: '{"idp":"https://id.openape.ai"}\n',
  }

  it('with claude hook: includes settings.json + hook script blocks', () => {
    const script = buildSpawnSetupScript({
      ...baseInput,
      claudeSettingsJson: CLAUDE_SETTINGS_JSON,
      hookScriptSource: '#!/bin/bash\necho hi\n',
      claudeOauthToken: null,
    })
    expect(script).toContain(`NAME='agent-a'`)
    expect(script).toContain(`MACOS_USER='openape-agent-agent-a'`)
    expect(script).toContain(`HOME_DIR='/var/openape/homes/openape-agent-agent-a'`)
    expect(script).toContain(`SHELL_PATH='/usr/local/bin/ape-shell'`)
    expect(script).toContain('dscl . -create "/Users/$MACOS_USER" UserShell "$SHELL_PATH"')
    expect(script).toContain('mkdir -p "$HOME_DIR/.claude/hooks"')
    expect(script).toContain('chown -R "$MACOS_USER:staff" "$HOME_DIR"')
    expect(script).toContain('chmod 600 "$HOME_DIR/.config/apes/auth.json"')
    expect(script).toMatch(/refusing to overwrite/i)
    expect(script).toContain('IsHidden 1')
  })

  it('without claude hook: no .claude blocks', () => {
    const script = buildSpawnSetupScript({
      ...baseInput,
      claudeSettingsJson: null,
      hookScriptSource: null,
      claudeOauthToken: null,
    })
    expect(script).not.toContain('.claude')
  })

  it('with claude OAuth token: writes env file + sources from .zshenv and .profile', () => {
    const token = 'sk-ant-oat01-FAKE_TOKEN_FOR_TESTING'
    const script = buildSpawnSetupScript({
      ...baseInput,
      claudeSettingsJson: null,
      hookScriptSource: null,
      claudeOauthToken: token,
    })
    expect(script).toContain('mkdir -p "$HOME_DIR/.config/openape"')
    expect(script).toContain('cat > "$HOME_DIR/.config/openape/claude-token.env"')
    expect(script).toContain(`export CLAUDE_CODE_OAUTH_TOKEN=${`'${token}'`}`)
    expect(script).toContain('chmod 600 "$HOME_DIR/.config/openape/claude-token.env"')
    expect(script).toContain('"$HOME_DIR/.zshenv"')
    expect(script).toContain('"$HOME_DIR/.profile"')
    expect(script).toContain('config/openape/claude-token.env')
  })

  it('without claude OAuth token: no env file write or rc additions', () => {
    const script = buildSpawnSetupScript({
      ...baseInput,
      claudeSettingsJson: null,
      hookScriptSource: null,
      claudeOauthToken: null,
    })
    expect(script).not.toContain('CLAUDE_CODE_OAUTH_TOKEN')
    expect(script).not.toContain('cat > "$HOME_DIR/.config/openape/claude-token.env"')
    expect(script).not.toMatch(/touch "\$HOME_DIR\/\.zshenv"/)
  })

  it('refuses inputs that collide with the heredoc delimiter', () => {
    expect(() => buildSpawnSetupScript({
      ...baseInput,
      privateKeyPem: 'APES_HEREDOC_END pwned',
      claudeSettingsJson: null,
      hookScriptSource: null,
      claudeOauthToken: null,
    })).toThrow(/Refusing to emit heredoc/)
  })
})

describe('buildDestroyTeardownScript', () => {
  it('produces a script that deletes the user and home dir', () => {
    const script = buildDestroyTeardownScript({ name: 'agent-a', homeDir: '/Users/agent-a', adminUser: 'patrickhofmann' })
    expect(script).toContain(`NAME='agent-a'`)
    expect(script).toContain(`HOME_DIR='/Users/agent-a'`)
    expect(script).toContain(`ADMIN_USER='patrickhofmann'`)
    expect(script).toContain('launchctl bootout "user/$UID_OF"')
    expect(script).toContain('pkill -9 -u "$UID_OF"')
    expect(script).toContain('rm -rf "$HOME_DIR"')
    expect(script).toContain('sysadminctl \\')
    expect(script).toContain('-deleteUser "$NAME"')
    expect(script).toContain('-adminUser "$ADMIN_USER"')
    expect(script).toContain('-adminPassword "$ADMIN_PASSWORD"')
  })

  it('reads the admin password from stdin (never as argv) and unsets it after use', () => {
    const script = buildDestroyTeardownScript({ name: 'agent-a', homeDir: '/Users/agent-a', adminUser: 'patrickhofmann' })
    expect(script).toContain('read -r ADMIN_PASSWORD')
    expect(script).toContain('unset ADMIN_PASSWORD')
    // The literal password must never be embedded in the script.
    expect(script).not.toMatch(/-adminPassword\s+["'][^"'$]/)
  })

  it('post-verifies the user record is actually gone (no silent failure)', () => {
    const script = buildDestroyTeardownScript({ name: 'agent-a', homeDir: '/Users/agent-a', adminUser: 'patrickhofmann' })
    expect(script).toContain('still exists after teardown')
    expect(script).toContain('exit 1')
  })

  it('guards against empty/root home', () => {
    const script = buildDestroyTeardownScript({ name: 'agent-a', homeDir: '/Users/agent-a', adminUser: 'patrickhofmann' })
    expect(script).toContain('"$HOME_DIR" != "/"')
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
