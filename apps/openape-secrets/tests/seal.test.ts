import { describe, expect, it } from 'vitest'
import { open, seal } from '../app/utils/seal'
import { isCompleteBox } from '../server/utils/box'

// Node 22 ships the same WebCrypto the browser does, so the sealing path can be
// exercised for real here — no mock, no stand-in implementation.
async function recipient() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  return {
    pub: await crypto.subtle.exportKey('jwk', pair.publicKey),
    priv: await crypto.subtle.exportKey('jwk', pair.privateKey),
  }
}

const SECRET = '8883391045:AAGp-this-is-not-a-real-token'

describe('sealing for exactly one machine', () => {
  it('round-trips through the intended recipient', async () => {
    const me = await recipient()
    const box = await seal(me.pub, SECRET)
    expect(await open(me.priv, box)).toBe(SECRET)
  })

  it('is unreadable to anybody else — the whole point', async () => {
    const me = await recipient()
    const stranger = await recipient()
    const box = await seal(me.pub, SECRET)
    await expect(open(stranger.priv, box)).rejects.toThrow()
  })

  it('leaves no plaintext anywhere in what travels', async () => {
    const me = await recipient()
    const box = await seal(me.pub, SECRET)
    // This is what the network sees and what the database stores.
    expect(JSON.stringify(box)).not.toContain(SECRET)
    expect(JSON.stringify(box)).not.toContain('8883391045')
  })

  it('produces a different envelope every time, so equal values do not look equal', async () => {
    const me = await recipient()
    const a = await seal(me.pub, SECRET)
    const b = await seal(me.pub, SECRET)
    expect(a.ct).not.toBe(b.ct)
    expect(a.epk).not.toBe(b.epk)
  })

  it('refuses a tampered ciphertext instead of returning garbage', async () => {
    const me = await recipient()
    const box = await seal(me.pub, SECRET)
    const flipped = { ...box, ct: `${box.ct.slice(0, -4)}AAAA` }
    await expect(open(me.priv, flipped)).rejects.toThrow()
  })

  it('survives a value with newlines and unicode', async () => {
    const me = await recipient()
    const awkward = 'Zeile1\nZeile2\tmit Umlauten: äöü — 🔑'
    expect(await open(me.priv, await seal(me.pub, awkward))).toBe(awkward)
  })
})

describe('half an envelope is not an envelope', () => {
  it('accepts all four parts', async () => {
    const me = await recipient()
    expect(isCompleteBox(await seal(me.pub, 'x'))).toBe(true)
  })
  it('refuses a missing part', () => {
    expect(isCompleteBox({ epk: 'a', salt: 'b', iv: 'c' })).toBe(false)
  })
  it('refuses an empty part', () => {
    expect(isCompleteBox({ epk: 'a', salt: 'b', iv: 'c', ct: '' })).toBe(false)
  })
  it('refuses junk', () => {
    expect(isCompleteBox(null)).toBe(false)
    expect(isCompleteBox('epk')).toBe(false)
  })
})
