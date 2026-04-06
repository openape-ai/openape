export default defineEventHandler(() => {
  const config = useRuntimeConfig()
  return {
    ok: true,
    hasIssuer: !!(config.issuer),
    hasTursoUrl: !!(config.tursoUrl),
    hasMgmtToken: !!(config.managementToken),
    env: {
      NITRO_ISSUER: !!process.env.NITRO_ISSUER,
      NITRO_TURSO_URL: !!process.env.NITRO_TURSO_URL,
    },
  }
})
