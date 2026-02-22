// Storage is configured via nitro.storage in nuxt.config.ts
// Access with useStorage('db') in server routes
// Set STORAGE_DRIVER=s3 + S3_* env vars for S3, default is fs-lite

export const useAppStorage = () => useStorage('db')
