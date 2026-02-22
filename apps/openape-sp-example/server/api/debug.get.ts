import { resolveDDISA, extractDomain } from '@ddisa/core'

export default defineEventHandler(async (event) => {
  const results: Record<string, unknown> = {}

  // Test 1: DNS resolution
  try {
    const record = await resolveDDISA('example.com')
    results.dns = { ok: true, record }
  } catch (e: any) {
    results.dns = { ok: false, error: e.message }
  }

  // Test 2: Storage write
  try {
    const storage = useStorage('db')
    await storage.setItem('test:debug', { ts: Date.now() })
    const val = await storage.getItem('test:debug')
    results.storage = { ok: true, val }
  } catch (e: any) {
    results.storage = { ok: false, error: e.message, stack: e.stack?.split('\n').slice(0, 3) }
  }

  // Test 3: Runtime info
  results.runtime = {
    node: typeof process !== 'undefined' && process.versions?.node,
    storageDriver: process.env.STORAGE_DRIVER,
    hasS3Key: !!process.env.S3_ACCESS_KEY,
  }

  return results
})
