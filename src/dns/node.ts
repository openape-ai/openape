export async function resolveTXT(domain: string): Promise<string[]> {
  const { Resolver } = await import('node:dns/promises')
  const resolver = new Resolver()
  const records = await resolver.resolveTxt(domain)
  return records.flat()
}
