// Skills + SOUL loader for the agent runtime.
//
// Pattern lifted from OpenClaw's skill-contract.ts (see
// `Companies/delta-mind/repos/openclaw/src/agents/skills/`): the LLM
// gets a *list* of available skills in its system prompt — each entry is
// just `name`, `description`, and an on-disk location. The agent loads
// the full SKILL.md body lazily, via the regular `file.read` tool, when
// the task matches the description. That keeps cold-start context small
// even as the skill catalog grows.
//
// SOUL.md is the always-on counterpart: a single markdown file that
// describes who the agent is, language preferences, tone, hard rules.
// We merge it ahead of the task-time system prompt so it's the first
// thing the model sees.
//
// Layout (all under the agent's $HOME):
//
//     ~/.openape/agent/
//       agent.json                   ← tools + base systemPrompt (from troop)
//       SOUL.md                      ← always-on persona / rules
//       skills/
//         <name>/SKILL.md            ← lazy-loaded skill instructions
//
// The bridge also bundles a default skills directory (see
// `default-skills/` in this package). Those are merged with the agent's
// own skills before formatting the prompt. Default skills can be
// shadowed by an agent-side skill of the same name — that's how an
// owner overrides the bundled `bash` skill with their own variant.

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

export interface Skill {
  name: string
  description: string
  /** Absolute on-disk path to the SKILL.md the agent should load with file.read. */
  filePath: string
  /**
   * Optional eligibility filter. If any required tool name is *not*
   * in the agent's enabled `tools[]`, the skill is dropped from the
   * formatted prompt — the agent shouldn't see a skill it can't
   * execute. Tools list comes from agent.json. Sourced from either
   * the legacy top-level `requires_tools` or the nested
   * `metadata.openape.requires_tools`.
   */
  requiresTools?: string[]
  /**
   * Optional eligibility filter on host-PATH binaries. Mirrors
   * OpenClaw's `metadata.openclaw.requires.bins` — a skill that
   * expects `o365-cli` to be installed lists it here, and we drop
   * the skill from the prompt on hosts where the binary is missing.
   * Resolved via `which` once per scan; result is cached for the
   * lifetime of the process. Sourced from either openclaw or
   * openape metadata namespaces — same semantics.
   */
  requiresBins?: string[]
}

const SKILLS_SUBDIR = ['.openape', 'agent', 'skills']
const SOUL_PATH_PARTS = ['.openape', 'agent', 'SOUL.md']

export function soulPath(home: string = homedir()): string {
  return join(home, ...SOUL_PATH_PARTS)
}

export function skillsDir(home: string = homedir()): string {
  return join(home, ...SKILLS_SUBDIR)
}

/**
 * Read the agent's SOUL.md if present, else return null. Errors
 * (permission denied, broken symlinks) get swallowed — SOUL is a soft
 * input, not a fail-fast prerequisite.
 */
export function readSoul(home: string = homedir()): string | null {
  const path = soulPath(home)
  if (!existsSync(path)) return null
  try {
    const body = readFileSync(path, 'utf8').trim()
    return body.length > 0 ? body : null
  }
  catch { return null }
}

/**
 * Parse YAML frontmatter from the head of a SKILL.md. We accept three
 * frontmatter shapes so a SKILL.md published on clawhub.ai (the
 * OpenClaw skill registry) drops into our runtime without
 * modification:
 *
 *   # Legacy / openape-flat (current default-skills):
 *   ---
 *   name: <slug>
 *   description: <one-liner>
 *   requires_tools: [time.now, http.get]
 *   ---
 *
 *   # OpenClaw-aligned (what clawhub.ai skills use):
 *   ---
 *   name: <slug>
 *   description: <one-liner>
 *   metadata:
 *     openclaw:
 *       emoji: 📊
 *       os: ["darwin"]
 *       requires:
 *         bins: ["o365-cli"]
 *   ---
 *
 *   # openape-namespaced (additive — coexists with openclaw block):
 *   ---
 *   name: <slug>
 *   description: <one-liner>
 *   metadata:
 *     openape:
 *       requires_tools: [mail.list]
 *   ---
 *
 * Returns `null` if no frontmatter is found or the required `name`
 * and `description` fields are missing — those are the only two
 * fields the rest of the system depends on. Falls back to legacy
 * flat keys when the metadata block is absent.
 */
