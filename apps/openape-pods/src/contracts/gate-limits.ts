/**
 * `collectQuietMs`/`collectMaxMs`: a network gate collects pending inputs until none arrived for two minutes,
 * at most ten minutes after the oldest, so answers given one after another share one owner approval (issue 1449).
 * `batchMembers`/`expiryMs`/`joinMarginMs`: the frozen tasks of one gate join one open IdP batch for up to seven days
 * and 100 grants (the IdP batch page); a task joins only while at least an hour of that batch is left (issue 1458).
 * `fastPolls`/`slowPollMs`: a waiting batch is read every five seconds at first, then once a minute.
 */
export const gateLimits = { batchItems: 30, batchMembers: 100, expiryMs: 7 * 24 * 60 * 60 * 1000, joinMarginMs: 60 * 60 * 1000, pendingBatches: 100, fastPolls: 120, slowPollMs: 60 * 1000, summaryLength: 4096, collectQuietMs: 2 * 60 * 1000, collectMaxMs: 10 * 60 * 1000 } as const
