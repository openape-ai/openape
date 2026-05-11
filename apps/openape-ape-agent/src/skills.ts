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

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface Skill {
  name: string
  description: string
  /** Absolute on-disk path to the SKILL.md the agent should load with file.read. */
  filePath: string
  /**
   * Optional eligibility filter. If any required tool name is *not*
   * in the agent's enabled `tools[]`, the skill is dropped from the
   * formatted prompt — the agent shouldn't see a skill it can't
   * execute. Tools list comes from agent.json.
   */
  requiresTools?: string[]
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
 * Parse YAML-ish frontmatter from the head of a SKILL.md. We accept
 * the openclaw format:
 *
 *   ---
 *   name: <slug>
 *   description: <one-liner>
 *   requires_tools: [time.now, http.get]   # optional
 *   ---
 *   <markdown body…>
 *
 * Returns `null` if no frontmatter is found or the required `name`
 * and `description` fields are missing — those are the only two
 * fields the rest of the system depends on.
 */
export function parseFrontmatter(content: string): {
  name: string
  description: string
  requiresTools?: string[]
} | null {
  const trimmed = content.trimStart()
  if (!trimmed.startsWith('---')) return null
  const closeIdx = trimmed.indexOf('\n---', 3)
  if (closeIdx < 0) return null
  const fmBlock = trimmed.slice(3, closeIdx).trim()

  const fields: Record<string, string> = {}
  let arrayKey: string | null = null
  let arrayBuf: string[] = []
  for (const rawLine of fmBlock.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (arrayKey) {
      const m = line.match(/^[\t ]*-[\t ]+(\S.*)$/)
      if (m) { arrayBuf.push(m[1]!.trim()); continue }
      fields[arrayKey] = arrayBuf.join(',')
      arrayKey = null
      arrayBuf = []
    }
    const kv = line.match(/^([a-z_]\w*)[\t ]*:[\t ]?(.*)$/i)
    if (!kv) continue
    const [, key, value] = kv
    if (value!.trim() === '') {
      arrayKey = key!
      arrayBuf = []
      continue
    }
    // Inline array: `[a, b]`
    const inlineArray = value!.match(/^\[(.*)\]$/)
    if (inlineArray) {
      fields[key!] = inlineArray[1]!.split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean).join(',')
      continue
    }
    fields[key!] = value!.trim().replace(/^["']|["']$/g, '')
  }
  if (arrayKey) fields[arrayKey] = arrayBuf.join(',')

  if (!fields.name || !fields.description) return null
  const requiresTools = fields.requires_tools
    ? fields.requires_tools.split(',').map(s => s.trim()).filter(Boolean)
    : undefined
  return { name: fields.name, description: fields.description, requiresTools }
}

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
  const soul = readSoul(home)
  if (soul) parts.push(soul)
  const skills = composeSkills(home, input.enabledTools)
  const skillsBlock = formatSkillsBlock(skills)
  if (skillsBlock) parts.push(skillsBlock)
  const base = input.base?.trim()
  if (base) parts.push(base)
  return parts.join('\n\n')
}
