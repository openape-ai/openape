import type { DefaultAction, GrantRule, Rules } from './types'
import { readFileSync } from 'node:fs'

interface TomlRulesFile {
  default_action?: DefaultAction
  rules: Rules
}

/**
 * Parse a simple TOML rules file.
 * Supports [[allow]], [[deny]], [[grant_required]] arrays of tables.
 */
export function parseRulesFile(path: string): TomlRulesFile {
  const content = readFileSync(path, 'utf-8')
  return parseRulesToml(content)
}

export function parseRulesToml(content: string): TomlRulesFile {
  const result: TomlRulesFile = { rules: {} }
  const allow: { pattern: string }[] = []
  const deny: { pattern: string }[] = []
  const grantRequired: GrantRule[] = []

  let currentSection: 'root' | 'allow' | 'deny' | 'grant_required' = 'root'
  let currentEntry: Record<string, unknown> = {}
  let hasEntry = false

  function flushEntry() {
    if (!hasEntry)
      return
    if (currentSection === 'allow' && currentEntry.pattern) {
      allow.push({ pattern: currentEntry.pattern as string })
    }
    else if (currentSection === 'deny' && currentEntry.pattern) {
      deny.push({ pattern: currentEntry.pattern as string })
    }
    else if (currentSection === 'grant_required' && currentEntry.pattern) {
      const rule: GrantRule = { pattern: currentEntry.pattern as string }
      if (currentEntry.methods)
        rule.methods = currentEntry.methods as string[]
      if (currentEntry.approval)
        rule.approval = currentEntry.approval as GrantRule['approval']
      if (currentEntry.duration)
        rule.duration = currentEntry.duration as string
      if (currentEntry.include_body !== undefined)
        rule.includeBody = currentEntry.include_body as boolean
      grantRequired.push(rule)
    }
    currentEntry = {}
    hasEntry = false
  }

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#'))
      continue

    // Array of tables: [[section]]
    const arrayMatch = line.match(/^\[\[(\w+)\]\]$/)
    if (arrayMatch) {
      flushEntry()
      currentSection = arrayMatch[1] as typeof currentSection
      hasEntry = true
      continue
    }

    // Root-level key = value (before any [[section]])
    if (currentSection === 'root') {
      const kvMatch = parseKeyValue(line)
      if (kvMatch) {
        result[kvMatch.key as keyof TomlRulesFile] = parseTomlValue(kvMatch.value) as never
      }
      continue
    }

    // Key = value inside a section entry
    const kvMatch = parseKeyValue(line)
    if (kvMatch) {
      currentEntry[kvMatch.key] = parseTomlValue(kvMatch.value)
      hasEntry = true
    }
  }

  flushEntry()

  if (allow.length)
    result.rules.allow = allow
  if (deny.length)
    result.rules.deny = deny
  if (grantRequired.length)
    result.rules.grantRequired = grantRequired

  return result
}

function parseKeyValue(line: string): { key: string, value: string } | null {
  const eqIndex = line.indexOf('=')
  if (eqIndex === -1)
    return null
  const key = line.slice(0, eqIndex).trim()
  const value = line.slice(eqIndex + 1).trim()
  if (!key || !/^\w+$/.test(key) || !value)
    return null
  return { key, value }
}

function parseTomlValue(raw: string): unknown {
  const trimmed = raw.trim()

  // String
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1)
  }

  // Boolean
  if (trimmed === 'true')
    return true
  if (trimmed === 'false')
    return false

  // Number
  if (/^\d+$/.test(trimmed))
    return Number(trimmed)

  // Array of strings: ["a", "b"]
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim()
    if (!inner)
      return []
    return inner.split(',').map(s => s.trim().replace(/^"|"$/g, ''))
  }

  return trimmed
}
