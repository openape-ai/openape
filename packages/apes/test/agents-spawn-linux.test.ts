import { describe, expect, it } from 'vitest'
import { buildSpawnSetupScript } from '../src/lib/agent-bootstrap.js'

// End-to-end at the script level: the bytes that `runPrivilegedBash`
// will execute on the nest. No mocks — this is the artifact that runs.
describe('linux spawn script (integration)', () => {
  const script = buildSpawnSetupScript({
    name: 'agent-x',
    homeDir: '/var/lib/openape/homes/agent-x',
    shellPath: '/bin/bash',
    privateKeyPem: '-----BEGIN OPENSSH PRIVATE KEY-----\nKEY\n-----END OPENSSH PRIVATE KEY-----\n',
    publicKeySshLine: 'ssh-ed25519 AAAAC3Nz agent-x',
    x25519PrivateKey: 'x25519priv',
    x25519PublicKey: 'x25519pub',
    authJson: '{"idp":"https://id.openape.ai","email":"agent-x@id.openape.ai"}\n',
    claudeSettingsJson: '{"hooks":{"PreToolUse":[]}}',
    hookScriptSource: '#!/bin/bash\nexec true\n',
  })

  it('is a bash script with strict mode', () => {
    expect(script.startsWith('#!/bin/bash\nset -euo pipefail')).toBe(true)
  })

  it('creates the parent homes dir then the user', () => {
    expect(script).toContain('mkdir -p /var/lib/openape/homes')
    // Anchor on the full command (with --home-dir); the explanatory
    // comment above it also contains "useradd --create-home".
    expect(script.indexOf('mkdir -p /var/lib/openape/homes'))
      .toBeLessThan(script.indexOf('useradd --create-home --home-dir'))
  })

  it('uses no macOS primitives', () => {
    for (const bad of ['dscl', 'launchctl', 'sysadminctl', 'NFSHomeDirectory', 'IsHidden', 'Library/Application Support', 'staff']) {
      expect(script).not.toContain(bad)
    }
  })

  it('writes all four identity artifacts under the agent home', () => {
    expect(script).toContain('"$HOME_DIR/.ssh/id_ed25519"')
    expect(script).toContain('"$HOME_DIR/.ssh/id_ed25519.pub"')
    expect(script).toContain('"$HOME_DIR/.config/apes/auth.json"')
    expect(script).toContain('"$HOME_DIR/.config/openape/agent-x25519.key"')
  })

  it('installs the claude ape-shell hook but no OAuth token (M4)', () => {
    expect(script).toContain('.claude/hooks/bash-via-ape-shell.sh')
    expect(script).not.toContain('claude-token.env')
    expect(script).not.toContain('CLAUDE_CODE_OAUTH_TOKEN')
  })

  it('locks the private key and auth.json to 600 and chowns to the agent', () => {
    expect(script).toContain('chmod 600 "$HOME_DIR/.ssh/id_ed25519"')
    expect(script).toContain('chmod 600 "$HOME_DIR/.config/apes/auth.json"')
    expect(script).toContain('chown -R "$NAME:" "$HOME_DIR"')
  })

  it('ends with the OK report line', () => {
    expect(script).toContain('echo "OK $NAME (linux user) uid=$NEW_UID home=$HOME_DIR"')
  })
})
