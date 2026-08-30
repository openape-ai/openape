export function normalizeMail(value: string): string {
  return value.trim().toLowerCase()
}

export function matchInboxAddresses(opts: {
  from: string
  to: string[]
  cc?: string[]
  selfMail: string
  contactEmails: { contactId: string, email: string }[]
}): { contactId: string, email: string } | null {
  const self = normalizeMail(opts.selfMail)
  const candidates = [opts.from, ...opts.to, ...(opts.cc ?? [])]
    .map(normalizeMail)
    .filter(addr => addr && addr !== self)
  const byEmail = new Map(opts.contactEmails.map(row => [normalizeMail(row.email), row]))
  for (const addr of candidates) {
    const hit = byEmail.get(addr)
    if (hit) return hit
  }
  return null
}
