import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { assertPushTarget, repository, repositoryIdentity, resolveTruthRemote } from './repository.mjs'

describe('canonical repository', () => {
  it('matches HTTPS and SSH forms of the same complete repository', () => {
    for (const url of [repository.url, 'https://github.com/openape-ai/openape', 'git@github.com:openape-ai/openape.git']) {
      assert.equal(repositoryIdentity(url), 'github.com/openape-ai/openape')
      assert.doesNotThrow(() => assertPushTarget(url))
    }
  })
  it('rejects a different repository on the same host and misleading URLs', () => {
    for (const url of ['https://github.com/other/openape.git', 'https://github.com.attacker.test/openape-ai/openape.git', 'https://github.com/openape-ai/openape.git?x=1', 'file:///tmp/monorepo', 'https://repos.openape.ai/patrick/monorepo.git', 'https://git.openape.ai/openape-ai/openape.git']) {
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
