// The Codex Responses backend validates each function tool's `parameters`
// schema more strictly than the Chat-Completions spec agents emit against:
//
//  1. The top-level schema must be a plain object. A top-level combinator
//     (`allOf`/`anyOf`/`oneOf`/`enum`/`not`) — which MCP tools routinely add for
//     conditional-required hints — is rejected with
//     "Invalid schema for function 'X': schema must have type 'object'".
//  2. Nullable unions expressed as a `{type:'null'}` branch or a `type:['X','null']`
//     array are rejected; the backend wants a single type plus a `nullable` hint.
//
// `sanitizeToolParameters` rewrites a schema into the accepted shape without
// changing what it means to the model. It first collapses nullable unions
// (bottom-up, so nested ones are caught), then strips the top-level combinators.
// Collapsing runs first because a top-level nullable union carries the real
// schema in its non-null branch — stripping it blindly would discard that.
//
// Ported from NousResearch/hermes-agent (`tools/schema_sanitizer.py`).

const TOP_LEVEL_COMBINATORS: readonly string[] = ['allOf', 'anyOf', 'oneOf', 'enum', 'not']
const NULLABLE_UNION_KEYS: readonly string[] = ['anyOf', 'oneOf']

function isObject(node: unknown): node is Record<string, unknown> {
  return typeof node === 'object' && node !== null && !Array.isArray(node)
}

function isNullSchema(node: unknown): boolean {
  return isObject(node) && node.type === 'null'
}

// `type: ['string', 'null']` → the single non-null type, or null if not a
// simple nullable pair (e.g. `['string', 'number']` stays a union).
function collapsibleNonNullType(types: unknown[]): unknown | null {
  if (!types.includes('null'))
    return null
  const nonNull = types.filter(t => t !== 'null')
  return nonNull.length === 1 ? nonNull[0] : null
}

// `anyOf: [{...}, {type:'null'}]` → the single non-null branch, or null if the
// union isn't a simple nullable wrapper around exactly one schema.
function collapsibleNonNullBranch(branches: unknown[]): Record<string, unknown> | null {
  if (!branches.some(isNullSchema))
    return null
  const nonNull = branches.filter(b => !isNullSchema(b))
  return nonNull.length === 1 && isObject(nonNull[0]) ? nonNull[0] : null
}

function collapseObjectNode(node: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node))
    result[key] = sanitizeNode(value)

  if (Array.isArray(result.type)) {
    const nonNullType = collapsibleNonNullType(result.type)
    if (nonNullType !== null) {
      result.type = nonNullType
      result.nullable = true
    }
  }

  for (const key of NULLABLE_UNION_KEYS) {
    if (!Array.isArray(result[key]))
      continue
    const branch = collapsibleNonNullBranch(result[key])
    if (!branch)
      continue
    delete result[key]
    // Merge the surviving branch up, but let the parent's own annotations
    // (description, title, …) win over the branch's.
    for (const [k, v] of Object.entries(branch)) {
      if (!(k in result))
        result[k] = v
    }
    result.nullable = true
  }

  return result
}

function sanitizeNode(node: unknown): unknown {
  if (Array.isArray(node))
    return node.map(sanitizeNode)
  if (isObject(node))
    return collapseObjectNode(node)
  return node
}

function stripTopLevelCombinators(node: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) {
    if (!TOP_LEVEL_COMBINATORS.includes(key))
      result[key] = value
  }
  return result
}

/**
 * Rewrite a function tool's JSON-Schema `parameters` into the shape the Codex
 * Responses backend accepts: nullable unions collapsed to a single type plus a
 * `nullable` hint, and top-level combinators removed. Returns a deep copy — the
 * input is never mutated.
 */
export function sanitizeToolParameters(params: Record<string, unknown>): Record<string, unknown> {
  return stripTopLevelCombinators(collapseObjectNode(params))
}
