export interface PromptOrg { name: string, visionMd: string, budgetMonthlyEur: number }
export interface PromptObjective { title: string, status: string }
export interface TeamMember { id: string, role: string, label: string, duties: string, tools: string[] }
export interface MemoryDoc { id: string, title: string, body: string, mode: string, scope?: string, targetId?: string }
export interface SkillRef { id: string, name: string, description: string, assignedTo: string[] }

// The Operator's grounding: who it is, its delegation team (so it can hand a
// tool-requiring task to the right leaf), and the org's live vision/goals/budget.
// `memory` = the org's nachschlagbare Fakten: 'inline' docs go straight into the
// prompt, 'reference' docs only as an index line the agent fetches on demand.
export function buildSystemPrompt(org: PromptOrg, objs: PromptObjective[], owner: string, team: TeamMember[], memory: MemoryDoc[] = [], skills: SkillRef[] = []): string {
  let p = `Du bist der Operator der Firma „${org.name}". Antworte als dieser Operator: knapp, konkret, auf Deutsch. Du sprichst gerade direkt mit deinem Owner (${owner}) — sprich ihn persönlich an.`
  if (team.length) {
    p += `\n\nDein Team — du kannst an diese Rollen delegieren, wenn eine Aufgabe ihr Werkzeug braucht:`
    for (const m of team) {
      const tools = m.tools.length ? ` Darf Kommandos ausführen (Muster): ${m.tools.join(', ')}.` : ' (keine Werkzeuge)'
      p += `\n- ${m.label} (${m.role}): ${m.duties || 'keine Beschreibung'}.${tools}`
    }
    p += `\n\nBraucht eine Aufgabe ein Werkzeug, das ein Team-Mitglied hat, DELEGIERE an dieses Mitglied: spawne es als Subagent, lass es NUR Kommandos ausführen, die einem seiner Werkzeug-Muster entsprechen (z. B. Muster 'o365-cli *' erlaubt 'o365-cli mail list …'), read-only, und antworte geerdet in dessen Ergebnis. Erfinde NIE Werkzeug-Ergebnisse. Passt kein Mitglied/Werkzeug, sag das ehrlich. Nach außen wirkende Aktionen (senden/löschen/verschieben) macht der Owner selbst — du schlägst nur vor (human-in-the-loop).`
  }
  else {
    p += ` Erfinde keine ausgeführten Aktionen — du hast aktuell kein handlungsfähiges Team.`
  }
  if (org.visionMd) p += `\n\nVision/Kontext (aus dem Control-Plane):\n${org.visionMd}`
  if (objs.length) p += `\n\nAktuelle Ziele:\n${objs.map(o => `- ${o.title} (${o.status})`).join('\n')}`
  if (org.budgetMonthlyEur) p += `\n\nMonatsbudget: ${org.budgetMonthlyEur} €.`
  // Role/agent-scoped memory names its target so the Operator knows when it applies
  // (and whom to hand it to) — company-scoped memory has no such tag.
  const tag = (m: MemoryDoc) => m.scope === 'role' && m.targetId ? ` (Rolle: ${m.targetId})` : m.scope === 'agent' && m.targetId ? ` (Agent: ${m.targetId})` : ''
  for (const m of memory) {
    if (m.mode === 'inline') p += `\n\n--- Memory (${m.title})${tag(m)} ---\n${m.body}`
  }
  const refs = memory.filter(m => m.mode === 'reference')
  if (refs.length) {
    p += `\n\nVerfügbares Memory (bei Bedarf abrufen: \`cockpit-agent.sh memory <id>\`):`
    for (const m of refs) p += `\n- ${m.title}${tag(m)} [${m.id}]`
  }
  // Skills = named procedures an agent follows. Surface every assigned skill with
  // its target: 'ceo' skills the Operator runs itself; agent-tagged ones it hands to
  // the matching leaf. The agent selects by description, then fetches the prompt.
  const assignedSkills = skills.filter(s => s.assignedTo.length)
  if (assignedSkills.length) {
    const targets = (s: SkillRef) => ` (für: ${s.assignedTo.map(t => t === 'ceo' ? 'dich' : team.find(m => m.id === t)?.label ?? t).join(', ')})`
    p += `\n\nVerfügbare Skills (Prozeduren; wenn eine Aufgabe dazu passt, hol die Anweisung mit \`cockpit-agent.sh skill <id>\` und befolge sie):`
    for (const s of assignedSkills) p += `\n- ${s.name}: ${s.description}${targets(s)} [${s.id}]`
  }
  return p
}
