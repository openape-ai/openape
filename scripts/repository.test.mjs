import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { assertPushTarget, repository, repositoryIdentity, resolveTruthRemote } from './repository.mjs'

describe('canonical repository', () => {
  it('matches HTTPS and SSH forms of the same complete repository', () => {
    for (const url of [repository.url, 'https://repos.openape.ai/patrick/monorepo', 'git@repos.openape.ai:patrick/monorepo.git']) {
      assert.equal(repositoryIdentity(url), 'repos.openape.ai/patrick/monorepo')
      assert.doesNotThrow(() => assertPushTarget(url))
    }
  })
  it('rejects a different repository on the same host and misleading URLs', () => {
    for (const url of ['https://repos.openape.ai/other/monorepo.git', 'https://repos.openape.ai.attacker.test/patrick/monorepo.git', 'https://repos.openape.ai/patrick/monorepo.git?x=1', 'file:///tmp/monorepo', ...repository.mirrors]) {
      assert.throws(() => assertPushTarget(url), /Push rejected/)
      assert.throws(() => resolveTruthRemote({ origin: url }), /No remote/)
    }
  })
  it('handles aliases deterministically and rejects ambiguous non-origin aliases', () => {
    assert.equal(resolveTruthRemote({ other: repository.url }), 'other')
    assert.equal(resolveTruthRemote({ other: repository.url, origin: repository.url }), 'origin')
    assert.throws(() => resolveTruthRemote({ a: repository.url, b: repository.url }), /Ambiguous/)
    assert.throws(() => resolveTruthRemote({}), /No remote/)
  })
})
