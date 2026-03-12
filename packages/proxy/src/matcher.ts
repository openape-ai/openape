import type { ProxyConfig, RuleAction, RuleEntry } from './types.js'

/**
 * Match a glob pattern against a string.
 * Supports * (any segment) and ** (any number of segments).
 */
function globMatch(pattern: string, value: string): boolean {
  // Simple glob: convert * to regex
  const regex = new RegExp(
    '^' +
    pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // escape regex chars except *
      .replace(/\*\*/g, '<<<DOUBLESTAR>>>')
      .replace(/\*/g, '[^/]*')
      .replace(/<<<DOUBLESTAR>>>/g, '.*')
    + '$'
  )
  return regex.test(value)
}

function matchesRule(rule: RuleEntry, domain: string, method: string, path: string): boolean {
  // Domain match (supports wildcards like *.github.com)
  if (!globMatch(rule.domain, domain)) return false

  // Method match (if specified)
  if (rule.methods && rule.methods.length > 0) {
    if (!rule.methods.includes(method.toUpperCase())) return false
  }

  // Path match (if specified)
  if (rule.path) {
    if (!globMatch(rule.path, path)) return false
  }

  return true
}

/**
 * Evaluate rules in order: deny → allow → grant_required → default_action
 */
export function evaluateRules(
  config: ProxyConfig,
  domain: string,
  method: string,
  path: string,
): RuleAction {
  // 1. Check deny list first
  for (const rule of config.deny) {
    if (matchesRule(rule, domain, method, path)) {
      return { type: 'deny', note: rule.note }
    }
  }

  // 2. Check allow list
  for (const rule of config.allow) {
    if (matchesRule(rule, domain, method, path)) {
      return { type: 'allow' }
    }
  }

  // 3. Check grant_required rules (most specific first)
  for (const rule of config.grant_required) {
    if (matchesRule(rule, domain, method, path)) {
      return { type: 'grant_required', rule }
    }
  }

  // 4. Default: treat as grant_required with 'once'
  if (config.proxy.default_action === 'block') {
    return { type: 'deny', note: 'No matching rule (default: block)' }
  }

  return {
    type: 'grant_required',
    rule: {
      domain: '*',
      grant_type: 'once',
    },
  }
}
