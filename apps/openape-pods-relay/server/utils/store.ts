import { randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { assertFresh, limits, parseEnvelope, ProtocolError, sameOwner, timestamp, uuid } from '@openape/pods-protocol'
import type { DeviceKeys, Owner, Receipt, SealedEnvelope } from '@openape/pods-protocol'
import { challenge, envelopeDigest, sha256, proofBytes, verifyBytes, verifyEnvelope } from '@openape/pods-protocol/crypto'

export interface Registration { id: string, owner: Owner, kind: 'mobile' | 'runtime', keys: DeviceKeys, generation: string, epoch: number, revoked: boolean }
interface SessionRow { device_id: string, access_hash: string, refresh_hash: string, family: string, access_until: number, refresh_until: number, idle_until: number, revoked: number }
export class RelayStore {
  readonly db: DatabaseSync
  constructor(path: string, readonly now = Date.now) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(path)
    const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version)
    if (version > 1) { this.db.close(); throw new Error('Relay database requires a newer server') }
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS registrations(id TEXT PRIMARY KEY,owner TEXT NOT NULL,kind TEXT NOT NULL,keys TEXT NOT NULL,generation TEXT NOT NULL,epoch INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS sessions(family TEXT PRIMARY KEY,device_id TEXT NOT NULL REFERENCES registrations(id),access_hash TEXT UNIQUE NOT NULL,refresh_hash TEXT UNIQUE NOT NULL,access_until INTEGER NOT NULL,refresh_until INTEGER NOT NULL,idle_until INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS request_proofs(id TEXT PRIMARY KEY,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS used_refresh(hash TEXT PRIMARY KEY,family TEXT NOT NULL REFERENCES sessions(family));
      CREATE TABLE IF NOT EXISTS challenges(id TEXT PRIMARY KEY,device_id TEXT NOT NULL,purpose TEXT NOT NULL,nonce TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS pairings(runtime_id TEXT NOT NULL,device_id TEXT NOT NULL,epoch INTEGER NOT NULL,PRIMARY KEY(runtime_id,device_id));
      CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,device_id TEXT NOT NULL,runtime_id TEXT NOT NULL,hash TEXT NOT NULL,envelope TEXT,receipt TEXT NOT NULL,created_at INTEGER NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,device_id TEXT NOT NULL,runtime_id TEXT NOT NULL,envelope TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS device_events ON events(device_id,sequence);
      CREATE TABLE IF NOT EXISTS event_watermarks(device_id TEXT PRIMARY KEY,floor INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_flows(id TEXT PRIMARY KEY,state TEXT UNIQUE,body TEXT NOT NULL,expires INTEGER NOT NULL,code_hash TEXT UNIQUE);
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,device_id TEXT NOT NULL,action TEXT NOT NULL,at INTEGER NOT NULL);
      PRAGMA user_version=1;`)
  }

  close(): void { this.db.close() }
  transaction<T>(body: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const value = body(); this.db.exec('COMMIT'); return value }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  registration(id: string): Registration {
    const row = this.db.prepare('SELECT * FROM registrations WHERE id=? AND revoked=0').get(id)
    if (!row) throw new ProtocolError('registration_unavailable', 404)
    return { id, owner: JSON.parse(row.owner as string), kind: row.kind as Registration['kind'], keys: JSON.parse(row.keys as string), generation: row.generation as string, epoch: Number(row.epoch), revoked: false }
  }

  register(id: string, owner: Owner, kind: Registration['kind'], keys: DeviceKeys): Registration {
    const existing = this.db.prepare('SELECT * FROM registrations WHERE id=?').get(id)
    if (existing) {
      if (existing.revoked || existing.owner !== JSON.stringify(owner) || existing.kind !== kind || existing.keys !== JSON.stringify(keys)) throw new ProtocolError('registration_conflict', 409)
      return this.registration(id)
    }
    this.db.prepare('INSERT INTO registrations VALUES(?,?,?,?,?,1,0)').run(id, JSON.stringify(owner), kind, JSON.stringify(keys), randomUUID())
    this.audit(id, 'registered')
    return this.registration(id)
  }

  list(actor: Registration, kind: Registration['kind']): Registration[] {
    return this.db.prepare('SELECT id FROM registrations WHERE owner=? AND kind=? AND revoked=0').all(JSON.stringify(actor.owner), kind).map(row => this.registration(row.id as string))
  }

  audit(id: string, action: string): void { this.db.prepare('INSERT INTO audit(device_id,action,at) VALUES(?,?,?)').run(id, action, this.now()) }
  private tokens(deviceId: string, family: string = randomUUID(), refreshUntil = this.now() + limits.receiptMs) {
    const accessToken = randomBytes(32).toString('base64url'); const refreshToken = randomBytes(32).toString('base64url')
    const expiresAt = this.now() + 300000
    this.db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?,?,0) ON CONFLICT(family) DO UPDATE SET access_hash=excluded.access_hash,refresh_hash=excluded.refresh_hash,access_until=excluded.access_until,idle_until=excluded.idle_until').run(family, deviceId, sha256(accessToken), sha256(refreshToken), expiresAt, refreshUntil, this.now() + 7 * limits.replayMs)
    return { accessToken, refreshToken, expiresAt: new Date(expiresAt).toISOString(), registration: this.registration(deviceId) }
  }

  issue(deviceId: string) { this.registration(deviceId); return this.tokens(deviceId) }
  authenticate(token: string, kind?: Registration['kind']): Registration {
    const row = this.db.prepare('SELECT device_id FROM sessions WHERE access_hash=? AND revoked=0 AND access_until>? AND refresh_until>? AND idle_until>?').get(sha256(token), this.now(), this.now(), this.now())
    if (!row) throw new ProtocolError('authentication_required', 401)
    const actor = this.registration(row.device_id as string)
    if (kind && actor.kind !== kind) throw new ProtocolError('wrong_actor', 403)
    return actor
  }

  authenticateRequest(token: string, kind: Registration['kind'], method: string, path: string, proof: { id: string, at: string, digest: string, signature: string }): Registration {
    const device = this.authenticate(token, kind)
    uuid(proof.id); timestamp(proof.at)
    if (Math.abs(Date.parse(proof.at) - this.now()) > 30000 || !/^[a-f0-9]{64}$/.test(proof.digest)) throw new ProtocolError('invalid_request_proof', 401)
    const nonce = JSON.stringify([method, path, sha256(token), proof.at, proof.digest])
    if (!verifyBytes(proofBytes('api-request', proof.id, nonce), proof.signature, device.keys.signing)) throw new ProtocolError('invalid_request_proof', 401)
    const inserted = this.db.prepare('INSERT OR IGNORE INTO request_proofs VALUES(?,?)').run(proof.id, this.now() + 60000)
    if (!inserted.changes) throw new ProtocolError('request_replay', 401)
    return device
  }

  refresh(token: string, signature: string) {
    const hash = sha256(token)
    const session = this.db.prepare('SELECT device_id FROM sessions WHERE refresh_hash=? UNION SELECT s.device_id FROM used_refresh u JOIN sessions s ON s.family=u.family WHERE u.hash=?').get(hash, hash)
    if (!session) throw new ProtocolError('authentication_required', 401)
    const device = this.registration(session.device_id as string)
    if (!verifyBytes(proofBytes('session-refresh', device.id, hash), signature, device.keys.signing)) throw new ProtocolError('invalid_device_proof', 401)
    const used = this.db.prepare('SELECT family FROM used_refresh WHERE hash=?').get(hash)
    if (used) {
      this.db.prepare('UPDATE sessions SET revoked=1 WHERE family=?').run(used.family as string)
      throw new ProtocolError('refresh_replay', 401)
    }
    return this.transaction(() => {
      const row = this.db.prepare('SELECT * FROM sessions WHERE refresh_hash=? AND revoked=0 AND refresh_until>? AND idle_until>?').get(hash, this.now(), this.now()) as unknown as SessionRow | undefined
      if (!row) throw new ProtocolError('authentication_required', 401)
      this.registration(row.device_id)
      this.db.prepare('INSERT INTO used_refresh VALUES(?,?)').run(hash, row.family)
      return this.tokens(row.device_id, row.family, row.refresh_until)
    })
  }

  revoke(actor: Registration, id: string): void {
    const target = this.registration(id)
    if ((actor.kind !== 'mobile' && actor.id !== id) || !sameOwner(actor.owner, target.owner)) throw new ProtocolError('not_found', 404)
    this.transaction(() => {
      this.db.prepare('UPDATE registrations SET revoked=1,epoch=epoch+1 WHERE id=?').run(id)
      this.db.prepare('UPDATE sessions SET revoked=1 WHERE device_id=?').run(id)
      this.db.prepare('DELETE FROM pairings WHERE device_id=? OR runtime_id=?').run(id, id)
      this.db.prepare('DELETE FROM events WHERE device_id=? OR runtime_id=?').run(id, id)
      this.db.prepare('UPDATE operations SET envelope=NULL WHERE device_id=? OR runtime_id=?').run(id, id)
      this.audit(id, 'revoked')
    })
  }

  pair(runtime: Registration, deviceId: string): void {
    const device = this.registration(deviceId)
    if (runtime.kind !== 'runtime' || device.kind !== 'mobile' || !sameOwner(runtime.owner, device.owner)) throw new ProtocolError('not_found', 404)
    this.db.prepare('INSERT INTO pairings VALUES(?,?,?) ON CONFLICT(runtime_id,device_id) DO UPDATE SET epoch=excluded.epoch').run(runtime.id, device.id, device.epoch)
    this.audit(deviceId, 'paired')
  }

  unpair(runtime: Registration, deviceId: string): void {
    const device = this.registration(deviceId)
    if (runtime.kind !== 'runtime' || device.kind !== 'mobile' || !sameOwner(runtime.owner, device.owner)) throw new ProtocolError('not_found', 404)
    this.transaction(() => {
      this.db.prepare('DELETE FROM pairings WHERE runtime_id=? AND device_id=?').run(runtime.id, deviceId)
      this.db.prepare('DELETE FROM events WHERE runtime_id=? AND device_id=?').run(runtime.id, deviceId)
      this.db.prepare('UPDATE operations SET envelope=NULL WHERE runtime_id=? AND device_id=?').run(runtime.id, deviceId)
      this.audit(deviceId, 'unpaired')
    })
  }

  isPaired(runtime: Registration, device: Registration): boolean {
    return sameOwner(runtime.owner, device.owner) && !!this.db.prepare('SELECT 1 FROM pairings WHERE runtime_id=? AND device_id=? AND epoch=?').get(runtime.id, device.id, device.epoch)
  }

  requirePair(runtime: Registration, device: Registration): void {
    if (!this.isPaired(runtime, device)) throw new ProtocolError('pairing_required', 403)
  }

  // A restored or re-registered desktop starts a new generation: commands of
  // the previous generation are never delivered again, buffered content is
  // dropped and every phone must pair with the new generation explicitly.
  rotate(runtime: Registration): Registration {
    if (runtime.kind !== 'runtime') throw new ProtocolError('wrong_actor', 403)
    return this.transaction(() => {
      this.db.prepare('UPDATE registrations SET generation=? WHERE id=? AND revoked=0').run(randomUUID(), runtime.id)
      for (const row of this.db.prepare('SELECT id FROM operations WHERE runtime_id=? AND envelope IS NOT NULL').all(runtime.id)) {
        const receipt: Receipt = { operationId: row.id as string, state: 'unknown', source: 'relay', updatedAt: new Date(this.now()).toISOString(), code: 'runtime_rotated_reconcile_desktop' }
        this.db.prepare('UPDATE operations SET envelope=NULL,receipt=? WHERE id=?').run(JSON.stringify(receipt), row.id as string)
      }
      this.db.prepare('DELETE FROM events WHERE runtime_id=?').run(runtime.id)
      this.db.prepare('DELETE FROM pairings WHERE runtime_id=?').run(runtime.id)
      this.audit(runtime.id, 'rotated')
      return this.registration(runtime.id)
    })
  }

  admit(actor: Registration, value: unknown, online: (runtimeId: string) => boolean): Receipt {
    const envelope = verifyEnvelope(value, actor.keys.signing)
    const route = envelope.route
    const runtime = this.registration(route.runtimeId)
    if (actor.kind !== 'mobile' || runtime.kind !== 'runtime' || route.deviceId !== actor.id || route.keyEpoch !== actor.epoch || !sameOwner(actor.owner, route.owner) || route.generation !== runtime.generation || !['command', 'query'].includes(route.direction)) throw new ProtocolError('not_found', 404)
    this.requirePair(runtime, actor)
    const hash = envelopeDigest(envelope)
    const existing = this.db.prepare('SELECT * FROM operations WHERE id=?').get(route.id)
    if (existing) {
      if (existing.device_id !== actor.id || existing.hash !== hash) throw new ProtocolError('operation_conflict', 409)
      return JSON.parse(existing.receipt as string)
    }
    assertFresh(route, this.now())
    if (!online(runtime.id)) throw new ProtocolError('runtime_offline', 503)
    const pending = Number(this.db.prepare('SELECT count(*) AS count FROM operations WHERE runtime_id=? AND envelope IS NOT NULL').get(runtime.id)?.count)
    if (pending >= limits.pending) throw new ProtocolError('runtime_queue_full', 429)
    const receipt: Receipt = { operationId: route.id, state: 'accepted', source: 'relay', updatedAt: new Date(this.now()).toISOString() }
    this.db.prepare('INSERT INTO operations VALUES(?,?,?,?,?,?,?,?)').run(route.id, actor.id, runtime.id, hash, JSON.stringify(envelope), JSON.stringify(receipt), this.now(), Date.parse(route.expiresAt))
    return receipt
  }

  operation(actor: Registration, id: string): Receipt {
    const row = this.db.prepare('SELECT receipt,runtime_id FROM operations WHERE id=? AND device_id=?').get(id, actor.id)
    if (!row) throw new ProtocolError('not_found', 404)
    this.requirePair(this.registration(row.runtime_id as string), actor)
    return JSON.parse(row.receipt as string)
  }

  pending(runtime: Registration): SealedEnvelope[] {
    return this.db.prepare('SELECT envelope FROM operations WHERE runtime_id=? AND envelope IS NOT NULL AND expires>? ORDER BY created_at LIMIT 100').all(runtime.id, this.now()).map(row => JSON.parse(row.envelope as string))
  }

  deliver(runtime: Registration, value: unknown): string {
    const envelope = verifyEnvelope(value, runtime.keys.signing)
    const route = envelope.route
    const device = this.registration(route.deviceId)
    this.requirePair(runtime, device)
    if (runtime.kind !== 'runtime' || route.runtimeId !== runtime.id || route.generation !== runtime.generation || route.keyEpoch !== device.epoch || !sameOwner(runtime.owner, route.owner) || !['response', 'event'].includes(route.direction)) throw new ProtocolError('invalid_route', 403)
    assertFresh(route, this.now())
    return this.transaction(() => {
      const existing = this.db.prepare('SELECT sequence,envelope FROM events WHERE id=?').get(route.id)
      if (existing) {
        if (existing.envelope !== JSON.stringify(envelope)) throw new ProtocolError('event_conflict', 409)
        return String(existing.sequence)
      }
      // Bounded per device and runtime so one desktop cannot starve another.
      const capacity = this.db.prepare('SELECT count(*) AS count,coalesce(sum(length(envelope)),0) AS bytes FROM events WHERE device_id=? AND runtime_id=?').get(device.id, runtime.id)!
      if (Number(capacity.count) >= 1000 || Number(capacity.bytes) + JSON.stringify(envelope).length > 32 * 1024 * 1024) throw new ProtocolError('replay_buffer_full', 503)
      const result = this.db.prepare('INSERT INTO events(id,device_id,runtime_id,envelope,created_at) VALUES(?,?,?,?,?)').run(route.id, device.id, runtime.id, JSON.stringify(envelope), this.now())
      if (route.direction === 'response') this.db.prepare('UPDATE operations SET envelope=NULL WHERE id=? AND runtime_id=? AND device_id=?').run(route.id, runtime.id, device.id)
      return String(result.lastInsertRowid)
    })
  }

  syncCursor(actor: Registration): string {
    return String(this.db.prepare('SELECT max(value) AS cursor FROM (SELECT coalesce(max(sequence),0) AS value FROM events WHERE device_id=? UNION ALL SELECT floor AS value FROM event_watermarks WHERE device_id=?)').get(actor.id, actor.id)?.cursor ?? 0)
  }

  events(actor: Registration, cursor: string) {
    if (!/^(?:0|[1-9]\d{0,18})$/.test(cursor)) throw new ProtocolError('invalid_cursor')
    const floor = BigInt(String(this.db.prepare('SELECT floor FROM event_watermarks WHERE device_id=?').get(actor.id)?.floor ?? 0))
    if (BigInt(cursor) < floor) throw new ProtocolError('resync_required', 410)
    return this.db.prepare('SELECT sequence,envelope FROM events WHERE device_id=? AND sequence>? ORDER BY sequence LIMIT 100').all(actor.id, BigInt(cursor)).map(row => ({ cursor: String(row.sequence), envelope: parseEnvelope(JSON.parse(row.envelope as string)) }))
  }

  acknowledge(actor: Registration, cursor: string): void {
    if (!/^(?:0|[1-9]\d{0,18})$/.test(cursor)) throw new ProtocolError('invalid_cursor')
    const floor = BigInt(String(this.db.prepare('SELECT floor FROM event_watermarks WHERE device_id=?').get(actor.id)?.floor ?? 0))
    if (BigInt(cursor) === floor) return
    const highest = BigInt(String(this.db.prepare('SELECT max(sequence) AS last FROM events WHERE device_id=?').get(actor.id)?.last ?? 0))
    if (BigInt(cursor) > highest) throw new ProtocolError('invalid_cursor')
    this.transaction(() => {
      this.db.prepare('INSERT INTO event_watermarks VALUES(?,?) ON CONFLICT(device_id) DO UPDATE SET floor=max(floor,excluded.floor)').run(actor.id, BigInt(cursor))
      this.db.prepare('DELETE FROM events WHERE device_id=? AND sequence<=?').run(actor.id, BigInt(cursor))
    })
  }

  purge(): void {
    this.transaction(() => {
      const old = this.db.prepare('SELECT device_id,max(sequence) AS floor FROM events WHERE created_at<? GROUP BY device_id').all(this.now() - limits.replayMs)
      for (const row of old) this.db.prepare('INSERT INTO event_watermarks VALUES(?,?) ON CONFLICT(device_id) DO UPDATE SET floor=max(floor,excluded.floor)').run(row.device_id as string, row.floor as number)
      this.db.prepare('DELETE FROM events WHERE created_at<?').run(this.now() - limits.replayMs)
      const expired = this.db.prepare('SELECT id FROM operations WHERE envelope IS NOT NULL AND expires<=?').all(this.now())
      for (const row of expired) {
        const receipt: Receipt = { operationId: row.id as string, state: 'unknown', source: 'relay', updatedAt: new Date(this.now()).toISOString(), code: 'delivery_expired_reconcile_desktop' }
        this.db.prepare('UPDATE operations SET envelope=NULL,receipt=? WHERE id=?').run(JSON.stringify(receipt), row.id as string)
      }
      this.db.prepare('DELETE FROM operations WHERE created_at<?').run(this.now() - limits.receiptMs)
      this.db.prepare('DELETE FROM audit WHERE at<?').run(this.now() - limits.receiptMs)
      this.db.prepare('DELETE FROM used_refresh WHERE family IN (SELECT family FROM sessions WHERE refresh_until<=? OR idle_until<=?)').run(this.now(), this.now())
      this.db.prepare('DELETE FROM sessions WHERE refresh_until<=? OR idle_until<=?').run(this.now(), this.now())
      this.db.prepare('DELETE FROM request_proofs WHERE expires<=?').run(this.now())
      this.db.prepare('DELETE FROM challenges WHERE expires<=?').run(this.now())
      this.db.prepare('DELETE FROM auth_flows WHERE expires<=?').run(this.now())
    })
  }

  createChallenge(deviceId: string, purpose: string) {
    const id = randomUUID(); const nonce = randomBytes(32).toString('base64url')
    this.db.prepare('INSERT INTO challenges VALUES(?,?,?,?,?)').run(id, deviceId, purpose, nonce, this.now() + 30000)
    return { id, nonce }
  }

  takeChallenge(id: string, deviceId: string, purpose: string): string {
    const row = this.db.prepare('DELETE FROM challenges WHERE id=? AND device_id=? AND purpose=? AND expires>? RETURNING nonce').get(id, deviceId, purpose, this.now())
    if (!row) throw new ProtocolError('challenge_expired', 401)
    return row.nonce as string
  }

  verifyPkce(verifier: string, expected: string): void {
    if (!/^[\w~-]{43,128}$/.test(verifier) || challenge(verifier) !== expected) throw new ProtocolError('invalid_pkce', 401)
  }
}
