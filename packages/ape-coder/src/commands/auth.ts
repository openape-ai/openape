import { clearSpToken, loadIdpAuth } from '@openape/cli-auth'
import { defineCommand } from 'citty'
import consola from 'consola'
import { resolveCoderUrl } from '../coder-api'
import { CliError } from '../errors'

// ape-coder does NOT own a login. Identity is the shared OpenApe SSO session
// created once per device by `apes login`; every OpenApe CLI reads it via
// @openape/cli-auth. These stubs mirror the ape-plans / ape-tasks / ape-troop
// convention so `ape-coder login` gives a helpful pointer instead of a
// "command not found" (coder-cli criteria 1 + 5).

export const loginCommand = defineCommand({
  meta: { name: 'login', description: '(stub) use `apes login <email>` — all OpenApe CLIs share one session' },
  run() {
    throw new CliError('ape-coder has no separate login. Run `apes login <email>` once on this device; ape-coder reuses that session via SSO.')
  },
})

export const logoutCommand = defineCommand({
  meta: { name: 'logout', description: 'Clear ape-coder\'s cached coder SP-token (does not touch the IdP session)' },
  run() {
    const aud = new URL(resolveCoderUrl()).host
    clearSpToken(aud)
    consola.success(`Cleared cached coder token for ${aud}. The shared IdP session is untouched — run \`apes logout\` to end it.`)
  },
})

export const whoamiCommand = defineCommand({
  meta: { name: 'whoami', description: 'Show the current OpenApe identity (from the shared apes session)' },
  run() {
    const auth = loadIdpAuth()
    if (!auth) {
      throw new CliError('Not signed in. Run `apes login <email>` first.')
    }
    const expiresAt = new Date(auth.expires_at * 1000).toISOString()
    const isExpired = Date.now() / 1000 > auth.expires_at
    console.log(`Email: ${auth.email}`)
    console.log(`IdP:   ${auth.idp}`)
    console.log(`Token: ${isExpired ? '⚠ expired (auto-refreshes on next call)' : 'valid'} (until ${expiresAt})`)
  },
})
