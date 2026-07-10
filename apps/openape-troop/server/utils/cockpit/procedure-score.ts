import { classifyHeuristic } from '@openape/prompt-injection-detector'

// Score a procedure for prompt-injection risk when the owner writes it. This is
// a visible SIGNAL, not a gate: the owner may deliberately author instructions
// the detector flags (isOwner: true is the "may override behaviour" case), so a
// high score is surfaced in the UI and carried to the loop — never blocked here.
export function scoreProcedure(procedure: string, owner: string): { score: number, reason: string } {
  if (!procedure.trim()) return { score: 0, reason: '' }
  const { score, reason } = classifyHeuristic({ text: procedure, sender: { email: owner, isOwner: true } })
  return { score, reason: reason ?? '' }
}
