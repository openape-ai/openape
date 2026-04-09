import type {
  OpenApeCliAuthorizationDetail,
  OpenApeCliResourceRef,
} from '@openape/core'
import { canonicalizeCliPermission } from './cli-permissions.js'

/** Keys in a selector that are treated as file/path-like for smart suggestions. */
const PATH_LIKE_KEYS = new Set(['path', 'glob', 'file', 'filename', 'uri'])

export type WideningScope = 'exact' | 'sibling-type' | 'directory' | 'subtree' | 'wildcard'

export interface WideningSuggestion {
  /** Stable id for the UI (e.g. "exact", "subtree") */
  scope: WideningScope
  /** Short human-readable label, e.g. "Only this file" or "All .txt in /tmp" */
  label: string
  /** The concrete authorization detail the approver would end up with */
  detail: OpenApeCliAuthorizationDetail
  /** The canonical permission string for display */
  permission: string
}

/**
 * Generate a list of widening suggestions for a single CLI authorization detail.
 * The suggestions are ordered from most-specific to most-wild.
 *
 * For path-like resources (selector has 'path' key etc.), suggestions are derived
 * from path segmentation. For non-path resources, only the full-wildcard option is
 * returned in addition to the exact one.
 *
 * The exact scope is always included as the first suggestion.
 */
export function suggestWideningsForDetail(
  detail: OpenApeCliAuthorizationDetail,
): WideningSuggestion[] {
  const exact = makeSuggestion('exact', 'Exact: this one only', detail, detail.resource_chain)

  // Find the first resource with a path-like selector — that's where we can be smart.
  const chainIdx = detail.resource_chain.findIndex(r => isPathLike(r.selector))
  if (chainIdx < 0) {
    // No path-like selector. Only offer exact and full wildcard on the whole chain.
    const wildcardChain = detail.resource_chain.map(r => ({ resource: r.resource }))
    const wildcard = makeSuggestion('wildcard', 'Any value (wildcard)', detail, wildcardChain)
    return [exact, wildcard]
  }

  const target = detail.resource_chain[chainIdx]!
  const pathKey = findPathKey(target.selector!)!
  const originalPath = target.selector![pathKey]!

  const variants = derivePathVariants(originalPath)
  // Build suggestions for each non-exact variant
  const suggestions = variants
    .filter(v => v.pattern !== originalPath)
    .map((v) => {
      const newChain = detail.resource_chain.map((r, i) => {
        if (i !== chainIdx)
          return { ...r }
        // r.selector is guaranteed to exist because chainIdx was found via isPathLike.
        const nextSelector = { ...r.selector!, [pathKey]: v.pattern }
        return { resource: r.resource, selector: nextSelector }
      })
      return makeSuggestion(v.scope, v.label, detail, newChain)
    })

  // Also provide a full wildcard at the end (drop path selector entirely on target;
  // other chain entries keep their selectors)
  const wildcardChain = detail.resource_chain.map((r, i) =>
    i === chainIdx ? { resource: r.resource } : { ...r },
  )
  const wildcard = makeSuggestion('wildcard', 'Any path (wildcard)', detail, wildcardChain)

  return [exact, ...suggestions, wildcard]
}

/** A single path variant with its scope classification and human label. */
interface PathVariant {
  pattern: string
  scope: WideningScope
  label: string
}

function derivePathVariants(path: string): PathVariant[] {
  const segments = path.split('/').filter(s => s.length > 0)
  const isAbsolute = path.startsWith('/')
  const prefix = isAbsolute ? '/' : ''
  if (segments.length === 0)
    return []

  const variants: PathVariant[] = []
  const fileName = segments.at(-1)!
  const dotIndex = fileName.lastIndexOf('.')
  const extension = dotIndex > 0 ? fileName.slice(dotIndex) : ''
  const parentSegments = segments.slice(0, -1)
  const parentPath = prefix + parentSegments.join('/')

  // Sibling-type: /tmp/foo.txt → /tmp/*.txt
  if (extension && parentSegments.length > 0) {
    variants.push({
      pattern: `${parentPath}/*${extension}`,
      scope: 'sibling-type',
      label: `All ${extension} files in ${parentPath}`,
    })
  }

  // Directory: /tmp/foo.txt → /tmp/*
  if (parentSegments.length > 0) {
    variants.push({
      pattern: `${parentPath}/*`,
      scope: 'directory',
      label: `Any file directly in ${parentPath}`,
    })
  }

  // Subtree: /tmp/foo.txt → /tmp/**
  if (parentSegments.length > 0) {
    variants.push({
      pattern: `${parentPath}/**`,
      scope: 'subtree',
      label: `Everything under ${parentPath}`,
    })
  }

  // Intermediate ancestors: /a/b/c/foo.txt → /a/b/**, /a/**
  for (let i = parentSegments.length - 1; i > 0; i -= 1) {
    const ancestor = prefix + parentSegments.slice(0, i).join('/')
    variants.push({
      pattern: `${ancestor}/**`,
      scope: 'subtree',
      label: `Everything under ${ancestor}`,
    })
  }

  return variants
}

function isPathLike(selector?: Record<string, string>): boolean {
  if (!selector)
    return false
  return Object.keys(selector).some(k => PATH_LIKE_KEYS.has(k))
}

function findPathKey(selector: Record<string, string>): string | undefined {
  return Object.keys(selector).find(k => PATH_LIKE_KEYS.has(k))
}

function makeSuggestion(
  scope: WideningScope,
  label: string,
  base: OpenApeCliAuthorizationDetail,
  chain: OpenApeCliResourceRef[],
): WideningSuggestion {
  const partial = { cli_id: base.cli_id, resource_chain: chain, action: base.action }
  const permission = canonicalizeCliPermission(partial)
  const detail: OpenApeCliAuthorizationDetail = {
    ...base,
    resource_chain: chain,
    permission,
  }
  return { scope, label, detail, permission }
}

/**
 * Build the complete widening_suggestions response for a pending grant.
 * Aggregates per-detail suggestions into a single list the UI can render.
 */
export function buildWideningSuggestionsForGrant(
  details: OpenApeCliAuthorizationDetail[],
): WideningSuggestion[][] {
  return details.map(d => suggestWideningsForDetail(d))
}
