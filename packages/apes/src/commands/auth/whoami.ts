import { defineCommand } from 'citty'
import consola from 'consola'
import { loadAuth } from '../../config'
import { CliError } from '../../errors'

export const whoamiCommand = defineCommand({
  meta: {
    name: 'whoami',
    description: 'Show current identity',
  },
  run() {
    const auth = loadAuth()
    if (!auth) {
      throw new CliError('Not logged in. Run `apes login` first.')
    }

    // Token freshness is handled centrally in cli.ts via ensureFreshToken
    // before any subcommand other than login/logout/init/etc. runs. By the
    // time we get here, auth.json is as fresh as it can be — we just print.
    const isAgent = auth.email.includes('agent+')
    const expiresAt = new Date(auth.expires_at * 1000).toISOString()
    const isExpired = Date.now() / 1000 > auth.expires_at

    console.log(`Email: ${auth.email}`)
    console.log(`Type:  ${isAgent ? 'agent' : 'human'}`)
    console.log(`IdP:   ${auth.idp}`)
    console.log(`Token: ${isExpired ? '⚠ EXPIRED' : 'valid'} (until ${expiresAt})`)

    if (isExpired) {
      consola.warn('Token is expired and could not be auto-refreshed. Run `apes login` to re-authenticate.')
    }
  },
})
