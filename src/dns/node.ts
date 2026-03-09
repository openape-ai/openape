export async function resolveTXT(domain: string): Promise<string[]> {
  const { Resolver } = await import('node:dns/promises')
  const resolver = new Resolver()
  try {
    const records = await resolver.resolveTxt(domain)
    return records.flat()
  }
  catch (err: unknown) {
    const code = (err as { code?: string }).code
    if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'SERVFAIL') {
      return []
    }
    throw err
  }
}
