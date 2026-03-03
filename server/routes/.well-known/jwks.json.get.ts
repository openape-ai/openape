import { defineEventHandler, setResponseHeader } from 'h3'
import { generateJWKS } from '@openape/auth'
import { useIdpStores } from '../../utils/stores'

export default defineEventHandler(async (event) => {
  const { keyStore } = useIdpStores()
  const jwks = await generateJWKS(keyStore)

  setResponseHeader(event, 'Content-Type', 'application/json')
  setResponseHeader(event, 'Cache-Control', 'public, max-age=3600')

  return jwks
})
