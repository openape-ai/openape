import type { KeyLike } from 'jose'
import { SignJWT, generateKeyPair, jwtVerify } from 'jose'
import { describe, expect, it, vi } from 'vitest'

const ISSUER = 'https://id.openape.at'
const AGENT_EMAIL = 'agent+test@id.openape.at'

let agentPublicKey: KeyLike
let agentPrivateKey: KeyLike
let idpSigningKey: { privateKey: KeyLike, publicKey: KeyLike, kid: string }

async function setup() {
  const agentKp = await generateKeyPair('EdDSA', { crv: 'Ed25519' })
  agentPublicKey = agentKp.publicKey
  agentPrivateKey = agentKp.privateKey

  const { generateKeyPair: genEdDSA } = await import('jose')
  const idpKp = await genEdDSA('EdDSA', { crv: 'Ed25519' })
  idpSigningKey = { ...idpKp, kid: 'idp-key-1' }
}

// Mock h3
vi.mock('h3', () => ({
  defineEventHandler: (fn: any) => fn,
  readRawBody: vi.fn(),
  getRequestHeader: vi.fn(),
  setResponseStatus: vi.fn(),
  createError: (opts: any) => Object.assign(new Error(opts.statusMessage), { statusCode: opts.statusCode }),
}))

// Mock stores
const mockUserStore = {
  findByEmail: vi.fn(),
}

const mockSshKeyStore = {
  findByUser: vi.fn(),
  findByPublicKey: vi.fn(),
}

const mockKeyStore = {
  getSigningKey: vi.fn(),
  getAllPublicKeys: vi.fn(),
}

const mockJtiStore = {
  hasBeenUsed: vi.fn().mockResolvedValue(false),
  markUsed: vi.fn().mockResolvedValue(undefined),
}

const mockCodeStore = { find: vi.fn(), save: vi.fn(), delete: vi.fn() }

vi.mock('../src/runtime/server/utils/stores', () => ({
  getIdpIssuer: () => ISSUER,
  useIdpStores: () => ({
    userStore: mockUserStore,
    sshKeyStore: mockSshKeyStore,
    keyStore: mockKeyStore,
    jtiStore: mockJtiStore,
    codeStore: mockCodeStore,
  }),
}))

// Mock ed25519 to return the test agent public key
vi.mock('../src/runtime/server/utils/ed25519', () => ({
  sshEd25519ToKeyObject: () => agentPublicKey,
}))

// Mock grant-stores (imports nitropack/runtime which is unavailable in tests)
const mockGrantStore = {
  save: vi.fn(),
  findById: vi.fn(),
  updateStatus: vi.fn(),
  findPending: vi.fn(),
  findByRequester: vi.fn(),
  findByDelegate: vi.fn(),
  findByDelegator: vi.fn(),
}

vi.mock('../src/runtime/server/utils/grant-stores', () => ({
  useGrantStores: () => ({
    grantStore: mockGrantStore,
    challengeStore: {},
  }),
}))

async function buildClientAssertion(overrides: Partial<{ iss: string, aud: string, jti: string }> = {}): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'EdDSA' })
    .setIssuer(overrides.iss ?? AGENT_EMAIL)
    .setSubject(overrides.iss ?? AGENT_EMAIL)
    .setAudience(overrides.aud ?? `${ISSUER}/token`)
    .setExpirationTime('60s')
    .setJti(overrides.jti ?? crypto.randomUUID())
    .setIssuedAt()
    .sign(agentPrivateKey)
}

