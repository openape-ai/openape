export { buildCliAuthDetail, matchArgvToOperation, type ShapeMatchOperation } from './shape-matcher.js'
export {
  canonicalizeCliPermission,
  cliAuthorizationDetailCovers,
  cliAuthorizationDetailIsSimilar,
  cliAuthorizationDetailsCover,
  type CliAuthorizationDetailValidationResult,
  computeArgvHash,
  coverableCliDetails,
  findDifferingSelectors,
  isCliAuthorizationDetailExact,
  isCoverableCliDetail,
  mergeCliAuthorizationDetails,
  resourceChainsStructurallyMatch,
  selectorValueMatches,
  validateCliAuthorizationDetail,
  widenCliAuthorizationDetail,
} from './cli-permissions.js'
export {
  COMMAND_TOKEN_LIFETIME_SECONDS,
  type CommandTokenCall,
  issueAuthzJWT,
  issueCommandJWT,
  spentByCommandToken,
  verifyAuthzJWT,
  type VerifyAuthzOptions,
} from './authz-jwt.js'
export {
  approveGrant,
  approveGrantWithExtension,
  approveGrantWithWidening,
  assertGrantBatchMember,
  type ApproveGrantOverrides,
  createDelegation,
  createGrant,
  denyGrant,
  InvalidGrantBatchError,
  type ExtendMode,
  introspectGrant,
  isCallerWaiting,
  isGrantExpired,
  parseGrantBatch,
  revokeGrant,
  useGrant,
  validateDelegation,
} from './grants.js'
export {
  InvalidGrantSummaryError,
  migrateLegacyGrantSummary,
  parseGrantSummary,
} from './grant-summary.js'
export {
  type LocalizedText,
  parseShapeCliVersions,
  parseShapePresentation,
  type PresentationBindings,
  presentationBindings,
  readCliVersion,
  type ShapeCliVersions,
  type ShapePresentation,
  type ShapePresentationConsequence,
  type ShapePresentationField,
  type ShapePresentationFormat,
  type ShapePresentationRequirements,
} from './shape-presentation.js'
export {
  createInMemoryShapeStore,
  type ServerShape,
  type ServerShapeOperation,
  type ShapeStore,
} from './shape-registry.js'
export {
  InvalidProgramAuthorizeRequestError,
  isVirtualShape,
  parseProgramAuthorizeRequest,
  PROGRAM_AUTHORIZE_LIMITS,
  type ProgramShapeSelection,
  resolveProgramCall,
  type ResolvedProgramCall,
  selectProgramShape,
} from './program-authorization.js'
export {
  buildGenericResolvedServer,
  GENERIC_OPERATION_ID,
  resolveServerShape,
  type ServerResolvedCommand,
} from './server-resolver.js'
export {
  buildSafeCommandRequest,
  type BuildSafeCommandRequestParams,
  isDefaultSafeCommandGrant,
  isSafeCommandGrant,
  SAFE_COMMAND_DEFAULTS,
  SAFE_COMMAND_REASON_CUSTOM,
  SAFE_COMMAND_REASON_DEFAULT,
  type SafeCommandDefinition,
} from './safe-commands.js'
export { findSimilarCliGrants, type SimilarGrantMatch, type SimilarGrantsResult } from './similarity.js'
export {
  buildCoverageDetailFromStandingGrant,
  evaluateStandingGrants,
  isStandingGrantRequest,
  type StandingGrantMatch,
  type StandingGrantRequest,
} from './standing-grants.js'
export { type GrantListParams, type GrantStore, InMemoryGrantStore } from './stores.js'
export {
  buildWideningSuggestionsForGrant,
  suggestWideningsForDetail,
  type WideningScope,
  type WideningSuggestion,
} from './widening-suggestions.js'

export * from './brokering.js'
