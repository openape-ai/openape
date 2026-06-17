#!/usr/bin/env node
/**
 * Migration: repoint deployed persona agents off the dead org.openape.ai to
 * troop (the troop.company.read tool). Replaces the ad-hoc recipe-text repoint
 * with a real, app-mediated, idempotent migration: it re-APPLIES each affected
 * agent's recipe at the given catalog ref (re-materialises from the fixed
 * source — the proper deploy path, not a string-patch).
 *
 * Discovers targets via the troop API (agents whose deployed system_prompt
 * still references org.openape.ai and that carry an agent-catalog recipe_ref),
 * derives each recipe's subdir from its recipe_ref, and re-applies.
 *
 * Usage:
 *   node scripts/migrate-personas-org-to-troop.mjs --dry-run
 *   node scripts/migrate-personas-org-to-troop.mjs --ref <catalog-sha> \
 *     [--org-id <id>] [--org-name <name>]
 *
 * Auth: the owner's cached troop SP token (~/.config/apes/sp-tokens/troop.openape.ai.json).
 * Idempotent: re-running re-applies the same fixed recipe — safe.
 */
import { readFileSync } from 'node:fs'
import os from 'node:os'
import process from 'node:process'

const TROOP = process.env.TROOP_URL || 'https://troop.openape.ai'
const args = process.argv.slice(2)
const has = f => args.includes(f)
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d }

const DRY = has('--dry-run')
const REF = val('--ref', '9b98174aeb2e2490a3cbf4453bb15a46f0c8e8f7')
const ORG_ID = val('--org-id', '38f8e8e9-eec5-440c-b716-6c0f8224270c')
const ORG_NAME = val('--org-name', 'OpenApe Werkstatt')
const STALE = 'org.openape.ai'

function token() {
  const p = `${os.homedir()}/.config/apes/sp-tokens/troop.openape.ai.json`
  const t = JSON.parse(readFileSync(p, 'utf8')).access_token
  if (!t) throw new Error(`no troop token in ${p}`)
  return t
}

// "github.com/openape-ai/agent-catalog/backend-engineer@v0.2.0" -> "backend-engineer"
function subdirOf(recipeRef) {
  const m = /agent-catalog\/([^/@]+)/.exec(recipeRef || '')
  return m ? m[1] : null
}

async function api(path, init, tok) {
  const res = await fetch(`${TROOP}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${tok}`, ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers },
  })
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} -> ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

async function main() {
  const tok = token()
  const list = await api('/api/agents', {}, tok)
  const agents = Array.isArray(list) ? list : (list.agents ?? list.data ?? [])
  const names = agents.map(a => a.agentName ?? a.agent_name ?? a.name).filter(Boolean)

  const targets = []
  for (const name of names) {
    const detail = await api(`/api/agents/${encodeURIComponent(name)}`, {}, tok)
    const ag = detail.agent ?? detail
    const prompt = ag.systemPrompt ?? ag.system_prompt ?? ''
    const ref = ag.recipeRef ?? ag.recipe_ref ?? ''
    if (!prompt.includes(STALE)) continue
    const subdir = subdirOf(ref)
    if (!subdir) { console.log(`SKIP ${name}: stale prompt but no agent-catalog recipe_ref (${ref || 'none'}) — needs manual handling`); continue }
    targets.push({ name, subdir })
  }

  console.log(`\n${targets.length} agent(s) to migrate to ref ${REF}:`)
  for (const t of targets) console.log(`  ${t.name}  <-  ${t.subdir}`)
  if (DRY) { console.log('\n(dry-run — nothing applied)'); return }
  if (!targets.length) return

  for (const t of targets) {
    try {
      await api(`/api/agents/${encodeURIComponent(t.name)}/recipe`, {
        method: 'POST',
        body: JSON.stringify({ repo_ref: `openape-ai/agent-catalog/${t.subdir}@${REF}`, params: { org_id: ORG_ID, org_name: ORG_NAME } }),
      }, tok)
      console.log(`✓ ${t.name} re-applied (${t.subdir}@${REF})`)
    }
    catch (e) {
      console.log(`✗ ${t.name}: ${e.message}`)
    }
  }
}

main().catch((e) => { console.error(e.message); process.exit(1) })
