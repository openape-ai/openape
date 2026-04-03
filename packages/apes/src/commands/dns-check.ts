import { defineCommand } from 'citty'
import consola from 'consola'
import { resolveDDISA } from '@openape/core'
import { CliError } from '../errors'

export const dnsCheckCommand = defineCommand({
  meta: {
    name: 'dns-check',
    description: 'Validate DDISA DNS TXT records for a domain',
  },
  args: {
    domain: {
      type: 'positional',
      description: 'Domain to check (e.g. example.com)',
      required: true,
    },
  },
  async run({ args }) {
    const domain = args.domain

    consola.start(`Checking _ddisa.${domain}...`)

    try {
      const result = await resolveDDISA(domain)

      if (!result) {
        console.log('')
        console.log('To set up DDISA, add a DNS TXT record:')
        console.log(`  _ddisa.${domain} TXT "v=ddisa1 idp=https://id.${domain}"`)
        throw new CliError(`No DDISA record found for ${domain}`)
      }

      consola.success(`_ddisa.${domain} → ${result.idp}`)
      console.log('')
      console.log(`  Version:  ${result.version || 'ddisa1'}`)
      console.log(`  IdP URL:  ${result.idp}`)
      if (result.mode)
        console.log(`  Mode:     ${result.mode}`)
      if (result.priority !== undefined)
        console.log(`  Priority: ${result.priority}`)

      // Try OIDC discovery on the IdP
      console.log('')
      consola.start(`Verifying IdP at ${result.idp}...`)

      const discoResp = await fetch(`${result.idp}/.well-known/openid-configuration`)

      if (!discoResp.ok) {
        consola.warn(`IdP discovery failed (${discoResp.status}). Is the IdP running at ${result.idp}?`)
        return
      }

      const disco = await discoResp.json() as Record<string, unknown>

      consola.success(`IdP is reachable`)
      console.log(`  Issuer:   ${disco.issuer}`)
      console.log(`  DDISA:    v${disco.ddisa_version || '?'}`)

      if (disco.ddisa_auth_methods_supported) {
        console.log(`  Auth:     ${(disco.ddisa_auth_methods_supported as string[]).join(', ')}`)
      }

      if (disco.openape_grant_types_supported) {
        console.log(`  Grants:   ${(disco.openape_grant_types_supported as string[]).join(', ')}`)
      }
    }
    catch (err) {
      throw new CliError(`DNS check failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})
