import { buildOrgSystemPrompt } from './org-context'
import { enqueue } from './queue'
import { saveTask } from './task-store'

// Enqueue a proactive Operator task for (owner, org): build the org grounding and
// hand `userMessage` to the queue. The always-on worker claims it like any cockpit
// task; the answer lands in the chat + fires a Web-Push. Returns false if the org
// is gone/unowned (nothing enqueued). Shared by the schedule evaluator and event
// hooks so every proactive path is grounded identically.
//
// The task is framed as a DUE trigger firing NOW, so the Operator executes it and
// reports to the owner directly instead of asking a clarifying question — a stored
// reminder prompt like "Patrick erinnern: X" must be delivered, not re-negotiated.
export async function fireProactiveTask(owner: string, orgId: string, userMessage: string): Promise<boolean> {
  const systemPrompt = await buildOrgSystemPrompt(owner, orgId)
  if (systemPrompt == null) return false
  const framed = `[Geplanter Trigger — jetzt fällig] Der folgende Auftrag ist gerade fällig geworden. Führe ihn JETZT aus und melde dem Owner das Ergebnis direkt im Chat. Keine Rückfrage und keine erneute Terminplanung — der Zeitpunkt ist jetzt. Ist es eine Erinnerung, sprich sie direkt aus.\n\nAuftrag:\n${userMessage}`
  const task = enqueue(orgId, systemPrompt, framed, owner)
  // Persist so a restart before the worker claims doesn't silently drop the fire.
  void saveTask({ id: task.id, company: orgId, owner, systemPrompt, userMessage: framed, createdAt: Date.now() }).catch(err => console.error('[task-store] save', err))
  return true
}
