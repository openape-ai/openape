import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { safeStorage, shell } from 'electron'
import { capabilities, parseEnvelope, sameOwner } from '@openape/pods-protocol'
import type { DeviceKeys, Owner, Receipt, Route } from '@openape/pods-protocol'
import { challenge, envelopeDigest, generateKey, open, proofBytes, publicKey, seal, sha256, signBytes } from '@openape/pods-protocol/crypto'
import type { FixtureWorker } from '../worker'
import type { RemoteDevice, RemoteRegistration } from '../../worker/remote/control'

interface Tokens { accessToken: string, refreshToken: string, expiresAt: string, registration: RemoteRegistration }
interface Saved { id: string, signing: string, agreement: string, enabled: boolean, tokens?: Tokens }
interface Outbox { id: string, device_id: string, sequence: number, route: string, body: string, envelope: string | null }
class RemoteServiceError extends Error {
  constructor(readonly status: number) { super(`Remote service returned ${status}`) }
}
export class RemoteController {
  private saved: Saved | null = null
  private socket: WebSocket | null = null
  private stopping = false
  private runner: Promise<void> | null = null
  private connectionId: string | null = null
  private availableDevices: RemoteDevice[] = []
  private provisioning = new Map<string, Promise<void>>()
  private chain: Promise<void> = Promise.resolve()
  private abort = new AbortController()
  error: string | null = null
  constructor(private readonly root: string, private readonly worker: FixtureWorker, private readonly origin = 'https://pods.openape.ai') {
    const url = new URL(origin)
    if (url.protocol !== 'https:' || url.origin !== origin) throw new Error('Remote service must be an HTTPS origin')
  }

