import { connect } from 'node:http2'
import { createPrivateKey, sign } from 'node:crypto'
import type { RelayStore } from './store'

export interface PushRequest { host: string, path: string, headers: Record<string, string>, body: string }
export interface PushResponse { status: number, reason?: string }
export type PushTransport = (request: PushRequest) => Promise<PushResponse>
export interface NotifierConfig { enabled: boolean, keyId: string, teamId: string, key: string, bundle: string, host: string, sandboxHost: string }

const pollGraceMs = 30000
const repeatMs = 60000
const expiryMs = 24 * 60 * 60 * 1000

/// Sends content-free APNs hints when buffered content waits for a device that is not polling.
/// The payload names the runtime only; the app fetches through the relay after waking.
export class Notifier {
  private readonly lastSent = new Map<string, number>()
  private jwt: { value: string, issuedAt: number } | null = null
  constructor(private readonly store: RelayStore, private readonly config: NotifierConfig, private readonly transport: PushTransport = appleTransport) {}

  get enabled(): boolean { return this.config.enabled }

  async afterDelivery(deviceId: string, runtimeId: string): Promise<void> {
    if (!this.config.enabled) return
    const target = this.store.pushTarget(deviceId)
    if (!target) return
    const now = this.store.now()
    if (now - this.store.lastPoll(deviceId) < pollGraceMs) return
    const key = `${deviceId}:${runtimeId}`
    if (now - (this.lastSent.get(key) ?? 0) < repeatMs) return
    this.lastSent.set(key, now)
    const response = await this.transport({
      host: target.environment === 'production' ? this.config.host : this.config.sandboxHost,
      path: `/3/device/${target.token}`,
      headers: {
        'authorization': `bearer ${this.token(now)}`,
        'apns-topic': this.config.bundle,
        'apns-push-type': 'alert',
        'apns-priority': '5',
        'apns-expiration': String(Math.floor((now + expiryMs) / 1000)),
        'apns-collapse-id': runtimeId,
      },
      body: JSON.stringify({ aps: { 'alert': { title: 'OpenApe Pods', body: 'A Pod on your desktop has an update.' }, 'thread-id': runtimeId, 'sound': 'default' }, runtime: runtimeId }),
    })
    if (response.status === 200) { this.store.audit(deviceId, 'push_sent'); return }
    if (response.status === 410 || response.reason === 'BadDeviceToken' || response.reason === 'Unregistered') { this.store.unregisterPush(deviceId, 'unregistered'); return }
    this.store.audit(deviceId, 'push_failed')
  }

  private token(now: number): string {
    if (this.jwt && now - this.jwt.issuedAt < 50 * 60 * 1000) return this.jwt.value
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
    const unsigned = `${encode({ alg: 'ES256', kid: this.config.keyId })}.${encode({ iss: this.config.teamId, iat: Math.floor(now / 1000) })}`
    const signature = sign('sha256', Buffer.from(unsigned), { key: createPrivateKey(this.config.key), dsaEncoding: 'ieee-p1363' }).toString('base64url')
    this.jwt = { value: `${unsigned}.${signature}`, issuedAt: now }
    return this.jwt.value
  }
}

export function appleTransport(request: PushRequest): Promise<PushResponse> {
  return new Promise((resolve, reject) => {
    const session = connect(`https://${request.host}`)
    session.on('error', reject)
    const stream = session.request({ ':method': 'POST', ':path': request.path, ...request.headers })
    let status = 0; const chunks: Buffer[] = []
    stream.on('response', (headers) => { status = Number(headers[':status']) })
    stream.on('data', chunk => chunks.push(Buffer.from(chunk)))
    stream.on('end', () => {
      session.close()
      let reason: string | undefined
      try { reason = JSON.parse(Buffer.concat(chunks).toString('utf8')).reason }
      catch { reason = undefined }
      resolve({ status, reason })
    })
    stream.on('error', reject)
    stream.end(request.body)
  })
}
