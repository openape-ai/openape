import type { PodDatabase } from '../storage/database'

export function scheduleDomains(store: PodDatabase, domains: readonly (() => void)[]): void {
  const first = Number(store.db.prepare('SELECT next_domain FROM network_scheduler_state WHERE id=1').get()!.next_domain)
  for (let offset = 0; offset < domains.length; offset++) {
    const index = (first + offset) % domains.length
    const before = store.db.prepare('SELECT count(*) AS count FROM runs').get()!.count
    try {
      domains[index]!()
      store.db.prepare('UPDATE network_scheduler_state SET last_error_domain=NULL,last_error=NULL WHERE id=1 AND last_error_domain=?').run(index)
    }
    catch (failure) {
      const message = (failure instanceof Error ? failure.message : 'Scheduling domain failed').slice(0, 10000)
      store.db.prepare('UPDATE network_scheduler_state SET last_error_domain=?,last_error=? WHERE id=1').run(index, message)
      console.error(`Scheduling domain ${index} failed; other domains continue`, failure)
    }
    if (store.db.prepare('SELECT count(*) AS count FROM runs').get()!.count === before) continue
    store.db.prepare('UPDATE network_scheduler_state SET next_domain=?,last_progress_at=? WHERE id=1').run((index + 1) % domains.length, Date.now())
  }
}
