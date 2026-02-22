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
        prefix: 'id-server/',
      }))
      console.log('[id-server] Storage: S3 mounted')
    } catch (e) {
      console.error('[id-server] Failed to mount S3 storage:', e)
    }
  } else {
    const { default: fsDriver } = await import('unstorage/drivers/fs-lite')
    const storage = useStorage()
    storage.mount('db', fsDriver({ base: './.data/id-server-db' }))
    console.log('[id-server] Storage: fsLite (default)')
  }
})
