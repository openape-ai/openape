// Nest-hatch tokens — one-time enrollment credentials minted by
// POST /api/nest/hatch and redeemed by an incoming nest WebSocket on
// first connect. Lives in-memory: tokens are short (10 min TTL) and
// the cost of losing the table on a troop restart is one operator-
// visible "re-hatch" click, which is preferable to schema bloat.

interface HatchTokenRow {
  ownerEmail: string
  expiresAt: number
}

const tokens = new Map<string, HatchTokenRow>()

export function rememberHatchToken(input: {
  token: string
  ownerEmail: string
  expiresAt: number
}): void {
  gcExpired()
  tokens.set(input.token, {
    ownerEmail: input.ownerEmail,
    expiresAt: input.expiresAt,
  })
}

// Atomically consume a token: returns the owner email if the token was
// valid + unexpired, null otherwise. Once consumed the token can't be
// redeemed twice — same nest can't be hatched on two hosts with one
// claim.
export function redeemHatchToken(token: string): string | null {
  gcExpired()
  const row = tokens.get(token)
  if (!row) return null
  tokens.delete(token)
  if (row.expiresAt < Math.floor(Date.now() / 1000)) return null
  return row.ownerEmail
}

function gcExpired(): void {
  const now = Math.floor(Date.now() / 1000)
  for (const [k, v] of tokens.entries()) {
    if (v.expiresAt < now) tokens.delete(k)
  }
}
