import { defineEventHandler } from 'h3'
import { getFederationProviders } from '../../utils/federation'

export default defineEventHandler(() => {
  const providers = getFederationProviders()
  return providers.map(p => ({
    id: p.id,
    name: p.id.charAt(0).toUpperCase() + p.id.slice(1),
  }))
})
