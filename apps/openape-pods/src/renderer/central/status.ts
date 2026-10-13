export interface Connection { failures: number, since: number | null, error: string }
export const connected: Connection = { failures: 0, since: null, error: '' }
export const offlineAfterFailures = 3

// One failed read is a hiccup; only repeated failures mean the workspace is unreachable.
export function connectionAfter(previous: Connection, error: string | null, now: number): Connection {
  if (error === null) return connected
  return { failures: previous.failures + 1, since: previous.since ?? now, error }
}

export function connectionLevel(connection: Connection): 'online' | 'reconnecting' | 'offline' {
  if (!connection.failures) return 'online'
  return connection.failures < offlineAfterFailures ? 'reconnecting' : 'offline'
}
