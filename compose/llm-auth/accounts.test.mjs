// Self-check for the grant->accounts reduction. Run: node accounts.test.mjs
import assert from 'node:assert'
import process from 'node:process'

process.env.NODE_ENV = 'test'
const { accountsFromGrants } = await import('./server.mjs')

const AUD = 'llms.openape.ai'
function standing(account, extra = {}) {
  return {
    type: 'standing',
    status: 'approved',
    request: {
      audience: AUD,
      resource_chain_template: [account === '*'
        ? { resource: 'llm-account' }
        : { resource: 'llm-account', selector: { account } }],
      ...extra,
    },
  }
}

// happy path: one account
assert.deepEqual(accountsFromGrants([standing('delta-mind')], AUD), ['delta-mind'])

// multiple grants -> union, deduped
assert.deepEqual(
  accountsFromGrants([standing('lindeverlag'), standing('delta-mind'), standing('delta-mind')], AUD).sort(),
  ['delta-mind', 'lindeverlag'],
)

// wildcard
assert.deepEqual(accountsFromGrants([standing('*')], AUD), ['*'])

// wrong audience ignored
assert.deepEqual(accountsFromGrants([{ ...standing('delta-mind'), request: { ...standing('delta-mind').request, audience: 'other' } }], AUD), [])

// non-standing / non-approved ignored
assert.deepEqual(accountsFromGrants([{ ...standing('delta-mind'), type: 'delegation' }], AUD), [])
assert.deepEqual(accountsFromGrants([{ ...standing('delta-mind'), status: 'revoked' }], AUD), [])

// non-llm-account resources ignored
assert.deepEqual(accountsFromGrants([{ type: 'standing', status: 'approved', request: { audience: AUD, resource_chain_template: [{ resource: 'repo' }] } }], AUD), [])

// garbage inputs don't throw
assert.deepEqual(accountsFromGrants(null, AUD), [])
assert.deepEqual(accountsFromGrants([null, {}, { request: null }], AUD), [])

console.log('accounts.test.mjs: all passed')
