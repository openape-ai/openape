import { expect, it, vi } from 'vitest'
import { searchPackages } from '../../src/main/package-catalog'
import { parsePackageSearch } from '../../src/contracts/package-catalog'

const item = { name: '@scope/package', version: '1.2.3', description: 'Plain text <img src=x>' }
it('searches only the public registry and returns bounded plain metadata', async () => {
  const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ objects: [{ package: item }] })))
  expect(await searchPackages({ query: 'csv parsing' }, request)).toEqual([item])
  expect(request).toHaveBeenCalledWith('https://registry.npmjs.org/-/v1/search?text=csv+parsing&size=12', expect.objectContaining({ redirect: 'error', credentials: 'omit', method: 'GET' }))
})
it('resolves scoped npm links and explicit versions without fetching the supplied URL', async () => {
  for (const query of ['https://www.npmjs.com/package/@scope/package/v/1.2.3', '@scope/package@1.2.3', 'https://npmjs.com/package/@scope/package']) {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(item)))
    expect(await searchPackages({ query }, request)).toEqual([item])
    expect(request.mock.calls[0][0]).toBe(`https://registry.npmjs.org/%40scope%2Fpackage/${query.endsWith('package') ? 'latest' : '1.2.3'}`)
  }
})
it('rejects external sources, credentials, redirects and malformed metadata without installing', async () => {
  for (const query of ['http://www.npmjs.com/package/test', 'https://evil.example/package/test', 'https://www.npmjs.com.evil.example/package/test', 'https://user:secret@www.npmjs.com/package/test', 'file:///tmp/package', 'https://www.npmjs.com/package/test?token=secret', 'name@^1.0.0']) {
    const request = vi.fn(); await expect(searchPackages({ query }, request)).rejects.toThrow(); expect(request).not.toHaveBeenCalled()
  }
  expect(() => parsePackageSearch({ query: 'a'.repeat(301) })).toThrow()
  expect(() => parsePackageSearch({ query: 'valid', url: 'https://evil.example' })).toThrow()
  await expect(searchPackages({ query: 'test' }, vi.fn().mockResolvedValue(new Response('', { status: 302 })))).rejects.toThrow('npm search failed')
  await expect(searchPackages({ query: 'test' }, vi.fn().mockResolvedValue(new Response('x'.repeat(512 * 1024 + 1))))).rejects.toThrow('too large')
  await expect(searchPackages({ query: 'test@1.0.0' }, vi.fn().mockResolvedValue(new Response(JSON.stringify(item))))).rejects.toThrow('Invalid npm catalog response')
})
