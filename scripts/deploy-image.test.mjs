// Sanity tests for the truth-remote resolution in scripts/deploy-image.mjs —
// run with:  node --test scripts/deploy-image.test.mjs
// node:test on purpose (not vitest), like the other script tests here: no
// workspace tooling needed.

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { resolveTruthRemote } from './deploy-image.mjs'

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

  it('falls back to origin when no remote points at the forge', () => {
    const remotes = { origin: 'git@github.com:openape-ai/openape.git' }
    assert.equal(resolveTruthRemote(remotes), 'origin')
  })

  it('ignores a host that merely contains the forge name', () => {
    const remotes = { origin: 'https://evil-repos.openape.ai.attacker.test/x.git' }
    assert.equal(resolveTruthRemote(remotes), 'origin')
  })
})
