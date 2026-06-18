import { generateKeyPairSync, sign } from 'node:crypto'
import type { H3Error } from 'h3'
import { describe, expect, it } from 'vitest'
import { createBodyLimitMiddleware } from '../idp/middleware/body-limit.js'
import { createProblemError } from '../idp/utils/problem.js'
import { sshEd25519ToKeyObject, verifyEd25519Signature } from '../idp/utils/ed25519.js'

function generateEd25519SshKey(): { publicKey: string, privateKey: import('node:crypto').KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const rawPub = publicKey.export({ type: 'spki', format: 'der' })
  const rawKey = rawPub.subarray(12)

  const typeStr = 'ssh-ed25519'
  const typeBuf = Buffer.from(typeStr)
  const typeLen = Buffer.alloc(4)
  typeLen.writeUInt32BE(typeBuf.length)
  const keyLen = Buffer.alloc(4)
  keyLen.writeUInt32BE(rawKey.length)
  const wireFormat = Buffer.concat([typeLen, typeBuf, keyLen, rawKey])

  return {
    publicKey: `ssh-ed25519 ${wireFormat.toString('base64')}`,
    privateKey,
  }
}

describe('problem/body-limit/ed25519 utilities', () => {
  it('createProblemError preserves explicit type and detail', () => {
    const err = createProblemError({
      type: 'https://example.com/problems/invalid-input',
      title: 'Invalid input',
      status: 422,
      detail: 'Field x is required',
    }) as H3Error

    expect(err.statusCode).toBe(422)
    expect(err.statusMessage).toBe('Invalid input')
    expect(err.data).toEqual({
      type: 'https://example.com/problems/invalid-input',
      title: 'Invalid input',
      status: 422,
      detail: 'Field x is required',
    })
  })

  it('body-limit middleware ignores missing content-length', () => {
    const middleware = createBodyLimitMiddleware(10)
    expect(() => middleware({ node: { req: { headers: {} } } } as any)).not.toThrow()
  })

  it('body-limit middleware allows content-length equal to the max', () => {
    const middleware = createBodyLimitMiddleware(10)
    expect(() => middleware({ node: { req: { headers: { 'content-length': '10' } } } } as any)).not.toThrow()
  })

  it('body-limit middleware returns a 413 problem when content-length exceeds the max', () => {
    const middleware = createBodyLimitMiddleware(10)
    try {
      middleware({ node: { req: { headers: { 'content-length': '11' } } } } as any)
      throw new Error('expected middleware to throw')
    }
    catch (error) {
      const err = error as H3Error
      expect(err.statusCode).toBe(413)
      expect(err.statusMessage).toBe('Request body too large')
      expect(err.data).toEqual({
        type: 'about:blank',
        title: 'Request body too large',
        status: 413,
        detail: 'Content-Length 11 exceeds maximum of 10 bytes.',
      })
    }
  })

  it('sshEd25519ToKeyObject accepts keys with trailing comments', () => {
    const { publicKey } = generateEd25519SshKey()
    expect(() => sshEd25519ToKeyObject(`${publicKey} alice@example.com`)).not.toThrow()
  })

  it('verifyEd25519Signature rejects signatures for the wrong payload', () => {
    const { publicKey, privateKey } = generateEd25519SshKey()
    const signature = sign(null, Buffer.from('expected'), privateKey)
    expect(verifyEd25519Signature(publicKey, 'actual', signature)).toBe(false)
  })

  it('verifyEd25519Signature rejects malformed ssh public keys', () => {
    expect(() => verifyEd25519Signature('ssh-ed25519 invalid-base64', 'data', Buffer.alloc(64))).toThrow()
  })
})
