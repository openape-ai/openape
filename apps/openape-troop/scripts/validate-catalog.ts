// Validate every recipe in the agent-catalog against the REAL troop parser +
// deploy-time materializer. This is the proof that each persona recipe is
// actually deployable: parse → resolve params → interpolate intent / schedules
// with no unresolved placeholders left.
//
// Run from apps/openape-troop:  pnpm tsx scripts/validate-catalog.ts
//   (optionally pass the catalog dir as argv[2])

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { materializeRecipe, parseRecipe } from '../server/utils/agent-recipe'

const CATALOG = resolve(
  process.argv[2]
  ?? join(import.meta.dirname, '..', '..', '..', '..', 'agent-catalog'),
)

// Sample params every persona needs; forge_base has a recipe default so coding
// personas don't strictly need it supplied.
const SAMPLE = { org_id: '00000000-0000-0000-0000-000000000000', org_name: 'Acme Test GmbH' }

function personaDirs(): string[] {
  return readdirSync(CATALOG)
    .filter(name => !name.startsWith('_') && !name.startsWith('.'))
    .filter((name) => {
      try {
        return statSync(join(CATALOG, name)).isDirectory()
      }
      catch { return false }
    })
    .sort()
}

let ok = 0
let failed = 0
const failures: string[] = []

for (const key of personaDirs()) {
  const file = join(CATALOG, key, 'ape-agent.yaml')
  let yaml: string
  try {
    yaml = readFileSync(file, 'utf8')
  }
  catch {
    continue // not a recipe dir
  }

  const parsed = parseRecipe(yaml)
  if (!parsed.ok) {
    failed++
    failures.push(`✗ ${key}: parse failed — ${parsed.reason}`)
    continue
  }
  if (parsed.value.name !== key) {
    failed++
    failures.push(`✗ ${key}: recipe name "${parsed.value.name}" != dir "${key}"`)
    continue
  }

  const mat = materializeRecipe(parsed.value, SAMPLE)
  if (!mat.ok) {
    failed++
    failures.push(`✗ ${key}: materialize failed — ${mat.reason}`)
    continue
  }
  if (/\{\{\s*\w+\s*\}\}/.test(mat.value.intent)) {
    failed++
    failures.push(`✗ ${key}: intent still has an unresolved {{placeholder}} after materialize`)
    continue
  }

  ok++
  const sched = mat.value.recipe.schedules.map(s => s.cron).join(', ')
  console.log(`✓ ${key.padEnd(28)} schedules[${sched}]  caps[${parsed.value.capabilities.map(c => c.env).join(',') || '—'}]`)
}

console.log(`\n${ok} ok, ${failed} failed (of ${ok + failed})`)
if (failures.length) {
  console.error(`\n${failures.join('\n')}`)
  process.exit(1)
}
