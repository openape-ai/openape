import type { StorageReason } from '../../contracts/storage'

/** A classified storage failure; the reason decides the explanation and remedies the owner sees. */
export class StorageError extends Error {
  constructor(readonly reason: StorageReason, message: string) { super(message) }
}
