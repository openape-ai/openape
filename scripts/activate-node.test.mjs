import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
// eslint-disable-next-line test/no-import-node-test
import { it } from 'node:test'

const script = fileURLToPath(new URL('./activate-node.sh', import.meta.url))
const shells = ['bash', 'zsh'].filter(shell => spawnSync(shell, ['--version']).status === 0)

for (const shell of shells) {
  it(`${shell}: activates the checkout pin without a profile or download`, () => {
    const cwd = mkdtempSync(join(tmpdir(), 'openape-node-'))
    try {
      execFileSync('git', ['init', '-q', '--initial-branch=main', cwd])
      const bin = join(cwd, 'nvm', 'versions', 'node', process.version, 'bin')
      mkdirSync(bin, { recursive: true })
      symlinkSync(process.execPath, join(bin, 'node'))
      writeFileSync(join(cwd, '.nvmrc'), `${process.versions.node}\n`)
      const result = spawnSync(shell, ['-f', '-c', '. "$1" || exit; command -v node; node --version', 'test', script], {
        cwd, encoding: 'utf8', timeout: 5000,
        env: { ...process.env, NVM_DIR: join(cwd, 'nvm'), OPENAPE_NODE_BIN: '' },
      })
      assert.equal(result.status, 0, result.stderr)
      assert.deepEqual(result.stdout.trim().split('\n'), [join(bin, 'node'), process.version])
    }
    finally { rmSync(cwd, { recursive: true, force: true }) }
  })

  it(`${shell}: rejects a wrong explicit installation without changing PATH`, () => {
    const cwd = mkdtempSync(join(tmpdir(), 'openape-node-'))
    try {
      execFileSync('git', ['init', '-q', '--initial-branch=main', cwd])
      writeFileSync(join(cwd, '.nvmrc'), '0.0.1\n')
      const result = spawnSync(shell, ['-f', '-c', 'before=$PATH; . "$1"; status_code=$?; test "$PATH" = "$before" || exit 99; exit "$status_code"', 'test', script], {
        cwd, encoding: 'utf8', timeout: 5000,
        env: { ...process.env, OPENAPE_NODE_BIN: fileURLToPath(new URL('.', `file://${process.execPath}`)) },
      })
      assert.equal(result.status, 1, result.stderr)
      assert.match(result.stderr, /Expected Node v0\.0\.1/)
    }
    finally { rmSync(cwd, { recursive: true, force: true }) }
  })
}