export function parseFrontmatter(content: string): {
  name: string
  description: string
  requiresTools?: string[]
  requiresBins?: string[]
} | null {
  const trimmed = content.trimStart()
  if (!trimmed.startsWith('---')) return null
  const closeIdx = trimmed.indexOf('\n---', 3)
  if (closeIdx < 0) return null
  const fmBlock = trimmed.slice(3, closeIdx).trim()

  let parsed: unknown
  try { parsed = parseYaml(fmBlock) }
  catch { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const fields = parsed as Record<string, unknown>

  const name = typeof fields.name === 'string' ? fields.name.trim() : ''
  const description = typeof fields.description === 'string' ? fields.description.trim() : ''
  if (!name || !description) return null

  function asStringArray(v: unknown): string[] | undefined {
    if (!Array.isArray(v)) return undefined
    const out = v
      .map(x => typeof x === 'string' ? x.trim() : '')
      .filter(s => s.length > 0)
    return out.length > 0 ? out : undefined
  }

  // Tool eligibility: openape namespace first, then top-level
  // requires_tools (legacy/back-compat). OpenClaw doesn't have a
  // direct equivalent — they use `requires.bins` instead.
  const meta = (fields.metadata && typeof fields.metadata === 'object' && !Array.isArray(fields.metadata))
    ? fields.metadata as Record<string, unknown>
    : {}
  const openapeMeta = (meta.openape && typeof meta.openape === 'object' && !Array.isArray(meta.openape))
    ? meta.openape as Record<string, unknown>
    : {}
  const openclawMeta = (meta.openclaw && typeof meta.openclaw === 'object' && !Array.isArray(meta.openclaw))
    ? meta.openclaw as Record<string, unknown>
    : {}

  const requiresTools = asStringArray(openapeMeta.requires_tools) ?? asStringArray(fields.requires_tools)

  // Binary eligibility: openclaw namespace canonical form, also
  // accept openape.requires.bins as a mirror. Top-level
  // `requires_bins` is supported as a legacy/flat alias.
  function readRequiresBins(scope: Record<string, unknown>): string[] | undefined {
    const requires = scope.requires
    if (requires && typeof requires === 'object' && !Array.isArray(requires)) {
      return asStringArray((requires as Record<string, unknown>).bins)
    }
    return undefined
  }
  const requiresBins
    = readRequiresBins(openclawMeta)
      ?? readRequiresBins(openapeMeta)
      ?? asStringArray(fields.requires_bins)

  return { name, description, requiresTools, requiresBins }
}

// Cache binary-on-PATH lookups for the lifetime of the process.
// The skills scan runs on every new ThreadSession, so we'd otherwise
// re-shell out to `which o365-cli` many times per chat session for
// no gain — paths don't change at runtime.
const binCheckCache = new Map<string, boolean>()

function hasBinaryOnPath(bin: string): boolean {
  const cached = binCheckCache.get(bin)
  if (cached !== undefined) return cached
  let found = false
  try {
    execFileSync('/usr/bin/which', [bin], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    found = true
  }
  catch { /* missing */ }
  binCheckCache.set(bin, found)
  return found
}

// Test-only: reset the cache so unit tests don't leak across cases.
export const _internalSkillsCacheReset = () => binCheckCache.clear()

/**
 * Scan a directory of `<name>/SKILL.md` skills and return the parsed
 * list. Skills whose frontmatter is malformed or whose file can't be
 * read are silently skipped — better to lose one skill than break the
 * boot path with a syntax error.
 */
export function scanSkillsDir(dir: string): Skill[] {
  if (!existsSync(dir)) return []
  let entries: string[]
  try { entries = readdirSync(dir) }
  catch { return [] }

  const out: Skill[] = []
  for (const entry of entries) {
    const skillPath = join(dir, entry, 'SKILL.md')
    if (!existsSync(skillPath)) continue
    let st
    try { st = statSync(skillPath) }
    catch { continue }
    if (!st.isFile()) continue
    let body: string
    try { body = readFileSync(skillPath, 'utf8') }
    catch { continue }
    const fm = parseFrontmatter(body)
    if (!fm) continue
    out.push({
      name: fm.name,
      description: fm.description,
      filePath: skillPath,
      requiresTools: fm.requiresTools,
      requiresBins: fm.requiresBins,
    })
  }
  return out
}

/**
 * Resolve the bundled `default-skills/` directory that ships with the
 * ape-agent package. `__dirname` after tsup bundling sits next to
 * `bridge.mjs`; the `default-skills/` folder is published alongside
 * it (see `files` in package.json + the post-build copy step).
 */
export function defaultSkillsDir(): string {
  // import.meta.url works for both ESM and tsup's bundled output
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, '..', 'default-skills')
}

/**
 * Compose the final skill list the agent sees. Default skills load
 * first, then agent-side skills override by name. The result is
 * deduplicated (last-write-wins on name) and filtered against the
 * agent's enabled tools — a skill whose `requiresTools` aren't in
 * `enabledTools` is dropped, so the agent never sees a skill it
 * can't actually execute.
 */
export function composeSkills(home: string, enabledTools: string[]): Skill[] {
  const enabled = new Set(enabledTools)
  const byName = new Map<string, Skill>()
  for (const s of scanSkillsDir(defaultSkillsDir())) byName.set(s.name, s)
  for (const s of scanSkillsDir(skillsDir(home))) byName.set(s.name, s)

  const out: Skill[] = []
  for (const s of byName.values()) {
    if (s.requiresTools && s.requiresTools.length > 0) {
      const allPresent = s.requiresTools.every(t => enabled.has(t))
      if (!allPresent) continue
    }
    if (s.requiresBins && s.requiresBins.length > 0) {
      const allBinsPresent = s.requiresBins.every(b => hasBinaryOnPath(b))
      if (!allBinsPresent) continue
    }
    out.push(s)
  }
  // Stable order: by name. Helps prompt-cache stay warm across boots.
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Format the skill list as an `<available_skills>` block for the
 * system prompt. The wording mirrors OpenClaw's formatter so the
 * model picks up on the established convention: name + description
 * stay in the prompt, body gets loaded on demand via the file.read
 * tool when the task matches.
 */
export function formatSkillsBlock(skills: Skill[]): string {
  if (skills.length === 0) return ''
  const lines = [
    '',
    'The following skills provide specialized instructions for specific tasks.',
    'Use the file.read tool to load a skill\'s file when the user\'s task matches its description.',
    'When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md) and use that absolute path in tool commands.',
    '',
    '<available_skills>',
  ]
  for (const s of skills) {
    lines.push('  <skill>')
    lines.push(`    <name>${escapeXml(s.name)}</name>`)
    lines.push(`    <description>${escapeXml(s.description)}</description>`)
    lines.push(`    <location>${escapeXml(s.filePath)}</location>`)
    lines.push('  </skill>')
  }
  lines.push('</available_skills>')
  return lines.join('\n')
}

/**
 * Build the final system prompt the agent runtime sends to the LLM:
 *
 *   <SOUL.md, if any>
 *
 *   <available_skills>…</available_skills>
 *
 *   <base systemPrompt from agent.json>
 *
 * Each section is omitted when empty so we don't pollute the prompt
 * with empty blocks.
 */
export function composeSystemPrompt(input: {
  base: string
  home?: string
  enabledTools: string[]
}): string {
  const home = input.home ?? homedir()
  const parts: string[] = []
  // Hidden baseline persona — bundled in this package as
  // `default-persona.md`. Every agent gets it as the very first block
  // of the system prompt, so even a brand-new agent with an empty
  // owner-side system_prompt has a coherent "who am I" foundation.
  // Adapted from OpenClaw's SOUL.md template.
  const defaultPersona = readDefaultPersona()
  if (defaultPersona) parts.push(defaultPersona)
  // SOUL.md was merged into `base` (system_prompt) — owners now author
  // a single markdown document there. readSoul() still exists for
  // legacy installs that haven't run `apes agents sync` post-merge;
  // honour it if present so we don't strand existing personas, but
  // new agents never write it.
  const soul = readSoul(home)
  if (soul) parts.push(soul)
  const skills = composeSkills(home, input.enabledTools)
  const skillsBlock = formatSkillsBlock(skills)
  if (skillsBlock) parts.push(skillsBlock)
  const base = input.base?.trim()
  if (base) parts.push(base)
  return parts.join('\n\n')
}

/**
 * Read the bundled `default-persona.md` next to the published bundle.
 * `bridge.mjs` sits in `dist/`; the file ships at the package root
 * via the `files` array in package.json. Returns null when the file
 * isn't present (older installs, broken layout) — composeSystemPrompt
 * silently degrades to the no-persona case.
 */
let _defaultPersonaCache: string | null | undefined
function readDefaultPersona(): string | null {
  if (_defaultPersonaCache !== undefined) return _defaultPersonaCache
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const path = resolve(here, '..', 'default-persona.md')
    if (!existsSync(path)) {
      _defaultPersonaCache = null
      return null
    }
    const raw = readFileSync(path, 'utf8').trim()
    _defaultPersonaCache = raw.length > 0 ? raw : null
    return _defaultPersonaCache
  }
  catch {
    _defaultPersonaCache = null
    return null
  }
}
