import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import * as jose from 'jose'
import type { GrantRecord } from '../types.js'
import type { OpenApeCliAuthorizationDetail, OpenApeExecutionContext } from '@openape/core'

const LOCAL_ISSUER = 'local://openclaw-grants'
const KEY_ALGORITHM = 'EdDSA'

export class LocalJwtSigner {
  private privateKey: jose.KeyLike | null = null
  private publicKey: jose.KeyLike | null = null
  private kid: string = ''
  private stateDir: string

  constructor(stateDir: string) {
    this.stateDir = stateDir
  }

  async init(): Promise<void> {
    const keyDir = join(this.stateDir, 'grants', 'keys')
    const privatePath = join(keyDir, 'private.jwk')
    const publicPath = join(keyDir, 'public.jwk')

    if (existsSync(privatePath) && existsSync(publicPath)) {
      const privData = JSON.parse(readFileSync(privatePath, 'utf-8'))
      const pubData = JSON.parse(readFileSync(publicPath, 'utf-8'))
      this.privateKey = await jose.importJWK(privData, KEY_ALGORITHM) as jose.KeyLike
      this.publicKey = await jose.importJWK(pubData, KEY_ALGORITHM) as jose.KeyLike
      this.kid = privData.kid ?? 'local-1'
    }
    else {
      const { privateKey, publicKey } = await jose.generateKeyPair(KEY_ALGORITHM, { crv: 'Ed25519' })
      this.privateKey = privateKey
      this.publicKey = publicKey
      this.kid = `local-${Date.now()}`

      if (!existsSync(keyDir))
        mkdirSync(keyDir, { recursive: true })

      const privJwk = await jose.exportJWK(privateKey)
      privJwk.kid = this.kid
      privJwk.alg = KEY_ALGORITHM
      writeFileSync(privatePath, JSON.stringify(privJwk, null, 2))

      const pubJwk = await jose.exportJWK(publicKey)
      pubJwk.kid = this.kid
      pubJwk.alg = KEY_ALGORITHM
      pubJwk.use = 'sig'
      writeFileSync(publicPath, JSON.stringify(pubJwk, null, 2))
    }
  }

  async signGrant(options: {
    grant: GrantRecord
    audience: string
    detail: OpenApeCliAuthorizationDetail
    executionContext: OpenApeExecutionContext
  }): Promise<string> {
    if (!this.privateKey)
      throw new Error('LocalJwtSigner not initialized')

    const { grant, audience, detail, executionContext } = options

    const expirationTime = this.getExpiration(grant)

    const jwt = await new jose.SignJWT({
      grant_id: grant.id,
      grant_type: grant.approval,
      permissions: [grant.permission],
      authorization_details: [detail],
      cmd_hash: executionContext.argv_hash,
      command: grant.command,
      execution_context: executionContext,
    })
      .setProtectedHeader({ alg: KEY_ALGORITHM, kid: this.kid })
      .setIssuedAt()
      .setIssuer(LOCAL_ISSUER)
      .setSubject('local-agent')
      .setAudience(audience)
      .setExpirationTime(expirationTime)
      .setJti(randomUUID())
      .sign(this.privateKey)

    return jwt
  }

  async getJwks(): Promise<jose.JSONWebKeySet> {
    if (!this.publicKey)
      throw new Error('LocalJwtSigner not initialized')

    const jwk = await jose.exportJWK(this.publicKey)
    jwk.kid = this.kid
    jwk.alg = KEY_ALGORITHM
    jwk.use = 'sig'

    return { keys: [jwk] }
  }

  getIssuer(): string {
    return LOCAL_ISSUER
  }

  private getExpiration(grant: GrantRecord): string | number {
    switch (grant.approval) {
      case 'once':
        return '5m'
      case 'timed':
        if (grant.expiresAt) {
          const secondsFromNow = Math.max(0, Math.floor((new Date(grant.expiresAt).getTime() - Date.now()) / 1000))
          return `${secondsFromNow}s`
        }
        return '1h'
      case 'always':
        return '1h'
      default:
        return '5m'
    }
  }
}
