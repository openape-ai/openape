// Self-check for the path-selector shim. Run: node route.test.mjs
import assert from 'node:assert'
import process from 'node:process'

process.env.NODE_ENV = 'test'
const { route, rewriteBody } = await import('./route.mjs')

// default path: untouched, no owner header, no model prefix
let r = route('/v1/chat/completions')
assert.equal(r.owner, null)
assert.equal(r.account, 'lindeverlag')
assert.equal(r.path, '/v1/chat/completions')
assert.equal(r.prefixModel, false)

// /v1/models must NOT be mistaken for an account selector
assert.equal(route('/v1/models').owner, null)

// explicit lindeverlag path: owner captured, but default account -> no prefix
r = route('/patrick%40hofmann.eco/lindeverlag/v1/chat/completions')
assert.equal(r.owner, 'patrick@hofmann.eco')
assert.equal(r.account, 'lindeverlag')
assert.equal(r.path, '/v1/chat/completions')
assert.equal(r.prefixModel, false)

// delta-mind path: prefix the model
r = route('/patrick%40hofmann.eco/delta-mind/v1/chat/completions')
assert.equal(r.account, 'delta-mind')
assert.equal(r.prefixModel, true)

// non-email first segment is not a selector (path passes through)
assert.equal(route('/foo/bar/v1/chat/completions').owner, null)

// account with an unsafe char rejected
assert.throws(() => route('/a%40b.c/del%20ta/v1/chat/completions'))

// body rewrite only for the account path, only for plain model names
let b = rewriteBody(Buffer.from(JSON.stringify({ model: 'gpt-5.5', messages: [] })), 'delta-mind', '/v1/chat/completions')
assert.equal(JSON.parse(b).model, 'delta-mind/gpt-5.5')

// already-namespaced model left alone
b = rewriteBody(Buffer.from(JSON.stringify({ model: 'delta-mind/gpt-5.5' })), 'delta-mind', '/v1/chat/completions')
assert.equal(JSON.parse(b).model, 'delta-mind/gpt-5.5')

// non-rewritable path left alone
b = rewriteBody(Buffer.from(JSON.stringify({ model: 'gpt-5.5' })), 'delta-mind', '/v1/models')
assert.equal(JSON.parse(b).model, 'gpt-5.5')

console.log('route.test.mjs: all passed')
