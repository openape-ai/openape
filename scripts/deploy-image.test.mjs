// Sanity tests for the truth-remote resolution in scripts/deploy-image.mjs —
// run with:  node --test scripts/deploy-image.test.mjs
// node:test on purpose (not vitest), like the other script tests here: no
// workspace tooling needed.

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveTruthRemote, rollbackScript } from './deploy-image.mjs'

describe('resolveTruthRemote', () => {
  it('finds the authoritative remote by URL, whatever it is called locally', () => {
    // This checkout calls it `apegit`; a fresh clone from the forge calls the
    // same remote `origin`. Matching on the name would pick the wrong one.
    const remotes = {
      apegit: 'https://repos.openape.ai/patrick/monorepo.git',
      origin: 'https://git.openape.ai/openape-ai/openape.git',
    }
    assert.equal(resolveTruthRemote(remotes), 'apegit')
  })

  it('picks it when the forge clone is the one named origin', () => {
    const remotes = { origin: 'https://repos.openape.ai/patrick/monorepo.git' }
    assert.equal(resolveTruthRemote(remotes), 'origin')
  })

  it('rejects a mirror when no remote points at the forge', () => {
    const remotes = { origin: 'git@github.com:openape-ai/openape.git' }
    assert.throws(() => resolveTruthRemote(remotes), /No remote/)
  })

  it('ignores a host that merely contains the forge name', () => {
    const remotes = { origin: 'https://evil-repos.openape.ai.attacker.test/x.git' }
    assert.throws(() => resolveTruthRemote(remotes), /No remote/)
  })
})

describe('deployment rollback', () => {
  it('stops a first deployment and restores only targets with a previous image', () => {
    const directory = mkdtempSync(join(tmpdir(), 'openape-rollback-'))
    try {
      writeFileSync(join(directory, '.env'), 'IDP_TAG=new\nPODS_IDP_TAG=new\nOTHER_TAG=unchanged\n')
      writeFileSync(join(directory, 'docker'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$DEPLOY_CALLS"\n', { mode: 0o755 })
      execFileSync('bash', ['-s'], {
        input: rollbackScript(directory, [
          { name: 'pods-idp', compose: 'pods-idp', envVar: 'PODS_IDP_TAG' },
          { name: 'free-idp', compose: 'idp', envVar: 'IDP_TAG' },
        ], { 'free-idp': 'old' }),
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, DEPLOY_CALLS: join(directory, 'calls') },
      })
      assert.deepEqual(readFileSync(join(directory, 'calls'), 'utf8').trim().split('\n'), [
        'compose --env-file .env -f docker-compose.yml stop pods-idp',
        'compose --env-file .env -f docker-compose.yml up -d idp',
      ])
      const pins = readFileSync(join(directory, '.env'), 'utf8')
      assert.match(pins, /^IDP_TAG=old$/m)
      assert.match(pins, /^OTHER_TAG=unchanged$/m)
    }
    finally { rmSync(directory, { recursive: true, force: true }) }
  })
})
