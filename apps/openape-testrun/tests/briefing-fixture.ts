import type { BriefingV1, BriefingV2 } from '../shared/briefing'

export function sampleBriefing(seriesId = 'series', editionDate = '2026-09-27'): BriefingV1 {
  const generatedAt = `${editionDate}T05:01:00Z`
  return {
    schemaVersion: 1,
    type: 'briefing',
    seriesId,
    editionDate,
    timezone: 'Europe/Vienna',
    generatedAt,
    title: 'A little clarity for today.',
    overview: 'One decision needs your attention, two meetings shape the morning, and the release is ready for review. Here is what matters today.',
    importantItems: [{ id: 'release', title: 'The release is ready for your review', summary: 'The team has resolved the remaining blockers. Review the proposed rollout before the planning meeting.', priority: 'high', sourceIds: ['mail', 'issues'] }, { id: 'planning', title: 'Keep the afternoon focused', summary: 'The calendar leaves an open block after lunch for the proposal.', priority: 'normal', sourceIds: ['calendar'] }],
    nextActions: [{ id: 'review', text: 'Review the rollout proposal before the 10:30 planning meeting.', dueDate: editionDate, sourceIds: ['mail'], url: 'https://example.com/proposal' }, { id: 'reply', text: 'Reply to the design review with your preferred option.', sourceIds: ['mail'] }],
    calendar: [{ id: 'sync', account: 'Work calendar', title: 'Product planning', start: `${editionDate}T08:30:00Z`, end: `${editionDate}T09:15:00Z`, allDay: false, location: 'Studio · meeting room 2', url: 'https://example.com/event' }, { id: 'design', account: 'Work calendar', title: 'Design review', start: `${editionDate}T10:00:00Z`, end: `${editionDate}T10:30:00Z`, allDay: false, location: 'Video call' }],
    emails: [{ id: 'mail-1', account: 'Work inbox', sender: 'Alex · Product team', subject: 'Ready for your review: September release', receivedAt: `${editionDate}T04:45:00Z`, disposition: 'Review', summary: 'The final checklist is complete. The team is waiting for your feedback on the rollout sequence.', nextAction: 'Read the proposal and confirm the next step.', url: 'https://example.com/mail/1' }, { id: 'mail-2', account: 'Work inbox', sender: 'Sam · Design team', subject: 'Two options for the new overview', receivedAt: `${editionDate}T04:30:00Z`, disposition: 'Reply', summary: 'Two visual directions are ready to compare during the design review.', nextAction: 'Choose the version that makes the daily priorities easier to scan.', url: 'https://example.com/mail/2' }],
    issues: [{ repository: 'team/product', number: 42, title: 'Review the release checklist', state: 'open', updatedAt: generatedAt, url: 'https://example.com/issues/42' }],
    sources: [{ id: 'calendar', label: 'Calendars', collectedAt: generatedAt, status: 'fresh', coverage: 'Today and the next seven days.', total: 2 }, { id: 'mail', label: 'Mail review', collectedAt: generatedAt, status: 'fresh', coverage: 'Two selected messages from the existing review.', total: 68, limit: 20, approvalCount: 3, approvalUrl: 'https://example.com/archive-approval' }, { id: 'issues', label: 'Repository issues', collectedAt: generatedAt, status: 'partial', coverage: 'Selected recently updated open issues.', total: 23, limit: 10 }, { id: 'personal', label: 'Personal calendar', collectedAt: null, status: 'missing', coverage: 'Unavailable during collection.' }],
    gaps: [{ sourceId: 'personal', reason: 'The calendar provider did not respond. Personal events may be missing.' }],
  }
}

export function sampleBriefingV2(seriesId = 'series', editionDate = '2026-10-26'): BriefingV2 {
  const base = sampleBriefing(seriesId, editionDate)
  const emails = [
    { ...base.emails[0]!, id: 'sync-1', account: 'Work inbox', sender: 'Sync monitor <monitor@example.com>', subject: 'Sync failed: export.csv', summary: 'The scheduled export failed on the reporting host.', nextAction: '', disposition: 'action' },
    { ...base.emails[0]!, id: 'sync-2', account: 'Work inbox', sender: 'Sync monitor <monitor@example.com>', subject: 'Sync failed again: export.csv', summary: 'A second notification names the same export and host.', nextAction: '', disposition: 'action' },
    { ...base.emails[1]!, id: 'guest', account: 'Work inbox', sender: 'Access service <access@example.com>', subject: 'Guest invitation expired', summary: 'The invitation expired yesterday.', nextAction: '', disposition: 'keep' },
    { ...base.emails[1]!, id: 'news', account: 'Personal inbox', sender: 'Team newsletter <news@example.com>', subject: 'October product notes', summary: 'Product notes are available.', nextAction: '', disposition: 'keep', informationItems: [{ id: 'info-1', text: 'The October product notes are available in the team workspace.' }] },
  ]
  const topics: BriefingV2['topics'] = [
    { id: 'sync', placement: 'focus', title: 'Two notifications about the same export', summary: 'Both messages name export.csv on the reporting host.', rationale: 'Review the original messages if the export is still needed.', uncertainty: 'A shared incident and the current status have not been verified.', references: [{ account: 'Work inbox', emailId: 'sync-1' }, { account: 'Work inbox', emailId: 'sync-2' }] },
    { id: 'guest', placement: 'focus', title: 'A guest invitation has expired', summary: 'The invitation expired yesterday.', rationale: 'Check access if the invitation is still needed.', uncertainty: '', references: [{ account: 'Work inbox', emailId: 'guest' }] },
    { id: 'news', placement: 'information', title: 'October product notes', summary: 'The team has shared its product notes.', rationale: '', uncertainty: '', references: [{ account: 'Personal inbox', emailId: 'news' }] },
  ]
  return {
    ...base,
    schemaVersion: 2,
    title: 'Dein Morgen',
    overview: 'Two notifications concern the same export; a guest invitation has expired.',
    importantItems: [],
    nextActions: [],
    emails,
    topics,
    calendar: [
      { id: 'day', account: 'Personal calendar', title: 'National holiday', start: editionDate, end: '2026-10-27', allDay: true, location: '' },
      { id: 'meeting-1', account: 'Work calendar', title: 'Project call', start: '2026-11-02T08:30:00+01:00', end: '2026-11-02T09:30:00+01:00', allDay: false, location: 'Video call' },
      { id: 'meeting-2', account: 'Personal calendar', title: 'Service appointment', start: '2026-11-02T08:30:00+01:00', end: '2026-11-02T09:00:00+01:00', allDay: false, location: 'Service center' },
    ],
    sources: [
      { id: 'work', label: 'Work inbox', collectedAt: base.generatedAt, status: 'partial', coverage: 'Three selected messages from eight inbox candidates.' },
      { id: 'personal', label: 'Personal inbox', collectedAt: base.generatedAt, status: 'fresh', coverage: 'One message with assessed open information.' },
      { id: 'calendar', label: 'Calendars', collectedAt: base.generatedAt, status: 'fresh', coverage: 'Today and the next seven days.' },
    ],
    sourceCoverage: [
      { sourceId: 'work', account: 'Work inbox', population: 'inbox', status: 'partial', available: 8, scanned: 8, considered: 3, included: 3, informationItems: null },
      { sourceId: 'personal', account: 'Personal inbox', population: 'open-information', status: 'complete', available: 1, scanned: 1, considered: 1, included: 1, informationItems: 1 },
    ],
    issues: [],
    gaps: [{ sourceId: 'work', reason: 'Only selected message bodies are included.' }],
  }
}