describe('client_credentials grant', () => {
  it('issues agent token for valid client assertion', async () => {
    await setup()

    mockUserStore.findByEmail.mockResolvedValue({
      email: AGENT_EMAIL,
      name: 'Test Agent',
      isActive: true,
      owner: 'admin@test.com',
      createdAt: 1000,
    })
    mockSshKeyStore.findByUser.mockResolvedValue([{
      keyId: 'k1',
      userEmail: AGENT_EMAIL,
      publicKey: 'ssh-ed25519 mock',
      name: 'test',
      createdAt: 1000,
    }])

    mockKeyStore.getSigningKey.mockResolvedValue(idpSigningKey)

    const assertion = await buildClientAssertion()

    const { readRawBody } = await import('h3')
    ;(readRawBody as any).mockResolvedValue(JSON.stringify({
      grant_type: 'client_credentials',
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: assertion,
    }))

    const { default: handler } = await import('../src/runtime/server/routes/token.post')
    const result = await handler({} as any)

    expect(result.access_token).toBeTruthy()
    expect(result.token_type).toBe('Bearer')
    expect(result.expires_in).toBe(3600)

    // Verify the issued token
    const { payload } = await jwtVerify(result.access_token, idpSigningKey.publicKey, {
      algorithms: ['EdDSA'],
    })
    expect(payload.sub).toBe(AGENT_EMAIL)
    expect(payload.act).toBe('agent')
    expect(payload.iss).toBe(ISSUER)
  })

  it('rejects unknown agent', async () => {
    await setup()
    mockUserStore.findByEmail.mockResolvedValue(null)

    const assertion = await buildClientAssertion()
    const { readRawBody } = await import('h3')
    ;(readRawBody as any).mockResolvedValue(JSON.stringify({
      grant_type: 'client_credentials',
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: assertion,
    }))

    const { default: handler } = await import('../src/runtime/server/routes/token.post')
    const result = await handler({} as any)

    expect(result.error).toBe('invalid_client')
    expect(result.error_description).toContain('Unknown agent')
  })

  it('rejects inactive agent', async () => {
    await setup()
    mockUserStore.findByEmail.mockResolvedValue({
      email: AGENT_EMAIL,
      name: 'Test Agent',
      isActive: false,
      owner: 'admin@test.com',
      createdAt: 1000,
    })

    const assertion = await buildClientAssertion()
    const { readRawBody } = await import('h3')
    ;(readRawBody as any).mockResolvedValue(JSON.stringify({
      grant_type: 'client_credentials',
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: assertion,
    }))

    const { default: handler } = await import('../src/runtime/server/routes/token.post')
    const result = await handler({} as any)

    expect(result.error).toBe('invalid_client')
    expect(result.error_description).toContain('Unknown agent')
  })

  it('rejects replay (same jti)', async () => {
    await setup()
    mockUserStore.findByEmail.mockResolvedValue({
      email: AGENT_EMAIL,
      name: 'Test Agent',
      isActive: true,
      owner: 'admin@test.com',
      createdAt: 1000,
    })
    mockSshKeyStore.findByUser.mockResolvedValue([{
      keyId: 'k1',
      userEmail: AGENT_EMAIL,
      publicKey: 'ssh-ed25519 mock',
      name: 'test',
      createdAt: 1000,
    }])
    mockKeyStore.getSigningKey.mockResolvedValue(idpSigningKey)
    mockJtiStore.hasBeenUsed.mockResolvedValue(true) // JTI already used

    const assertion = await buildClientAssertion()
    const { readRawBody } = await import('h3')
    ;(readRawBody as any).mockResolvedValue(JSON.stringify({
      grant_type: 'client_credentials',
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: assertion,
    }))

    const { default: handler } = await import('../src/runtime/server/routes/token.post')
    const result = await handler({} as any)

    expect(result.error).toBe('invalid_client')
    expect(result.error_description).toContain('JTI already used')
  })

  it('rejects wrong audience', async () => {
    await setup()
    mockUserStore.findByEmail.mockResolvedValue({
      email: AGENT_EMAIL,
      name: 'Test Agent',
      isActive: true,
      owner: 'admin@test.com',
      createdAt: 1000,
    })
    mockSshKeyStore.findByUser.mockResolvedValue([{
      keyId: 'k1',
      userEmail: AGENT_EMAIL,
      publicKey: 'ssh-ed25519 mock',
      name: 'test',
      createdAt: 1000,
    }])
    mockJtiStore.hasBeenUsed.mockResolvedValue(false)

    const assertion = await buildClientAssertion({ aud: 'https://wrong.example.com/token' })
    const { readRawBody } = await import('h3')
    ;(readRawBody as any).mockResolvedValue(JSON.stringify({
      grant_type: 'client_credentials',
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: assertion,
    }))

    const { default: handler } = await import('../src/runtime/server/routes/token.post')
    const result = await handler({} as any)

    expect(result.error).toBe('invalid_client')
  })

  it('rejects unsupported assertion type', async () => {
    await setup()

    const { readRawBody } = await import('h3')
    ;(readRawBody as any).mockResolvedValue(JSON.stringify({
      grant_type: 'client_credentials',
      client_assertion_type: 'wrong-type',
      client_assertion: 'some-assertion',
    }))

    const { default: handler } = await import('../src/runtime/server/routes/token.post')
    const result = await handler({} as any)

    expect(result.error).toBe('invalid_request')
    expect(result.error_description).toContain('Unsupported client_assertion_type')
  })
})
