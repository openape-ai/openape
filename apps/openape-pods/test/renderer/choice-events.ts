import type { GraphGate } from '../../src/contracts/graphs'

/** The 17 recorded choice events of the mock: 15 cases, two of them with a second version. */
export const choiceEvents = [
  ['5d4814ff', '1f4a52bc', 'messaging-digest-noreply@linkedin.com', 'Samarth Patwari und Purvi Doshi haben Ihnen neue Nachrichten gesendet', 'unsure', 0.43, '2026-10-05T10:51:19Z'],
  ['abd211ff', '5c27e7fb', 'messages-noreply@linkedin.com', 'Jensen Huang, Founder and CEO, ist in Ihrem Netzwerk beliebt', 'newsletter', 0.78, '2026-10-05T10:50:29Z'],
  ['732a898e', 'f2ca7aa5', 'invitations@linkedin.com', 'Kontaktanfrage anzeigen', 'reply', 0.39, '2026-10-05T08:50:29Z'],
  ['e8f5324f', '803b9a7f', 'invitations@linkedin.com', 'Kontaktanfrage anzeigen', 'reply', 0.5, '2026-10-05T14:50:34Z'],
  ['d3b46ef8', '3bbc6579', 'updates-noreply@linkedin.com', 'Thomas Richter-Trummer – Co-Founder & CTO hat auf diesen Beitrag reagiert', 'unsure', 0.22, '2026-10-05T19:10:20Z'],
  ['c76c22b6', 'f5fc71be', 'chloe.y@get.avogtech.com', 'Building beyond standard tools', 'newsletter', 0.97, '2026-10-05T20:59:02Z'],
  ['6df08d8f', '7ed1327a', 'invitations@linkedin.com', 'Kontaktanfrage anzeigen', 'reply', 0.49, '2026-10-05T20:51:31Z'],
  ['1c4399a6', 'd6cf3ef4', 'invitations@linkedin.com', 'Kontaktanfrage anzeigen', 'reply', 0.41, '2026-10-05T22:50:31Z'],
  ['2afe9dcf', 'd04dff94', 'messages-noreply@linkedin.com', 'Lerntipp: Wertvolle Impulse für herausfordernde Zeiten', 'newsletter', 0.96, '2026-10-06T00:29:15Z'],
  ['e0d426cc', '1e47464c', 'simon@hey.enginelabs.ai', 'September updates from cto', 'unsure', 0.57, '2026-10-06T01:34:54Z'],
  ['7c9770f7', '78a6c919', 'announce@m.parallels.com', 'Beim neuen Parallels Desktop sparen und starke Leistung freischalten', 'newsletter', 0.98, '2026-10-06T07:02:45Z'],
  ['f9b31cdc', '5e797af6', 'info@team-ats.at', 'Diesen Donnerstag: ATS Convention - jetzt noch anmelden!', 'newsletter', 0.94, '2026-10-06T07:19:45Z'],
  ['95c3fd20', '0c8bf15a', 'info@team-ats.at', 'Diesen Donnerstag: ATS Convention - jetzt noch anmelden!', 'newsletter', 0.95, '2026-10-06T07:19:45Z'],
  ['551b9282', '5e797af6', 'info@team-ats.at', 'Diesen Donnerstag: ATS Convention - jetzt noch anmelden!', 'newsletter', 0.96, '2026-10-06T07:19:45Z'],
  ['61b04af6', '0c8bf15a', 'info@team-ats.at', 'Diesen Donnerstag: ATS Convention - jetzt noch anmelden!', 'newsletter', 0.95, '2026-10-06T07:19:45Z'],
  ['ed32bc79', '80d48713', 'noreply@github.com', '[GitHub] Your Dependabot alerts for the week of Sep 29 - Oct 6', 'useful', 0.89, '2026-10-06T08:42:07Z'],
  ['35d74d91', '1769d6ed', 'bestellbestaetigung@amazon.de', 'Bestellt: „HP 937 Schwarz, Cyan,…“ und 4 weitere Artikel', 'invoice', 0.32, '2026-10-06T08:35:11Z'],
] as const

export const chooseGate: Extract<GraphGate, { kind: 'choose' }> = { key: 'uncertain-review', kind: 'choose', title: 'Review uncertain mail', takes: 'mail.unsure', options: [{ key: 'keep', title: 'Keep for review', channel: 'mail.useful' }, { key: 'newsletter', title: 'Newsletter candidate', channel: 'mail.newsletter' }, { key: 'invoice', title: 'Invoice review', channel: 'mail.invoice' }, { key: 'reply', title: 'Reply preview', channel: 'mail.reply' }] }
export const approveGate: GraphGate = { key: 'newsletter-approval', kind: 'approve', title: 'Approve newsletter preview (no move)', takes: 'mail.batch', gives: 'mail.approved', excluded: 'mail.excluded' }
/** The payload of one recorded event as the network stores it. */
export function choicePayload([eventId, , sender, subject, category, confidence, date]: typeof choiceEvents[number]): Record<string, unknown> {
  return { account: 'phofmann@delta-mind.at', category, complete: false, confidence, date, evidence: eventId.repeat(8), knownContact: false, protected: false, sender, subject, urgency: sender === 'info@team-ats.at' ? 'urgent' : 'normal' }
}
