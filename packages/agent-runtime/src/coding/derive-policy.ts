// Derive risk paths from signals that ALREADY exist in the repo, so
// nobody maintains a parallel list that rots (M5 follow-up):
//
//   1. Deploy-workflow `paths:` filters — the paths whose change ships
//      to prod ARE the real risk surface. You already maintain them.
//   2. CODEOWNERS — paths with an owner mean "someone must review".
//
// These AUGMENT (never reduce) the repo's explicit riskPaths and never
// flip `autoMergeEnabled` on — derivation only makes the risk
// classification safer, it doesn't enable automation.
//
// Parsers are pure + unit-tested. No YAML dependency: we extract just
// the `paths:` blocks we care about. File reads use node:fs/promises.

import type { MergePolicy } from './merge-policy'
import { loadMergePolicy, SECURE_DEFAULT_POLICY } from './merge-policy'

function indentOf(line: string): number {
  return line.length - line.trimStart().length
}

function unquote(s: string): string {
  return s.trim().replace(/^['"]|['"]$/g, '').trim()
}

// Extract globs from `paths:` filters in a GitHub Actions workflow.
// Handles both block lists and inline arrays. Ignores `paths-ignore:`
// (that's the inverse of a risk filter).
export function extractWorkflowPaths(yamlText: string): string[] {
  const out: string[] = []
  const lines = yamlText.split('\n')
  let inBlock = false
  let keyIndent = -1

  for (const line of lines) {
    if (inBlock) {
      const m = /^\s*-\s*(\S.*)$/.exec(line)
      if (m && indentOf(line) > keyIndent) {
        out.push(unquote(m[1]!))
        continue
      }
      if (line.trim() !== '') inBlock = false // dedented / next key
    }
    // Inline array: `paths: ['a/**', "b/**"]`
    const inline = /^\s*paths:\s*\[(.+)\]\s*$/.exec(line)
    if (inline) {
      for (const tok of inline[1]!.split(',')) {
        const g = unquote(tok)
        if (g) out.push(g)
      }
      continue
    }
    // Block form: `paths:` then `- glob` lines below.
    if (/^\s*paths:\s*$/.test(line)) {
      inBlock = true
      keyIndent = indentOf(line)
    }
  }
  return [...new Set(out)]
}

// Parse CODEOWNERS path patterns → our glob style. CODEOWNERS lines are
// `pattern owner...`; we take the pattern. Leading `/` is repo-root
// anchored (drop it); a trailing `/` means a directory (→ `**`).
export function parseCodeowners(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const pattern = line.split(/\s+/)[0]
    if (!pattern || pattern.startsWith('@')) continue
    let g = pattern.replace(/^\//, '')
    if (g.endsWith('/')) g += '**'
    if (g) out.push(g)
  }
  return [...new Set(out)]
}

// Read the repo's deploy-workflow + CODEOWNERS signals and return the
// union of derived risk globs. Best-effort: missing files → [].
export async function deriveRiskGlobs(worktreeDir: string): Promise<string[]> {
  const { readFile, readdir } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const globs = new Set<string>()

  // 1. deploy-*.yml workflows
  try {
    const wfDir = join(worktreeDir, '.github', 'workflows')
    const files = await readdir(wfDir)
    for (const f of files) {
      if (!/deploy.*\.ya?ml$/i.test(f)) continue
      try {
        const text = await readFile(join(wfDir, f), 'utf8')
        for (const g of extractWorkflowPaths(text)) globs.add(g)
      }
      catch { /* unreadable file — skip */ }
    }
  }
  catch { /* no workflows dir */ }

  // 2. CODEOWNERS (common locations)
  for (const loc of ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS']) {
    try {
      const text = await readFile(join(worktreeDir, loc), 'utf8')
      for (const g of parseCodeowners(text)) globs.add(g)
      break
    }
    catch { /* try next */ }
  }

  return [...globs]
}

// The main entry the orchestration uses: explicit `.openape/coding.json`
// policy, with risk paths AUGMENTED by derived signals. autoMergeEnabled
// + autoPaths come solely from explicit config (derivation never enables
// automation).
export async function resolveMergePolicy(worktreeDir: string): Promise<MergePolicy> {
  const explicit = await loadMergePolicy(worktreeDir).catch(() => SECURE_DEFAULT_POLICY)
  const derived = await deriveRiskGlobs(worktreeDir).catch(() => [])
  return {
    autoMergeEnabled: explicit.autoMergeEnabled,
    autoPaths: explicit.autoPaths,
    riskPaths: [...new Set([...explicit.riskPaths, ...derived])],
  }
}
