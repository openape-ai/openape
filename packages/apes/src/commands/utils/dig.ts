import { defineCommand } from 'citty'
import consola from 'consola'
import { resolveDDISA } from '@openape/core'
import { CliError } from '../../errors'

/**
 * `apes utils dig <domain|email>` — DDISA-aware DNS lookup.
 *
 * Resolves the IdP for a domain (or strips the local part of an email and
 * resolves the domain). Prints the TXT record, parsed DDISA fields, and a
 * one-shot OIDC discovery probe so you can tell at a glance whether
 * `apes login user@<domain>` will work.
 *
 * Supersedes the older `apes dns-check` which only accepted a bare domain.
 */
export const digCommand = defineCommand({
  meta: {
    name: 'dig',
    description: 'Resolve DDISA IdP for a domain or email (admin/diag tool)',
  },
  args: {
    target: {
      type: 'positional',
      description: 'Domain (example.com) or email (alice@example.com)',
      required: true,
    },
    json: {
      type: 'boolean',
      description: 'Machine-readable JSON output',
    },
  },
  async run({ args }) {
    const raw = String(args.target).trim()
    const at = raw.indexOf('@')
    const domain = at >= 0 ? raw.slice(at + 1) : raw
    const localPart = at >= 0 ? raw.slice(0, at) : null

    if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
      throw new CliError(`Invalid domain: ${domain}`)
    }

    interface DigResult {
      input: string
      domain: string
      localPart: string | null
      ddisa: { found: boolean, idp?: string, version?: string, mode?: string, priority?: number }
      idpDiscovery?: { ok: boolean, status?: number, issuer?: string, ddisaVersion?: string, authMethods?: string[], grantTypes?: string[] }
      hint?: string
    }
    const result: DigResult = {
      input: raw,
      domain,
      localPart,
      ddisa: { found: false },
    }

    const ddisa = await resolveDDISA(domain)
    if (ddisa) {
      result.ddisa = {
        found: true,
        idp: ddisa.idp,
        version: ddisa.version,
        mode: ddisa.mode,
        priority: ddisa.priority,
      }

      try {
        const resp = await fetch(`${ddisa.idp}/.well-known/openid-configuration`)
        if (resp.ok) {
          const disco = await resp.json() as Record<string, unknown>
          result.idpDiscovery = {
            ok: true,
            status: resp.status,
            issuer: typeof disco.issuer === 'string' ? disco.issuer : undefined,
            ddisaVersion: typeof disco.ddisa_version === 'string' ? disco.ddisa_version : undefined,
            authMethods: Array.isArray(disco.ddisa_auth_methods_supported) ? disco.ddisa_auth_methods_supported as string[] : undefined,
            grantTypes: Array.isArray(disco.openape_grant_types_supported) ? disco.openape_grant_types_supported as string[] : undefined,
          }
        }
        else {
          result.idpDiscovery = { ok: false, status: resp.status }
        }
      }
      catch (err) {
        result.idpDiscovery = { ok: false }
        result.hint = `IdP at ${ddisa.idp} unreachable: ${err instanceof Error ? err.message : String(err)}`
      }
    }
    else {
      result.hint = `No DDISA record. Add a TXT record:\n  _ddisa.${domain}  TXT  "v=ddisa1 idp=https://id.${domain}; mode=open"`
    }

    if (args.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
      if (!result.ddisa.found || result.idpDiscovery?.ok === false) process.exit(1)
      return
    }

    console.log(`Target: ${raw}`)
    if (localPart) console.log(`  user:   ${localPart}`)
    console.log(`  domain: ${domain}`)
    console.log('')

    if (!result.ddisa.found) {
      consola.warn(`No DDISA record at _ddisa.${domain}`)
      if (result.hint) console.log(`\n${result.hint}`)
      throw new CliError(`No DDISA record found for ${domain}`)
    }

    consola.success(`_ddisa.${domain} → ${result.ddisa.idp}`)
    console.log(`  Version:  ${result.ddisa.version || 'ddisa1'}`)
    console.log(`  IdP URL:  ${result.ddisa.idp}`)
    if (result.ddisa.mode) console.log(`  Mode:     ${result.ddisa.mode}`)
    if (result.ddisa.priority !== undefined) console.log(`  Priority: ${result.ddisa.priority}`)
    console.log('')

    if (!result.idpDiscovery) {
      // No discovery attempt happened — shouldn't reach here in practice
      return
    }
    if (result.idpDiscovery.ok) {
      consola.success(`IdP reachable (${result.idpDiscovery.status ?? 200})`)
      if (result.idpDiscovery.issuer) console.log(`  Issuer:   ${result.idpDiscovery.issuer}`)
      if (result.idpDiscovery.ddisaVersion) console.log(`  DDISA:    v${result.idpDiscovery.ddisaVersion}`)
      if (result.idpDiscovery.authMethods?.length) console.log(`  Auth:     ${result.idpDiscovery.authMethods.join(', ')}`)
      if (result.idpDiscovery.grantTypes?.length) console.log(`  Grants:   ${result.idpDiscovery.grantTypes.join(', ')}`)
    }
    else {
      consola.warn(`IdP discovery failed${result.idpDiscovery.status ? ` (HTTP ${result.idpDiscovery.status})` : ''}`)
      if (result.hint) console.log(`\n${result.hint}`)
      throw new CliError(`IdP at ${result.ddisa.idp} not reachable`)
    }
  },
})
