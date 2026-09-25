import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
// eslint-disable-next-line test/no-import-node-test
import { it } from 'node:test'

const script = fileURLToPath(new URL('./publish-chain.mjs', import.meta.url))
it('a filtered release dry-run only looks up the authorized package', () => {
  const dir = mkdtempSync(join(tmpdir(), 'openape-release-scope-'))
  const log = join(dir, 'calls')
  try {
    writeFileSync(join(dir, 'npm'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$OPENAPE_RELEASE_TEST_LOG"\nprintf "0.0.0\\n"\n', { mode: 0o755 })
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, OPENAPE_RELEASE_TEST_LOG: log }
    const result = spawnSync(process.execPath, [script, '--dry-run', '--filter', '@openape/cli-auth'], { env, encoding: 'utf8', timeout: 5000 })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(log, 'utf8').trim(), 'view @openape/cli-auth@latest version')
    assert.match(result.stdout, /Would publish 1 package/)
    rmSync(log)
    for (const args of [['--filter', '@openape/not-a-package'], ['--filter'], ['--fliter', '@openape/cli-auth']]) {
      const invalid = spawnSync(process.execPath, [script, '--dry-run', ...args], { env, encoding: 'utf8', timeout: 5000 })
      assert.notEqual(invalid.status, 0)
      assert.equal(existsSync(log), false, 'invalid filters must fail before any package lookup or publication')
    }
  }
  finally { rmSync(dir, { recursive: true, force: true }) }
})
