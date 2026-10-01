import type { PodDatabase } from '../storage/database'

export class NetworkQuotaError extends Error {
  constructor() { super('Network intake paused: authoritative database reached its 192 MiB admission budget') }
}

export function assertNetworkQuota(store: PodDatabase, additionalBytes: number): void {
  const pages = Number(store.db.prepare('PRAGMA page_count').get()!.page_count)
  const free = Number(store.db.prepare('PRAGMA freelist_count').get()!.freelist_count)
  const pageSize = Number(store.db.prepare('PRAGMA page_size').get()!.page_size)
  if ((pages - free) * pageSize + additionalBytes >= 192 * 1024 * 1024) throw new NetworkQuotaError()
}
