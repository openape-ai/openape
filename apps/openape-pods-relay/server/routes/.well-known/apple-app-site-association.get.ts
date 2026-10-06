export default defineEventHandler(() => {
  const config = useRuntimeConfig()
  return { applinks: { details: [{ appIDs: [`${config.relayAppleTeam}.${config.relayAppleBundle}`], components: [{ '/': '/mobile-auth/return' }] }] }, webcredentials: { apps: [`${config.relayAppleTeam}.${config.relayAppleBundle}`] } }
})
