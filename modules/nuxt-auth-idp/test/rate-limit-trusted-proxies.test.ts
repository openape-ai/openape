import type { H3Event } from 'h3'
import { describe, expect, it, vi } from 'vitest'
import { _internals } from '../src/runtime/server/plugins/rate-limit'

const { ipMatches, ipInTrustedList, resolveClientIp } = _internals

vi.mock('h3', async () => {
  const actual = await vi.importActual<any>('h3')
  return {
    ...actual,
    getRequestIP: vi.fn(),
  }
})

function makeEvent(socketIp: string | null, xff?: string | string[]): H3Event {
  return {
    node: {
      req: {
        headers: xff !== undefined ? { 'x-forwarded-for': xff } : {},
      },
    },
  } as unknown as H3Event
}

async function setSocketIp(ip: string | null) {
  const { getRequestIP } = await import('h3')
  ;(getRequestIP as any).mockReturnValue(ip)
}

describe('rate-limit IP CIDR matching', () => {
  it('matches IPs against /24 networks', () => {
    expect(ipMatches('10.1.2.3', '10.1.2.0/24')).toBe(true)
    expect(ipMatches('10.1.3.3', '10.1.2.0/24')).toBe(false)
  })

  it('matches single-host /32 entries (and bare IPs)', () => {
    expect(ipMatches('10.0.0.1', '10.0.0.1/32')).toBe(true)
    expect(ipMatches('10.0.0.1', '10.0.0.1')).toBe(true)
    expect(ipMatches('10.0.0.2', '10.0.0.1/32')).toBe(false)
  })

  it('matches /0 (catch-all)', () => {
    expect(ipMatches('1.2.3.4', '0.0.0.0/0')).toBe(true)
  })

  it('rejects malformed inputs', () => {
    expect(ipMatches('not-an-ip', '10.0.0.0/24')).toBe(false)
    expect(ipMatches('10.0.0.1', '10.0.0.0/33')).toBe(false)
    expect(ipMatches('10.0.0.1', 'garbage')).toBe(false)
  })

  it('ipInTrustedList combines several CIDRs', () => {
    const list = ['10.0.0.0/8', '192.168.0.0/16', '203.0.113.7']
    expect(ipInTrustedList('10.5.5.5', list)).toBe(true)
    expect(ipInTrustedList('192.168.42.99', list)).toBe(true)
    expect(ipInTrustedList('203.0.113.7', list)).toBe(true)
    expect(ipInTrustedList('1.2.3.4', list)).toBe(false)
  })
})

describe('resolveClientIp (#279 — XFF only honoured behind trusted proxies)', () => {
  it('returns socket peer when no trusted proxies configured (default safe)', async () => {
    await setSocketIp('1.2.3.4')
    // Even with attacker-controlled XFF the safe default is to ignore it.
    const event = makeEvent('1.2.3.4', '6.6.6.6')
    expect(resolveClientIp(event, [])).toBe('1.2.3.4')
  })

  it('returns socket peer when peer is NOT a trusted proxy', async () => {
    await setSocketIp('1.2.3.4')
    // Attacker connects directly with a forged XFF — peer is untrusted,
    // so XFF is ignored and we bucket on the attacker's actual IP.
    const event = makeEvent('1.2.3.4', '6.6.6.6')
    expect(resolveClientIp(event, ['10.0.0.0/8'])).toBe('1.2.3.4')
  })

  it('walks XFF right-to-left when peer IS a trusted proxy', async () => {
    await setSocketIp('10.0.0.5')
    // chain = "real-client, public-proxy, our-proxy"
    //         ^^^^ leftmost                  ^^^^ rightmost
    // Walking right→left: 10.0.0.6 trusted (skip), 198.51.100.7 untrusted → that's the client.
    const event = makeEvent('10.0.0.5', '203.0.113.99, 198.51.100.7, 10.0.0.6')
    expect(resolveClientIp(event, ['10.0.0.0/8'])).toBe('198.51.100.7')
  })

  it('falls back to peer when whole XFF chain is trusted', async () => {
    await setSocketIp('10.0.0.5')
    const event = makeEvent('10.0.0.5', '10.0.0.7, 10.0.0.6')
    expect(resolveClientIp(event, ['10.0.0.0/8'])).toBe('10.0.0.5')
  })

  it('returns peer when XFF header is missing', async () => {
    await setSocketIp('10.0.0.5')
    const event = makeEvent('10.0.0.5')
    expect(resolveClientIp(event, ['10.0.0.0/8'])).toBe('10.0.0.5')
  })

  it('cannot be bypassed by a leftmost forged XFF entry', async () => {
    // The original bug: getRequestIP({ xForwardedFor: true }) used to
    // return '6.6.6.6' here (leftmost). With trusted-proxy gating an
    // attacker connecting via a real proxy still has 198.51.100.7 as
    // their actual hop and the leftmost spoof is ignored.
    await setSocketIp('10.0.0.5')
    const event = makeEvent('10.0.0.5', '6.6.6.6, 198.51.100.7, 10.0.0.6')
    expect(resolveClientIp(event, ['10.0.0.0/8'])).toBe('198.51.100.7')
  })
})
