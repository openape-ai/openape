// Compound shell lines (`a | b`, `a && b`) resolved segment by segment so a
// SINGLE grant request can carry structured authorization_details for every
// command in the chain — the piece that finally lets standing grants and
// risk policies see real agent shell instead of an opaque `bash -c` blob
// (plan 2026-07-29-compound-shapes-grants, M2).
//
// Fail-closed by design: anything this module cannot model precisely —
// command substitution, redirections, extra positional params after the
// `-c` string, unparsable segments — returns null and the caller falls
// back to the opaque session-grant path (today's behavior).
import { basename } from 'node:path'
import type { OpenApeCliAuthorizationDetail, OpenApeExecutionContext } from '@openape/core'
import { containsCommandSubstitution, splitCommandSegments } from '@openape/core'
import { computeArgvHash, mergeCliAuthorizationDetails } from '@openape/grants'
import consola from 'consola'
import { buildGenericResolved } from './generic.js'
import { parseShellCommand, loadOrInstallAdapter  } from './shell-parser.js'
import { resolveCommand } from './parser.js'
import type { ResolvedCommand } from './types.js'

export interface ResolvedCompound {
  /** Per-segment resolution, in execution order. */
  segments: ResolvedCommand[]
  /** Merged authorization details across all segments. */
  details: OpenApeCliAuthorizationDetail[]
  permissions: string[]
  /** Audience shared by all segments — mixed audiences bail to null. */
  audience: string
  /** The inner command line (verbatim, quotes intact). */
  innerLine: string
  /** Binds the ORIGINAL wrapped argv, not any single segment. */
  executionContext: OpenApeExecutionContext
}

/**
 * Resolve `['bash'|'sh', '-c', '<line>']` where `<line>` chains multiple
 * commands. Each segment resolves through its shapes adapter when one
 * exists, and through the generic fallback (risk high, argv-bound) when
 * not. Returns null whenever the line cannot be modelled precisely — the
 * caller must then use the opaque path.
 */
export async function resolveCompoundCommand(command: string[]): Promise<ResolvedCompound | null> {
  // Exactly the 3-element wrap: extra argv become $0/$1 positional params,
  // flags before -c change semantics — both unmodelled.
  if (command.length !== 3) return null
  if (command[0] !== 'bash' && command[0] !== 'sh') return null
  if (command[1] !== '-c') return null
  const innerLine = command[2]!

  const segments = splitCommandSegments(innerLine)
  // Single segment belongs to the existing non-compound adapter path;
  // an operator-only line has nothing to resolve.
  if (segments.length < 2) return null

  // A pattern/adapter hit never vouches for nested commands.
  if (segments.some(seg => containsCommandSubstitution(seg))) return null

  const resolvedSegments: ResolvedCommand[] = []
  for (const seg of segments) {
    const parsed = parseShellCommand(seg)
    if (!parsed) return null
    // Redirections (`> f`, `2>/dev/null`, `< f`) survive segment splitting
    // as operator tokens. An adapter match would silently ignore them and
    // misdescribe the command — unmodelled, bail.
    if (parsed.isCompound) return null

    const executable = basename(parsed.executable)
    const fullArgv = [executable, ...parsed.argv]

    const adapter = await loadOrInstallAdapter(parsed.executable)
    if (adapter) {
      try {
        resolvedSegments.push(await resolveCommand(adapter, fullArgv))
        continue
      }
      catch (err) {
        consola.debug(`compound: adapter resolve failed for "${seg}", using generic:`, err)
      }
    }
    resolvedSegments.push(await buildGenericResolved(executable, fullArgv))
  }

  // One grant, one token, one audience. Mixed audiences would need a
  // token per audience — unmodelled, bail.
  const audiences = new Set(resolvedSegments.map(s => s.adapter.cli.audience ?? 'shapes'))
  if (audiences.size !== 1) return null

  const details = mergeCliAuthorizationDetails(resolvedSegments.map(s => s.detail))

  return {
    segments: resolvedSegments,
    details,
    permissions: details.map(d => d.permission),
    audience: [...audiences][0]!,
    innerLine,
    // adapter_* describe ONE adapter; a compound line spans several, so the
    // synthetic marker mirrors the generic-fallback convention. Per-segment
    // adapter integrity lives in each segment's own resource chain.
    executionContext: {
      argv: [...command],
      argv_hash: await computeArgvHash([...command]),
      adapter_id: 'compound',
      adapter_version: 'openape-shapes/v1',
      adapter_digest: 'compound',
      resolved_executable: command[0]!,
    },
  }
}
