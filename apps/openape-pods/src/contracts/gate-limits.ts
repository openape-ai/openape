/**
 * `collectQuietMs`/`collectMaxMs`: a network gate collects pending inputs until none arrived for two minutes,
 * at most ten minutes after the oldest, so answers given one after another share one owner approval (issue 1449).
 */
export const gateLimits = { batchItems: 30, expiryMs: 12 * 60 * 60 * 1000, pendingBatches: 4, summaryLength: 4096, collectQuietMs: 2 * 60 * 1000, collectMaxMs: 10 * 60 * 1000 } as const
