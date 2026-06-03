// LLM-backed risk assessor + reviewer (INT-2). These satisfy the
// injected `RiskAssessorFn` / `ReviewerFn` interfaces with real model
// calls, so the coding loop's "is this risky?" and "approve this diff?"
// decisions are semantic, not glob-only.
//
// Fail-safe: if the model errors or returns unparseable output, the
// assessor treats the change as RISKY and the reviewer BLOCKS — unsure
// always degrades toward human/no-merge, never toward silent auto-merge.

import type { RuntimeConfig } from '../agent-runtime'
import type { AgentRiskAssessment, RiskAssessorFn } from './merge-policy'
import type { ReviewerFn, ReviewVerdict } from './review-gate'

const DIFF_CAP = 48 * 1024

async function jsonCompletion(
  config: RuntimeConfig,
  system: string,
  user: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetchImpl(`${config.apiBase}/chat/completions`, {
      method: 'POST',
      headers: { 'authorization': `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        response_format: { type: 'json_object' },
      }),
    })
    if (!res.ok) return null
    const data = await res.json() as { choices?: { message?: { content?: string } }[] }
    const content = data.choices?.[0]?.message?.content
    if (!content) return null
    return JSON.parse(content) as Record<string, unknown>
  }
  catch {
    return null
  }
}

const RISK_SYSTEM = [
  'You are a security/risk classifier for an autonomous coding agent.',
  'Given a diff + changed file paths, decide whether merging it WITHOUT a human is risky.',
  'Risky = touches authentication, authorization, secrets/credentials, payment, data migrations,',
  'deploy/release/CI config, cryptography, deletion of data, or anything whose failure is hard to',
  'reverse in production. Routine code/tests/docs/refactors are NOT risky.',
  'Respond ONLY as JSON: {"risky": boolean, "reason": string}.',
].join(' ')

export function createLlmRiskAssessor(config: RuntimeConfig, fetchImpl?: typeof fetch): RiskAssessorFn {
  return async ({ paths, diff }): Promise<AgentRiskAssessment> => {
    const user = `Changed files:\n${paths.join('\n')}\n\nDiff (truncated):\n${diff.slice(0, DIFF_CAP)}`
    const out = await jsonCompletion(config, RISK_SYSTEM, user, fetchImpl)
    if (!out || typeof out.risky !== 'boolean') {
      return { risky: true, reason: 'risk classifier unavailable/unparseable — treating as risky (fail-safe)' }
    }
    return { risky: out.risky, reason: typeof out.reason === 'string' ? out.reason : undefined }
  }
}

const REVIEW_SYSTEM = [
  'You are a code reviewer for an autonomous coding agent.',
  'Given a PR diff, decide whether it is correct, safe, and complete enough to auto-merge.',
  'Approve only if you would be comfortable shipping it without further human review.',
  'Block if you see bugs, missing tests, security issues, or incomplete work.',
  'Respond ONLY as JSON: {"approved": boolean, "reason": string}.',
].join(' ')

export function createLlmReviewer(config: RuntimeConfig, fetchImpl?: typeof fetch): ReviewerFn {
  return async ({ prRef, diff }): Promise<ReviewVerdict> => {
    const user = `PR ${String(prRef)} diff (truncated):\n${diff.slice(0, DIFF_CAP)}`
    const out = await jsonCompletion(config, REVIEW_SYSTEM, user, fetchImpl)
    if (!out || typeof out.approved !== 'boolean') {
      return { approved: false, reason: 'reviewer unavailable/unparseable — blocking (fail-safe)' }
    }
    return { approved: out.approved, reason: typeof out.reason === 'string' ? out.reason : undefined }
  }
}
