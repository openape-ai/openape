import { defineOpenApeCallbackHandler } from '@openape/nuxt-auth-sp/handlers'
import { parseOwner, ProtocolError, sameOwner } from '@openape/pods-protocol'
import { workspaceSession } from '../../utils/workspace'

export default defineOpenApeCallbackHandler({
  async onSuccess(event, { claims }) {
    if (claims.act !== 'human' || claims.delegate || claims.delegation_grant) throw new ProtocolError('direct_human_required', 403)
    const owner = parseOwner({ issuer: claims.iss, subject: claims.sub })
    const config = useRuntimeConfig()
    const allowed = config.relayOwnerAllowlist.map(parseOwner)
    if (config.relayEnrollment !== 'public' && !(config.relayEnrollment === 'pilot' && allowed.some(item => sameOwner(item, owner)))) throw new ProtocolError('enrollment_closed', 403)
    const session = await workspaceSession(event)
    const returnTo = session.data.returnTo
    await session.clear(); await session.update({ owner })
    await sendRedirect(event, returnTo ?? '/workspace')
  },
  async onError(event) {
    const returnTo = (await workspaceSession(event)).data.returnTo
    await sendRedirect(event, returnTo ? '/inbox/?login=failed' : '/workspace?login=failed')
  },
})
