// Small bodies ride inline in the prompt; big ones become reference docs the
// agent fetches on demand, so the prompt stays lean. The threshold is a default
// the owner can override by passing `mode` explicitly — not a hard rule.
export const INLINE_MAX_CHARS = 1500

export function pickMode(body: string): 'inline' | 'reference' {
  return body.length > INLINE_MAX_CHARS ? 'reference' : 'inline'
}
