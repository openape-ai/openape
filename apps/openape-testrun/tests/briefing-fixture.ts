import type { Briefing } from '../shared/briefing'

export function sampleBriefing(seriesId = 'series', editionDate = '2026-09-27'): Briefing {
  const generatedAt = `${editionDate}T05:01:00Z`
  return {
    schemaVersion: 1, type: 'briefing', seriesId, editionDate, timezone: 'Europe/Vienna', generatedAt,
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