  private keys(): DeviceKeys { return { signing: publicKey(this.saved!.signing), agreement: publicKey(this.saved!.agreement) } }
  private async load(): Promise<void> {
    if (this.saved) return
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Unlock the macOS keychain before enabling mobile access')
    try { this.saved = JSON.parse(safeStorage.decryptString(await readFile(join(this.root, 'remote/registration.enc')))) as Saved }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.saved = { id: randomUUID(), signing: generateKey(), agreement: generateKey(), enabled: false }
    }
  }

  private async save(): Promise<void> {
    const folder = join(this.root, 'remote'); await mkdir(folder, { recursive: true, mode: 0o700 })
    await writeFile(join(folder, 'registration.pending'), safeStorage.encryptString(JSON.stringify(this.saved)), { mode: 0o600 })
    await rename(join(folder, 'registration.pending'), join(folder, 'registration.enc'))
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const response = await fetch(`${this.origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(15000)]) })
    if (!response.ok) throw new RemoteServiceError(response.status)
    return response.json()
  }

  private async signed(method: 'POST', path: string, body: unknown): Promise<unknown> {
    const token = this.saved!.tokens!.accessToken; const data = JSON.stringify(body)
    const id = randomUUID(); const at = new Date().toISOString(); const digest = sha256(data)
    const signature = signBytes(proofBytes('api-request', id, JSON.stringify([method, path, sha256(token), at, digest])), this.saved!.signing)
    const response = await fetch(`${this.origin}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-pods-request-id': id, 'x-pods-request-at': at, 'x-pods-body-digest': digest, 'x-pods-proof': signature }, body: data, redirect: 'error', signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(15000)]) })
    if (!response.ok) throw new RemoteServiceError(response.status)
    return response.json()
  }

  async enable({ owner, email }: { owner: Owner, email: string }): Promise<void> {
    await this.load()
    if (this.saved!.tokens && sameOwner(this.saved!.tokens.registration.owner, owner)) {
      await this.disable(); await this.runner
      try {
        await this.refresh()
        const path = '/api/runtime/v1/registration'
        const id = randomUUID(); const at = new Date().toISOString(); const token = this.saved!.tokens.accessToken
        const signature = signBytes(proofBytes('api-request', id, JSON.stringify(['GET', path, sha256(token), at, sha256('')])), this.saved!.signing)
        const response = await fetch(`${this.origin}${path}`, { headers: { authorization: `Bearer ${token}`, 'x-pods-request-id': id, 'x-pods-request-at': at, 'x-pods-body-digest': sha256(''), 'x-pods-proof': signature }, redirect: 'error', signal: AbortSignal.timeout(15000) })
        if (!response.ok) throw new RemoteServiceError(response.status)
        const status = await this.worker.remote({ type: 'status' }) as { registration: RemoteRegistration | null }
        if (status.registration?.id !== this.saved!.tokens.registration.id || status.registration.generation !== this.saved!.tokens.registration.generation) {
          // The worker lost its registration (restored profile): start a new
          // generation so commands of the old one are never delivered again.
          this.saved!.tokens.registration = await this.signed('POST', '/api/runtime/v1/rotate', {}) as Tokens['registration']
        }
        this.saved!.enabled = true; await this.save()
        await this.worker.remote({ type: 'configure', registration: this.saved!.tokens.registration })
        await this.worker.indexRemotePods(owner)
        this.start(); return
      }
      catch (error) {
        if (!(error instanceof RemoteServiceError) || ![401, 410].includes(error.status)) throw error
        await this.disable(); await this.runner
        this.saved = { id: randomUUID(), signing: generateKey(), agreement: generateKey(), enabled: false }
        await this.save()
      }
    }
    const verifier = randomBytes(32).toString('base64url')
    const pkce = challenge(verifier)
    const begin = await this.post('/api/mobile/v1/session/begin', { deviceId: this.saved!.id, kind: 'runtime', keys: this.keys(), challenge: pkce, email }) as { id: string, browserUrl: string }
    if (!begin.browserUrl.startsWith(`${this.origin}/mobile-auth/start?`)) throw new Error('Invalid enrollment URL')
    await shell.openExternal(begin.browserUrl)
    const expires = Date.now() + 300000
    let tokens: Tokens | undefined
    while (Date.now() < expires && !this.stopping) {
      const response = await fetch(`${this.origin}/api/mobile/v1/session/exchange`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: begin.id, verifier, signature: signBytes(proofBytes('session-exchange', begin.id, pkce), this.saved!.signing) }), redirect: 'error', signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(10000)]) })
      if (response.status === 409) { await delay(1500, undefined, { signal: this.abort.signal }); continue }
      if (!response.ok) throw new Error(`Desktop registration failed (${response.status})`)
      tokens = await response.json() as Tokens; break
    }
    if (!tokens) throw new Error('Desktop registration expired')
    if (!sameOwner(tokens.registration.owner, owner) || tokens.registration.id !== this.saved!.id) throw new Error('Registered identity differs from the selected desktop owner')
    this.saved!.tokens = tokens; this.saved!.enabled = true; await this.save()
    await this.worker.remote({ type: 'configure', registration: tokens.registration })
    await this.worker.indexRemotePods(owner)
    this.start()
  }

  async resume(): Promise<void> {
    await this.load()
    if (!this.saved!.enabled) return
    const status = await this.worker.remote({ type: 'status' }) as { enabled: boolean, registration: RemoteRegistration | null }
    if (!status.enabled || status.registration?.generation !== this.saved!.tokens?.registration.generation) { this.saved!.enabled = false; await this.save(); return }
    this.start()
  }

  private start(): void {
    if (this.runner) return
    this.runner = this.run().finally(() => { this.runner = null })
  }

  private async refresh(): Promise<void> {
    if (!this.saved?.tokens) throw new Error('Register this desktop again')
    if (Date.parse(this.saved.tokens.expiresAt) >= Date.now() + 60000) return
    this.saved.tokens = await this.post('/api/mobile/v1/session/refresh', { refreshToken: this.saved.tokens.refreshToken, signature: signBytes(proofBytes('session-refresh', this.saved.id, sha256(this.saved.tokens.refreshToken)), this.saved.signing) }) as Tokens
    await this.save()
  }

  private async run(): Promise<void> {
    let backoff = 1000
    while (!this.stopping && this.saved?.enabled) {
      try {
        if (!this.saved.tokens) throw new Error('Register this desktop again')
        await this.refresh()
        await this.connect(); backoff = 1000
      }
      catch (error) { this.error = error instanceof Error ? error.message : 'Remote connection failed' }
      if (this.stopping || !this.saved?.enabled) break
      await delay(backoff + Math.random() * 500, undefined, { signal: this.abort.signal }).catch((error: unknown) => { if (!this.stopping) throw error })
      backoff = Math.min(30000, backoff * 2)
    }
  }

  private async connect(): Promise<void> {
    const socket = new WebSocket(`${this.origin.replace(/^https:/, 'wss:')}/api/runtime/v1/connect`)
    this.socket = socket
    await new Promise<void>((resolve) => {
      const heartbeat = setInterval(() => { if (socket.readyState === WebSocket.OPEN && this.connectionId) socket.send(JSON.stringify({ type: 'heartbeat' })) }, 15000)
      socket.addEventListener('message', (event) => {
        const previous = this.chain
        this.chain = (async () => { await previous; await this.message(String(event.data), socket) })().catch((error: unknown) => { this.error = error instanceof Error ? error.message : 'Remote message failed'; socket.close() })
      })
      socket.addEventListener('error', () => { this.error = 'Remote socket failed' })
      socket.addEventListener('close', () => { clearInterval(heartbeat); if (this.socket === socket) { this.socket = null; this.connectionId = null }; resolve() }, { once: true })
    })
  }

  private async message(raw: string, socket: WebSocket): Promise<void> {
    if (Buffer.byteLength(raw) > 67584) throw new Error('Remote frame exceeds limit')
    const frame = JSON.parse(raw) as Record<string, unknown>
    if (frame.type === 'challenge') {
      socket.send(JSON.stringify({ type: 'authenticate', protocol: 1, capabilities, token: this.saved!.tokens!.accessToken, signature: signBytes(proofBytes('runtime-connect', String(frame.id), String(frame.nonce)), this.saved!.signing) })); return
    }
    if (frame.type === 'ready' || frame.type === 'heartbeat') {
      if (frame.type === 'ready') { this.connectionId = String(frame.connectionId); await this.worker.indexRemotePods(this.saved!.tokens!.registration.owner) }
      if (frame.connectionId !== this.connectionId) throw new Error('Stale runtime connection')
      this.availableDevices = frame.devices as RemoteDevice[]
      const status = await this.worker.remote({ type: 'status' }) as { devices: RemoteDevice[], provisioning: string[], revokedDevices: string[] }
      if (frame.type === 'ready') {
        for (const id of status.revokedDevices) {
          if (this.availableDevices.some(device => device.id === id)) socket.send(JSON.stringify({ type: 'unpair', deviceId: id }))
        }
      }
      for (const podId of status.provisioning) this.provision(podId, this.saved!.tokens!.registration.owner)
      for (const paired of status.devices) {
        if (!this.availableDevices.some(device => device.id === paired.id && device.epoch === paired.epoch && JSON.stringify(device.keys) === JSON.stringify(paired.keys))) await this.worker.remote({ type: 'unpair', id: paired.id })
      }
      this.error = null; await this.flush(socket); return
    }
    if (frame.type === 'operation') {
      if (frame.connectionId !== this.connectionId) throw new Error('Stale runtime connection')
      const envelope = parseEnvelope(frame.envelope)
      const status = await this.worker.remote({ type: 'status' }) as { devices: RemoteDevice[] }
      const device = status.devices.find(item => item.id === envelope.route.deviceId)
      if (!device) throw new Error('Mobile device has not been confirmed on this desktop')
      const content = open(envelope, this.saved!.agreement, device.keys.signing)
      const receipt = await this.worker.remote({ type: 'execute', route: envelope.route, body: content, hash: envelopeDigest(envelope), leaseUntil: String(frame.leaseUntil) }) as Receipt
      if (envelope.route.kind === 'pod.create' && receipt.podId) this.provision(receipt.podId, envelope.route.owner)
      await this.flush(socket); return
    }
    if (frame.type === 'ack') { await this.worker.remote({ type: 'ack', id: String(frame.id) }); return }
    if (frame.type === 'paired' || frame.type === 'unpaired') return
    if (frame.type === 'error') throw new Error(`Remote service: ${String(frame.code)}`)
    throw new Error('Unsupported remote frame')
  }

  private provision(podId: string, owner: Owner): void {
    if (this.provisioning.has(podId)) return
    const task = (async () => {
      try {
        const identity = await this.worker.provisionRemotePod(podId, owner)
        await this.worker.remote({ type: 'provision', podId, identity, error: null })
      }
      catch (error) { await this.worker.remote({ type: 'provision', podId, identity: null, error: error instanceof Error ? error.message : 'Desktop setup required' }) }
    })().catch((error: unknown) => { this.error = error instanceof Error ? error.message : 'Could not save provisioning outcome' }).finally(() => { this.provisioning.delete(podId) })
    this.provisioning.set(podId, task)
  }

  private async flush(socket: WebSocket): Promise<void> {
    const status = await this.worker.remote({ type: 'status' }) as { devices: RemoteDevice[] }
    const outbox = await this.worker.remote({ type: 'outbox' }) as Outbox[]
    for (const item of outbox) {
      const device = status.devices.find(device => device.id === item.device_id)
      if (!device) continue
      let encoded = item.envelope
      if (!encoded) {
        const route = JSON.parse(item.route) as Route; route.sequence = String(item.sequence)
        encoded = JSON.stringify(seal(route, JSON.parse(item.body), device.keys.agreement, this.saved!.signing))
        await this.worker.remote({ type: 'seal', id: item.id, envelope: encoded })
      }
      if (socket.readyState !== WebSocket.OPEN) return
      socket.send(JSON.stringify({ type: 'deliver', envelope: JSON.parse(encoded) }))
    }
  }

  devices(): { device: RemoteDevice, code: string }[] {
    return this.availableDevices.map(device => ({ device, code: sha256(JSON.stringify(['pods-pairing-v1', this.saved!.tokens!.registration.owner.issuer, this.saved!.tokens!.registration.owner.subject, this.saved!.tokens!.registration.id, this.saved!.tokens!.registration.generation, this.keys().signing, this.keys().agreement, device.id, device.epoch, device.keys.signing, device.keys.agreement])).slice(0, 12).match(/.{4}/g)!.join(' ') }))
  }

  async pair(device: RemoteDevice): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error('Reconnect the desktop before pairing')
    await this.worker.remote({ type: 'pair', device })
    this.socket.send(JSON.stringify({ type: 'pair', deviceId: device.id }))
  }

  async pairedDevices(): Promise<RemoteDevice[]> {
    const status = await this.worker.remote({ type: 'status' }) as { devices: RemoteDevice[] }
    return status.devices
  }

  async unpair(id: string): Promise<void> {
    await this.worker.remote({ type: 'unpair', id })
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'unpair', deviceId: id }))
  }

  async disable(): Promise<void> {
    await this.load(); this.saved!.enabled = false; await this.save()
    await this.worker.remote({ type: 'disable' }); this.socket?.close()
  }

  async stop(): Promise<void> {
    this.stopping = true; this.abort.abort(); this.socket?.close()
    await this.runner; await this.chain; await Promise.all(this.provisioning.values())
  }
}
