import { describe, expect, it } from 'vitest'
import { checkEgress, isPrivateOrLoopback } from '../src/ssrf.js'

describe('isPrivateOrLoopback', () => {
  // IPv4 loopback
  it('blocks 127.0.0.1', async () => {
    expect(await isPrivateOrLoopback('127.0.0.1')).toBe(true)
  })

  it('blocks 127.255.255.255', async () => {
    expect(await isPrivateOrLoopback('127.255.255.255')).toBe(true)
  })

  // RFC 1918
  it('blocks 10.0.0.1', async () => {
    expect(await isPrivateOrLoopback('10.0.0.1')).toBe(true)
  })

  it('blocks 172.16.0.1', async () => {
    expect(await isPrivateOrLoopback('172.16.0.1')).toBe(true)
  })

  it('blocks 172.31.255.255', async () => {
    expect(await isPrivateOrLoopback('172.31.255.255')).toBe(true)
  })

  it('blocks 192.168.1.1', async () => {
    expect(await isPrivateOrLoopback('192.168.1.1')).toBe(true)
  })

  // Link-local
  it('blocks 169.254.0.1', async () => {
    expect(await isPrivateOrLoopback('169.254.0.1')).toBe(true)
  })

  // Unspecified
  it('blocks 0.0.0.0', async () => {
    expect(await isPrivateOrLoopback('0.0.0.0')).toBe(true)
  })

  // IPv6
  it('blocks ::1', async () => {
    expect(await isPrivateOrLoopback('::1')).toBe(true)
  })

  it('blocks ::', async () => {
    expect(await isPrivateOrLoopback('::')).toBe(true)
  })

  // localhost
  it('blocks localhost', async () => {
    expect(await isPrivateOrLoopback('localhost')).toBe(true)
  })

  // Public IPs — should NOT be blocked
  it('allows 8.8.8.8', async () => {
    expect(await isPrivateOrLoopback('8.8.8.8')).toBe(false)
  })

  it('allows 1.1.1.1', async () => {
    expect(await isPrivateOrLoopback('1.1.1.1')).toBe(false)
  })

  // 172.15.x.x is NOT in 172.16.0.0/12
  it('allows 172.15.255.255', async () => {
    expect(await isPrivateOrLoopback('172.15.255.255')).toBe(false)
  })

  // 172.32.x.x is NOT in 172.16.0.0/12
  it('allows 172.32.0.1', async () => {
    expect(await isPrivateOrLoopback('172.32.0.1')).toBe(false)
  })
})

describe('checkEgress', () => {
  // The discriminated outcome is what callers branch on. The boolean shim
  // above stays for legacy callers, but new code should distinguish "private"
  // (policy refusal → 403) from "unresolvable" (upstream failure → 502).

  it('returns ok for a public IP literal', async () => {
    expect(await checkEgress('8.8.8.8')).toEqual({ kind: 'ok' })
  })

  it('returns private for a loopback IP literal', async () => {
    expect(await checkEgress('127.0.0.1')).toEqual({ kind: 'private' })
  })

  it('returns private for the literal "localhost"', async () => {
    expect(await checkEgress('localhost')).toEqual({ kind: 'private' })
  })

  it('returns unresolvable for a non-existent host', async () => {
    // `not-a-host` has no DNS records; previously this came back as `private`
    // (and the proxy as 403). It's now `unresolvable` and proxies will 502.
    const result = await checkEgress('not-a-host')
    expect(result.kind).toBe('unresolvable')
  })
})
