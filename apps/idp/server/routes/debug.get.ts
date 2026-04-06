export default defineEventHandler(async () => {
  try {
    const config = useIdPConfig()
    const stores = useIdPStores()
    return {
      ok: true,
      config: { issuer: config.issuer, hasMgmt: !!config.managementToken },
      stores: Object.keys(stores),
    }
  }
  catch (e: any) {
    return { error: true, message: e.message, stack: e.stack?.split('\n').slice(0, 5) }
  }
})
