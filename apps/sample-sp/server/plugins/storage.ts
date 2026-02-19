export default defineNitroPlugin(async () => {
  const driver = (process.env.STORAGE_DRIVER || '').trim()
  if (driver === 's3' && process.env.S3_ACCESS_KEY) {
    try {
      const { default: s3Driver } = await import('unstorage/drivers/s3')
      const storage = useStorage()
      storage.mount('db', s3Driver({
        accessKeyId: process.env.S3_ACCESS_KEY,
        secretAccessKey: process.env.S3_SECRET_KEY!,
        bucket: process.env.S3_BUCKET || 'dnsid',
        endpoint: process.env.S3_ENDPOINT || 'https://sos-at-vie-2.exo.io',
        region: process.env.S3_REGION || 'at-vie-2',
        prefix: 'sample-sp/',
      }))
      console.log('[sample-sp] Storage: S3 mounted')
    } catch (e) {
      console.error('[sample-sp] Failed to mount S3 storage:', e)
    }
  } else {
    const { default: fsDriver } = await import('unstorage/drivers/fs-lite')
    const storage = useStorage()
    storage.mount('db', fsDriver({ base: './.data/sample-sp-db' }))
    console.log('[sample-sp] Storage: fsLite (default)')
  }
})
