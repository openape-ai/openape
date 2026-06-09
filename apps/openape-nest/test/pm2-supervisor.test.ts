import type { AgentEntry } from '../src/lib/registry'
import { afterEach, describe, expect, it } from 'vitest'
import { ecosystemEnvLines } from '../src/lib/pm2-supervisor'

const baseAgent: AgentEntry = {
  name: 'svc',
  uid: 1007,
  home: '/home/svc',
  email: 'svc@id.openape.ai',
  registeredAt: 0,
}

describe('ecosystemEnvLines', () => {
  const saved = process.env.OPENAPE_BYPASS_APE_SHELL
  afterEach(() => {
    if (saved === undefined) delete process.env.OPENAPE_BYPASS_APE_SHELL
    else process.env.OPENAPE_BYPASS_APE_SHELL = saved
  })

  // The bridge runs via `sudo -u <agent>` (env stripped); this pm2 env block
  // is the only env it sees. Without the flag, the in-bridge runApeShell falls
  // back to the gated `ape-shell` (absent in the pod) and every command task
  // exits -1.
  it('forwards OPENAPE_BYPASS_APE_SHELL when the nest runs in pod-sandbox mode', () => {
    process.env.OPENAPE_BYPASS_APE_SHELL = '1'
    expect(ecosystemEnvLines(baseAgent)).toContain('OPENAPE_BYPASS_APE_SHELL: "1"')
  })

  it('omits the flag on a macOS nest (gated ape-shell is the right path there)', () => {
    delete process.env.OPENAPE_BYPASS_APE_SHELL
    expect(ecosystemEnvLines(baseAgent)).not.toContain('OPENAPE_BYPASS_APE_SHELL')
  })
})
