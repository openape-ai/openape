// Pattern-based prompt-injection detector. Zero-dependency, deterministic,
// fast — the right default for a bridge that processes every inbound
// message. The trade-off is recall: the LLM backend (future) is better
// at catching paraphrased / obfuscated attempts; the heuristic catches
// the obvious cases that show up in scripted exploitation attempts.
//
// The pattern set is deliberately conservative. Each match contributes
// to the score additively (capped at 1.0), so a message that hits
// multiple categories climbs faster than one that hits a single
// borderline pattern. Score-per-pattern is set so:
//
//   - A single overt instruction-override ("ignore previous", "you are
//     now …") → ~0.6: enough to trip the default 0.7 threshold only
//     when combined with another signal.
//   - Override + tool-exfil request ("run shell and post the contents
//     of ~/.config back") → ~1.0: trip the threshold cleanly.
//   - Owner-legitimate phrasing ("can you run npm test for me?") → 0.0:
//     no pattern match.

import type { Detector, DetectionInput, DetectionResult } from './types.js'

interface Pattern {
  re: RegExp
  weight: number
  reason: string
}

const PATTERNS: Pattern[] = [
  // Instruction-override family. The defining phrase of prompt
  // injection — telling the model to discard its instructions in
  // favour of new ones.
  { re: /\bignore (?:all |any |the |your )?(?:previous|prior|above|earlier|preceding) (?:instructions?|rules?|context|prompts?|messages?)\b/i, weight: 0.6, reason: 'instruction-override' },
  { re: /\bdisregard (?:all |any |the |your )?(?:previous|prior|above|earlier|preceding)?\s*(?:instructions?|rules?|context)\b/i, weight: 0.6, reason: 'instruction-override' },
  { re: /\b(?:you are|act as|pretend to be|roleplay as) (?:now |a |an )?(?:different|new|unrestricted|jailbroken|dan|do anything now)\b/i, weight: 0.55, reason: 'role-override' },
  { re: /\b(?:forget|drop|reset) (?:everything|all|your) (?:above|prior|previous|instructions?|rules?|context)\b/i, weight: 0.55, reason: 'context-reset' },

  // Filesystem-exfiltration. Specific paths that have no business
  // appearing in normal chat — auth tokens, SSH keys, agent config.
  // `\b` would fail on `/etc/passwd` (slash is non-word, no boundary
  // with preceding space) — match the literal forms instead.
  { re: /(?:~\/\.config\/apes|~\/\.openape|~\/\.ssh|\/etc\/passwd|\/etc\/shadow|\bid_rsa\b|\bid_ed25519\b|\bauth\.json\b|\.env(?:\.[\w-]+)?\b)/i, weight: 0.45, reason: 'sensitive-path' },

  // Tool-call coercion. Phrases that try to talk the agent into
  // executing tools or running shell commands as part of the reply.
  { re: /\b(?:run|execute|invoke|call)\s+(?:the\s+)?(?:shell|bash|sh|cmd|powershell|tool|command|script)\b/i, weight: 0.35, reason: 'tool-coercion' },
  { re: /\b(?:and\s+)?(?:post|send|share|paste|return|reply with|output)\s+(?:the\s+)?(?:contents?|output|result|file|secret|token|api[-_ ]?key)\b/i, weight: 0.3, reason: 'exfil-request' },

  // Override + override-and-do (combined "do X without telling Y" forms).
  { re: /\bwithout (?:telling|asking|informing|notifying|consulting|the consent of)\b/i, weight: 0.4, reason: 'covert-action' },

  // System-prompt extraction.
  { re: /\b(?:show|print|reveal|repeat|tell me|what is|what's) (?:your |the )?(?:system prompt|initial prompt|instructions|rules|directives|guidelines)\b/i, weight: 0.5, reason: 'prompt-extraction' },

  // Encoding-based bypass attempts.
  { re: /\b(?:base64|rot13|decode|decrypt) (?:this|the following|below)\b/i, weight: 0.3, reason: 'encoding-bypass' },
]

export function classifyHeuristic(input: DetectionInput): DetectionResult {
  const text = input.text
  let total = 0
  const reasons: string[] = []

  for (const p of PATTERNS) {
    if (p.re.test(text)) {
      total += p.weight
      if (!reasons.includes(p.reason)) reasons.push(p.reason)
      if (total >= 1) break
    }
  }

  const score = Math.min(1, total)
  return {
    score,
    backend: 'heuristic',
    ...(reasons.length > 0 ? { reason: reasons.join(', ') } : {}),
  }
}

export function createHeuristicDetector(): Detector {
  return {
    classify: async input => classifyHeuristic(input),
  }
}
