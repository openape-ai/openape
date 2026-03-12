import type { DefaultAction, GrantRule, RouteDecision, Rules, SimpleRule } from './types'

/**
 * Convert a rule pattern to a RegExp.
 * Supports:
 *  - `*` as wildcard for a single path/domain segment
 *  - `**` as wildcard for any number of segments
 *  - `*.example.com` matches any subdomain
 *  - `example.com/admin/*` matches any path under /admin/
 */
export function patternToRegExp(pattern: string): RegExp {
  // Split into domain and path parts
  let domainPattern: string
  let pathPattern: string | undefined

  const slashIndex = pattern.indexOf('/')
  if (slashIndex !== -1) {
    domainPattern = pattern.slice(0, slashIndex)
    pathPattern = pattern.slice(slashIndex)
  }
  else {
    domainPattern = pattern
  }

  // Convert a pattern segment to regex:
  // 1. Replace ** with placeholder
  // 2. Replace * with placeholder
  // 3. Escape remaining regex chars
  // 4. Replace placeholders with regex equivalents
  function convertSegment(s: string): string {
    const DOUBLE_STAR = '\0DOUBLE_STAR\0'
    const SINGLE_STAR = '\0SINGLE_STAR\0'

    let result = s
    result = result.replaceAll('**', DOUBLE_STAR)
    result = result.replaceAll('*', SINGLE_STAR)
    result = result.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    result = result.replaceAll(DOUBLE_STAR, '.*')
    result = result.replaceAll(SINGLE_STAR, '[^./]*')
    return result
  }

  let regexStr = '^https?://'
  regexStr += convertSegment(domainPattern)

  if (pathPattern) {
    regexStr += convertSegment(pathPattern)
  }
  else {
    // Match any path (or no path)
    regexStr += '(/.*)?'
  }

  regexStr += '$'

  return new RegExp(regexStr, 'i')
}

function normalizePattern(rule: string | SimpleRule | GrantRule): string {
  return typeof rule === 'string' ? rule : rule.pattern
}

/**
 * Check if a URL matches any rule in a list.
 */
export function matchesRuleList(url: string, rules?: (string | SimpleRule)[]): boolean {
  if (!rules || rules.length === 0)
    return false
  return rules.some((rule) => {
    const pattern = normalizePattern(rule)
    return patternToRegExp(pattern).test(url)
  })
}

/**
 * Find the first matching grant rule for a URL + method.
 */
export function findGrantRule(
  url: string,
  method: string,
  rules?: (string | GrantRule)[],
): GrantRule | null {
  if (!rules || rules.length === 0)
    return null

  for (const rule of rules) {
    const grantRule: GrantRule = typeof rule === 'string' ? { pattern: rule } : rule
    if (!patternToRegExp(grantRule.pattern).test(url))
      continue

    // Check method filter
    if (grantRule.methods && grantRule.methods.length > 0) {
      if (!grantRule.methods.some(m => m.toUpperCase() === method.toUpperCase())) {
        continue
      }
    }

    return grantRule
  }

  return null
}

/**
 * Evaluate a URL + method against the full rule set.
 * Returns the decision: allow, deny, or grant_required (with the matched rule).
 */
export function evaluateRequest(
  url: string,
  method: string,
  rules: Rules,
  defaultAction: DefaultAction = 'deny',
): RouteDecision | { decision: 'grant_required', rule: GrantRule } {
  // 1. Deny list — highest priority
  if (matchesRuleList(url, rules.deny)) {
    return 'deny'
  }

  // 2. Check for specific grant_required rule (even if URL is in allow list)
  const grantRule = findGrantRule(url, method, rules.grantRequired)
  if (grantRule) {
    return { decision: 'grant_required', rule: grantRule }
  }

  // 3. Allow list
  if (matchesRuleList(url, rules.allow)) {
    return 'allow'
  }

  // 4. Default action
  if (defaultAction === 'grant_required') {
    return { decision: 'grant_required', rule: { pattern: '*' } }
  }

  return defaultAction
}
