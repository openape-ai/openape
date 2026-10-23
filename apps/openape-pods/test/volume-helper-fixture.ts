import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setVolumeIdentityHelper } from '../src/runtime/directories'

/** Configures a synthetic pods-helper that reports one fixed volume UUID, for tests that assign real folders. */
export function useVolumeHelperFixture(volume = 'AAAAAAAA-1111-2222-3333-444444444444'): string {
  const helper = join(mkdtempSync(join(tmpdir(), 'pods-volume-helper-')), 'pods-helper')
  writeFileSync(helper, `#!/bin/sh\n[ "$1" = volume-identity ] && [ -d "$2" ] || exit 1\nprintf '{"volume":"${volume}"}'\n`); chmodSync(helper, 0o755)
  setVolumeIdentityHelper(helper)
  return helper
}
