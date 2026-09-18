import { parsePackages } from '../contracts/dependencies'
import { parsePackageOptions, parsePackageSearch } from '../contracts/package-catalog'
import type { PackageOption } from '../contracts/package-catalog'

function registryPath(query: string): { path: string, name?: string, version?: string } {
  let reference = query
  if (/^[a-z][a-z\d+.-]*:/i.test(query) || query.startsWith('//')) {
    let url: URL
    try { url = new URL(query) }
    catch { throw new Error('Use an https://www.npmjs.com/package/ link; external package sources are not supported') }
    if (url.protocol !== 'https:' || !['www.npmjs.com', 'npmjs.com'].includes(url.hostname) || url.port || url.username || url.password || url.search) throw new Error('Use an https://www.npmjs.com/package/ link; external package sources are not supported')
    const match = /^\/package\/((?:@[^/]+\/)?[^/]+)(?:\/v\/([^/]+))?\/?$/.exec(url.pathname)
    if (!match) throw new Error('Use an https://www.npmjs.com/package/ link; external package sources are not supported')
    reference = match[1] + (match[2] ? `@${match[2]}` : '')
    if (!match[2]) {
      parsePackages({ dependencies: { [reference]: '1.0.0' } })
      return { path: `/${encodeURIComponent(reference)}/latest`, name: reference }
    }
  }
  const exact = /^((?:@[^/]+\/)?[^@]+)@([^@]+)$/.exec(reference)
  if (exact) {
    const [, name, version] = exact
    parsePackages({ dependencies: { [name]: version } })
    return { path: `/${encodeURIComponent(name)}/${encodeURIComponent(version)}`, name, version }
  }
  return { path: `/-/v1/search?${new URLSearchParams({ text: reference, size: '12' })}` }
}

async function registryJson(path: string, request: typeof fetch): Promise<unknown> {
  const response = await request(`https://registry.npmjs.org${path}`, { method: 'GET', redirect: 'error', credentials: 'omit', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10000) })
  if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error('npm search failed. Check the package name and connection, then try again.') }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break
      size += part.value.length
      if (size > 512 * 1024) throw new Error('npm catalog response is too large')
      chunks.push(part.value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  }
  finally { await reader.cancel() }
}
function option(value: unknown): PackageOption {
  if (!value || typeof value !== 'object' || !('name' in value) || !('version' in value)) throw new Error('Invalid npm catalog response')
  const description = 'description' in value && typeof value.description === 'string' ? value.description.slice(0, 500) : ''
  return parsePackageOptions([{ name: value.name, version: value.version, description }])[0]
}
export async function searchPackages(value: unknown, request: typeof fetch = fetch): Promise<PackageOption[]> {
  const target = registryPath(parsePackageSearch(value).query)
  const data = await registryJson(target.path, request)
  if (target.name) {
    const result = option(data)
    if (result.name !== target.name || (target.version && result.version !== target.version)) throw new Error('Invalid npm catalog response')
    return [result]
  }
  if (!data || typeof data !== 'object' || !('objects' in data) || !Array.isArray(data.objects) || data.objects.length > 12) throw new Error('Invalid npm catalog response')
  return data.objects.map((item) => {
    if (!item || typeof item !== 'object' || !('package' in item)) throw new Error('Invalid npm catalog response')
    return option(item.package)
  })
}
