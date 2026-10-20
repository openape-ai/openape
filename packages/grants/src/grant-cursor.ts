import type { OpenApeGrant } from '@openape/core'

/** Accept legacy timestamp cursors; new cursors also disambiguate equal timestamps. */
export function parseGrantCursor(cursor: string): { createdAt: number, id?: string } {
  const match = /^(\d+)(?::(.{1,256}))?$/.exec(cursor)
  if (!match || !Number.isSafeInteger(Number(match[1]))) throw new Error('Invalid grant cursor')
  return { createdAt: Number(match[1]), ...(match[2] === undefined ? {} : { id: match[2] }) }
}

export function grantCursor(grant: Pick<OpenApeGrant, 'created_at' | 'id'>): string {
  return `${grant.created_at}:${grant.id}`
}
