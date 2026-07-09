export interface PromptOrg { name: string, visionMd: string, budgetMonthlyEur: number }
export interface PromptObjective { title: string, status: string }
export interface TeamMember { role: string, label: string, duties: string, tools: string[] }

// The CEO's grounding: who it is, its delegation team (so it can hand a
// tool-requiring task to the right leaf), and the org's live vision/goals/budget.
export function buildSystemPrompt(org: PromptOrg, objs: PromptObjective[], owner: string, team: TeamMember[]): string {
  let p = `Du bist die CEO der Firma „${org.name}". Antworte als diese CEO: knapp, konkret, auf Deutsch. Du sprichst gerade direkt mit deinem Owner (${owner}) — sprich ihn persönlich an.`
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
  return p
}
