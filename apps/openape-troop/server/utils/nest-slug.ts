// Owner-scoped host_id minting for bound devices (M4δ).
//
// troop is the canonical issuer of host_ids. The id is derived from the
// device's display name and de-duplicated *within the owner* — so two
// different Owners can each have a `mbp-home`, and one Owner binding two
// machines both called "MacBook" gets `macbook` and `macbook-2`.

export function slugifyHostId(input: string): string {
  const s = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return s || 'pod'
}

/** Pick the first of base, base-2, base-3, … not already in `taken`. */
export function pickUniqueHostId(base: string, taken: Set<string>): string {
  let hostId = base
  for (let n = 2; taken.has(hostId); n++) hostId = `${base}-${n}`
  return hostId
}
