export {
  canonicalizeCliPermission,
  cliAuthorizationDetailCovers,
  cliAuthorizationDetailIsSimilar,
  cliAuthorizationDetailsCover,
  type CliAuthorizationDetailValidationResult,
  computeArgvHash,
  findDifferingSelectors,
  isCliAuthorizationDetailExact,
  mergeCliAuthorizationDetails,
  resourceChainsStructurallyMatch,
  validateCliAuthorizationDetail,
  widenCliAuthorizationDetail,
} from './cli-permissions.js'
export {
  issueAuthzJWT,
  verifyAuthzJWT,
  type VerifyAuthzOptions,
} from './authz-jwt.js'
export {
  approveGrant,
  approveGrantWithExtension,
  approveGrantWithWidening,
  type ApproveGrantOverrides,
  createDelegation,
  createGrant,
  denyGrant,
  type ExtendMode,
  introspectGrant,
  revokeGrant,
  useGrant,
  validateDelegation,
} from './grants.js'
export {
  createInMemoryShapeStore,
  type ServerShape,
  type ServerShapeOperation,
  type ShapeStore,
} from './shape-registry.js'
export { findSimilarCliGrants, type SimilarGrantMatch, type SimilarGrantsResult } from './similarity.js'
export { type GrantListParams, type GrantStore, InMemoryGrantStore } from './stores.js'
export {
  buildWideningSuggestionsForGrant,
  suggestWideningsForDetail,
  type WideningScope,
  type WideningSuggestion,
} from './widening-suggestions.js'
