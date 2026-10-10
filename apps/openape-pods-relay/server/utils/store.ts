import { randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ProtocolError, timestamp, uuid } from '@openape/pods-protocol'
import type { DeviceKeys, Owner } from '@openape/pods-protocol'
import { challenge, sha256, proofBytes, verifyBytes } from '@openape/pods-protocol/crypto'

const sessionMs = 30 * 86400000
const idleMs = 7 * 86400000
export interface Registration { id: string, owner: Owner, kind: string, keys: DeviceKeys, generation: string, epoch: number, revoked: boolean }
interface SessionRow { device_id: string, access_hash: string, refresh_hash: string, family: string, access_until: number, refresh_until: number, idle_until: number, revoked: number }
export class RelayStore {
  readonly db: DatabaseSync
  constructor(path: string, readonly now = Date.now) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(path)
    const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version)
    if (version > 1) { this.db.close(); throw new Error('Relay database requires a newer server') }
    // Nothing read the audit log; it ended with issue 1455 (M8), and an older server recreates it after a rollback.
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS registrations(id TEXT PRIMARY KEY,owner TEXT NOT NULL,kind TEXT NOT NULL,keys TEXT NOT NULL,generation TEXT NOT NULL,epoch INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS sessions(family TEXT PRIMARY KEY,device_id TEXT NOT NULL REFERENCES registrations(id),access_hash TEXT UNIQUE NOT NULL,refresh_hash TEXT UNIQUE NOT NULL,access_until INTEGER NOT NULL,refresh_until INTEGER NOT NULL,idle_until INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS request_proofs(id TEXT PRIMARY KEY,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS used_refresh(hash TEXT PRIMARY KEY,family TEXT NOT NULL REFERENCES sessions(family));
      CREATE TABLE IF NOT EXISTS auth_flows(id TEXT PRIMARY KEY,state TEXT UNIQUE,body TEXT NOT NULL,expires INTEGER NOT NULL,code_hash TEXT UNIQUE);
      DROP TABLE IF EXISTS audit;
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
    return { id, owner: JSON.parse(row.owner as string), kind: String(row.kind), keys: JSON.parse(row.keys as string), generation: row.generation as string, epoch: Number(row.epoch), revoked: false }
  }

  register(id: string, owner: Owner, keys: DeviceKeys): Registration {
    const existing = this.db.prepare('SELECT * FROM registrations WHERE id=?').get(id)
    if (existing) {
      if (existing.revoked || existing.owner !== JSON.stringify(owner) || existing.kind !== 'runtime' || existing.keys !== JSON.stringify(keys)) throw new ProtocolError('registration_conflict', 409)
      return this.registration(id)
    }
    this.db.prepare('INSERT INTO registrations VALUES(?,?,\'runtime\',?,?,1,0)').run(id, JSON.stringify(owner), JSON.stringify(keys), randomUUID())
    return this.registration(id)
  }

  private tokens(deviceId: string, family: string = randomUUID(), refreshUntil = this.now() + sessionMs) {
    const accessToken = randomBytes(32).toString('base64url'); const refreshToken = randomBytes(32).toString('base64url')
    const expiresAt = this.now() + 300000
    this.db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?,?,0) ON CONFLICT(family) DO UPDATE SET access_hash=excluded.access_hash,refresh_hash=excluded.refresh_hash,access_until=excluded.access_until,idle_until=excluded.idle_until').run(family, deviceId, sha256(accessToken), sha256(refreshToken), expiresAt, refreshUntil, this.now() + idleMs)
    return { accessToken, refreshToken, expiresAt: new Date(expiresAt).toISOString(), registration: this.registration(deviceId) }
  }

  issue(deviceId: string) { this.registration(deviceId); return this.tokens(deviceId) }
  authenticate(token: string): Registration {
    const row = this.db.prepare('SELECT device_id FROM sessions WHERE access_hash=? AND revoked=0 AND access_until>? AND refresh_until>? AND idle_until>?').get(sha256(token), this.now(), this.now(), this.now())
    if (!row) throw new ProtocolError('authentication_required', 401)
    const actor = this.registration(row.device_id as string)
    if (actor.kind !== 'runtime') throw new ProtocolError('wrong_actor', 403)
    return actor
  }

  authenticateRequest(token: string, method: string, path: string, proof: { id: string, at: string, digest: string, signature: string }): Registration {
    const device = this.authenticate(token)
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

  purge(): void {
    this.transaction(() => {
      this.db.prepare('DELETE FROM used_refresh WHERE family IN (SELECT family FROM sessions WHERE refresh_until<=? OR idle_until<=?)').run(this.now(), this.now())
      this.db.prepare('DELETE FROM sessions WHERE refresh_until<=? OR idle_until<=?').run(this.now(), this.now())
      this.db.prepare('DELETE FROM request_proofs WHERE expires<=?').run(this.now())
      this.db.prepare('DELETE FROM auth_flows WHERE expires<=?').run(this.now())
    })
  }

  verifyPkce(verifier: string, expected: string): void {
    if (!/^[\w~-]{43,128}$/.test(verifier) || challenge(verifier) !== expected) throw new ProtocolError('invalid_pkce', 401)
  }
}
