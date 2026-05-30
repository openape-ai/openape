import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildExoscaleUserData, exoscaleAdapter } from '../server/utils/cloud/exoscale'
import { getCloud, listClouds, registerCloud  } from '../server/utils/cloud/index'
import type { CloudAdapter } from '../server/utils/cloud/index'

afterEach(() => {
  vi.resetAllMocks()
})

describe('cloud registry', () => {
  it('exoscale auto-registers on import', () => {
    expect(listClouds()).toContain('exoscale')
    expect(getCloud('exoscale').id).toBe('exoscale')
  })

  it('throws a helpful error for unknown providers', () => {
    expect(() => getCloud('hetzner-cloud')).toThrow(/not registered.*Known.*exoscale/)
  })

  it('registerCloud accepts custom adapters', () => {
    const fake: CloudAdapter = {
      id: 'fake-test',
      createInstance: async () => ({ provider: 'fake-test', id: 'x', region: 'r' }),
      destroyInstance: async () => {},
      getInstance: async () => ({ ref: { provider: 'fake-test', id: 'x', region: 'r' }, state: 'running' }),
      bootstrapPod: async () => {},
      publicAddress: () => '1.2.3.4',
    }
    registerCloud(fake)
    expect(getCloud('fake-test')).toBe(fake)
  })
})

describe('buildExoscaleUserData', () => {
  it('embeds all three bundle files base64-encoded', () => {
    const out = buildExoscaleUserData({
      sshPublicKey: 'ssh-ed25519 AAAA test',
      composeYaml: 'services: {}',
      envFile: 'FOO=bar\n',
      litellmYaml: 'model_list: []',
    })
    // Spot-check the cloud-init structure.
    expect(out).toMatch(/^#cloud-config/)
    expect(out).toContain('packages:')
    expect(out).toContain('runcmd:')
    // Bundle is inlined as base64 — decoder lines should appear.
    expect(out).toContain('base64 -d > /opt/openape/docker-compose.yml')
    expect(out).toContain('base64 -d > /opt/openape/.env')
    expect(out).toContain('base64 -d > /opt/openape/litellm.yaml')
    // The SSH key drops into authorized_keys via cloud-init's native field.
    expect(out).toContain('ssh_authorized_keys:')
    expect(out).toContain('ssh-ed25519 AAAA test')
    // Compose service auto-starts.
    expect(out).toContain('docker compose up -d')
  })

  it('chmods .env to 600 (secrets file)', () => {
    const out = buildExoscaleUserData({
      sshPublicKey: '',
      composeYaml: '',
      envFile: '',
      litellmYaml: '',
    })
    expect(out).toContain('chmod 600 /opt/openape/.env')
  })
})

describe('exoscale adapter', () => {
  it('reports a friendly display name for picker UIs', () => {
    expect(exoscaleAdapter.displayName).toBe('Exoscale (CH/EU)')
  })

  it('publicAddress prefers IPv4 over IPv6', () => {
    expect(exoscaleAdapter.publicAddress({
      ref: { provider: 'exoscale', id: 'x', region: 'r' },
      state: 'running',
      ipv4: '1.2.3.4',
      ipv6: '2001:db8::1',
    })).toBe('1.2.3.4')
  })

  it('publicAddress falls back to IPv6 when no IPv4', () => {
    expect(exoscaleAdapter.publicAddress({
      ref: { provider: 'exoscale', id: 'x', region: 'r' },
      state: 'running',
      ipv6: '2001:db8::1',
    })).toBe('2001:db8::1')
  })

  it('publicAddress returns null when no address yet (provisioning)', () => {
    expect(exoscaleAdapter.publicAddress({
      ref: { provider: 'exoscale', id: 'x', region: 'r' },
      state: 'provisioning',
    })).toBeNull()
  })

  it('bootstrapPod is a no-op (cloud-init handles it inside createInstance)', async () => {
    // Should complete without throwing — its work happens at instance-create time.
    await expect(exoscaleAdapter.bootstrapPod({
      ref: { provider: 'exoscale', id: 'x', region: 'r' },
      composeYaml: '',
      envFile: '',
      litellmYaml: '',
      sshKeyPath: '/tmp/key',
    })).resolves.toBeUndefined()
  })

  it('createInstance fails loudly when API credentials are missing', async () => {
    const prev = { key: process.env.EXOSCALE_API_KEY, secret: process.env.EXOSCALE_API_SECRET }
    delete process.env.EXOSCALE_API_KEY
    delete process.env.EXOSCALE_API_SECRET
    try {
      await expect(exoscaleAdapter.createInstance({
        name: 'test',
        region: 'ch-gva-2',
        instanceType: 'standard.small',
        image: 'ubuntu-24.04',
        sshPublicKey: 'ssh-ed25519 X',
      })).rejects.toThrow(/EXOSCALE_API_KEY/)
    }
    finally {
      if (prev.key) process.env.EXOSCALE_API_KEY = prev.key
      if (prev.secret) process.env.EXOSCALE_API_SECRET = prev.secret
    }
  })
})
