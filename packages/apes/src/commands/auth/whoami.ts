import { defineCommand } from 'citty'
import consola from 'consola'
import { loadAuth } from '../../config'

export const whoamiCommand = defineCommand({
  meta: {
    name: 'whoami',
    description: 'Show current identity',
  },
  run() {
    const auth = loadAuth()
    if (!auth) {
      consola.error('Not logged in. Run `apes login` first.')
      return process.exit(1)
    }

    const isAgent = auth.email.includes('agent+')
    const expiresAt = new Date(auth.expires_at * 1000).toISOString()

    console.log(`Email: ${auth.email}`)
    console.log(`Type:  ${isAgent ? 'agent' : 'human'}`)
    console.log(`IdP:   ${auth.idp}`)
    console.log(`Token valid until: ${expiresAt}`)
  },
})
