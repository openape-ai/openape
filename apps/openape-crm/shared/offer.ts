export function nextOfferNumber(existing: string[], year: number): string {
  const prefix = `AG-${year}-`
  let max = 0
  for (const n of existing) {
    if (!n.startsWith(prefix)) continue
    const num = Number.parseInt(n.slice(prefix.length), 10)
    if (Number.isFinite(num) && num > max) max = num
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`
}
