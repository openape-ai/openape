import { createApp, createRouter } from 'h3'
import {
  InMemoryCodeStore,
  InMemoryGrantChallengeStore,
  InMemoryJtiStore,
  InMemoryKeyStore,
  InMemoryRefreshTokenStore,
  InMemorySshKeyStore,
  InMemoryUserStore,
} from '@openape/auth'
import { InMemoryGrantStore } from '@openape/grants'
import type { IdPConfig, IdPInstance, IdPStores } from './config.js'
import {
  createAddSshKeyHandler,
  createApproveGrantHandler,
  createAuthenticateHandler,
  createAuthorizeHandler,
  createBatchGrantHandler,
  createChallengeHandler,
  createConsumeGrantHandler,
  createCreateDelegationHandler,
  createCreateGrantHandler,
  createCreateUserHandler,
  createDeleteSshKeyHandler,
  createDeleteUserHandler,
  createDenyGrantHandler,
  createDiscoveryHandler,
  createEnrollHandler,
  createGetGrantHandler,
  createGrantTokenHandler,
  createJWKSHandler,
  createListDelegationsHandler,
  createListGrantsHandler,
  createListSshKeysHandler,
  createListUsersHandler,
  createLoginPageHandler,
  createRevokeDelegationHandler,
  createRevokeGrantHandler,
  createSessionLoginHandler,
  createSessionLogoutHandler,
  createTokenHandler,
  createValidateDelegationHandler,
  createVerifyGrantHandler,
} from './handlers/index.js'

function createDefaultStores(): IdPStores {
  return {
    userStore: new InMemoryUserStore(),
    sshKeyStore: new InMemorySshKeyStore(),
    keyStore: new InMemoryKeyStore(),
    codeStore: new InMemoryCodeStore(),
    challengeStore: new InMemoryGrantChallengeStore(),
    grantStore: new InMemoryGrantStore(),
    jtiStore: new InMemoryJtiStore(),
    refreshTokenStore: new InMemoryRefreshTokenStore(),
  }
}

export function createIdPApp(config: IdPConfig, stores?: Partial<IdPStores>): IdPInstance {
  const resolvedStores: IdPStores = { ...createDefaultStores(), ...stores }
  const app = createApp()
  const router = createRouter()

  // Auth
  router.post('/api/auth/challenge', createChallengeHandler(resolvedStores, config))
  router.post('/api/auth/authenticate', createAuthenticateHandler(resolvedStores, config))
  router.post('/api/auth/enroll', createEnrollHandler(resolvedStores, config))

  // Session (browser flow)
  router.get('/login', createLoginPageHandler())
  router.post('/api/session/login', createSessionLoginHandler(resolvedStores, config))
  router.post('/api/session/logout', createSessionLogoutHandler(resolvedStores, config))

  // OIDC
  router.get('/authorize', createAuthorizeHandler(resolvedStores, config))
  router.post('/token', createTokenHandler(resolvedStores, config))
  router.get('/.well-known/jwks.json', createJWKSHandler(resolvedStores))
  router.get('/.well-known/openid-configuration', createDiscoveryHandler(config))

  // Grants
  router.get('/api/grants', createListGrantsHandler(resolvedStores, config))
  router.post('/api/grants', createCreateGrantHandler(resolvedStores, config))
  router.post('/api/grants/verify', createVerifyGrantHandler(resolvedStores, config))
  router.post('/api/grants/batch', createBatchGrantHandler(resolvedStores, config))
  router.get('/api/grants/:id', createGetGrantHandler(resolvedStores))
  router.post('/api/grants/:id/approve', createApproveGrantHandler(resolvedStores, config))
  router.post('/api/grants/:id/deny', createDenyGrantHandler(resolvedStores, config))
  router.post('/api/grants/:id/revoke', createRevokeGrantHandler(resolvedStores, config))
  router.post('/api/grants/:id/token', createGrantTokenHandler(resolvedStores, config))
  router.post('/api/grants/:id/consume', createConsumeGrantHandler(resolvedStores))

  // Delegations
  router.post('/api/delegations', createCreateDelegationHandler(resolvedStores, config))
  router.get('/api/delegations', createListDelegationsHandler(resolvedStores, config))
  router.delete('/api/delegations/:id', createRevokeDelegationHandler(resolvedStores, config))
  router.post('/api/delegations/:id/validate', createValidateDelegationHandler(resolvedStores, config))

  // Admin
  router.get('/api/admin/users', createListUsersHandler(resolvedStores, config))
  router.post('/api/admin/users', createCreateUserHandler(resolvedStores, config))
  router.delete('/api/admin/users/:email', createDeleteUserHandler(resolvedStores, config))
  router.post('/api/admin/users/:email/ssh-keys', createAddSshKeyHandler(resolvedStores, config))
  router.get('/api/admin/users/:email/ssh-keys', createListSshKeysHandler(resolvedStores, config))
  router.delete('/api/admin/users/:email/ssh-keys/:keyId', createDeleteSshKeyHandler(resolvedStores, config))

  app.use(router)
  return { app, stores: resolvedStores }
}
