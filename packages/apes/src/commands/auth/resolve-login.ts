import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolveDDISA } from '@openape/core'
import consola from 'consola'
import { loadConfig } from '../../config'
import { readPublicKeyComment } from '../../ssh-key'

export interface LoginInputs {
  key?: string
  idp?: string
  email?: string
  browser?: boolean
}

export interface ResolvedLoginInputs {
  keyPath?: string
  email?: string
  idp?: string
  /**
   * Set when the chosen `idp` came from an explicit flag/env/config but the
   * email's domain has a DDISA record pointing at a *different* IdP. The
   * caller decides whether to refuse (default), warn-and-continue (`--force`),
   * etc. `undefined` means no mismatch (or no DDISA record to compare against).
   */
  ddisaMismatch?: { dnsIdp: string, chosenIdp: string, domain: string }
}

const DEFAULT_KEY = join(homedir(), '.ssh', 'id_ed25519')

/**
 * Resolve login inputs by walking a fallback cascade:
 *   1. explicit flag
 *   2. environment variable
 *   3. ~/.config/apes/config.toml
 *   4. derivation (default key path, pub key comment, DDISA DNS)
 *
 * When `browser` is true, no key is resolved so the caller falls back to PKCE.
 */
export async function resolveLoginInputs(
  flags: LoginInputs,
): Promise<ResolvedLoginInputs> {
  const config = loadConfig()

  // 1. Key path — skipped entirely in forced browser mode
  let keyPath: string | undefined
  if (!flags.browser) {
    if (flags.key) {
      keyPath = flags.key
    }
    else if (process.env.APES_KEY) {
      keyPath = process.env.APES_KEY
      consola.info(`Using key from APES_KEY: ${keyPath}`)
    }
    else if (config.agent?.key) {
      keyPath = config.agent.key
      consola.info(`Using key from config: ${keyPath}`)
    }
    else if (existsSync(DEFAULT_KEY)) {
      keyPath = DEFAULT_KEY
      consola.info(`Using default key: ${keyPath}`)
    }
  }

  // 2. Email
  let email: string | undefined
  if (flags.email) {
    email = flags.email
  }
  else if (process.env.APES_EMAIL) {
    email = process.env.APES_EMAIL
  }
  else if (config.agent?.email) {
    email = config.agent.email
  }
  else if (keyPath) {
    const comment = readPublicKeyComment(`${keyPath}.pub`)
    if (comment && comment.includes('@')) {
      email = comment
      consola.info(`Using email from ${keyPath}.pub comment: ${email}`)
    }
  }

  // 3. IdP
  // APES_IDP is the canonical env var. GRAPES_IDP is a deprecated alias
  // kept for users with older shell profiles; APES_IDP wins on conflict.
  if (process.env.APES_IDP && process.env.GRAPES_IDP) {
    consola.warn(
      'Both APES_IDP and GRAPES_IDP are set — using APES_IDP. '
      + 'GRAPES_IDP is deprecated and will be removed in a future release.',
    )
  }
  let idp: string | undefined
  let idpSource: 'flag' | 'env' | 'config' | 'ddisa' | undefined
  if (flags.idp) {
    idp = flags.idp
    idpSource = 'flag'
  }
  else if (process.env.APES_IDP) {
    idp = process.env.APES_IDP
    idpSource = 'env'
  }
  else if (process.env.GRAPES_IDP) {
    idp = process.env.GRAPES_IDP
    idpSource = 'env'
    consola.warn(
      'GRAPES_IDP is deprecated, use APES_IDP instead. '
      + 'GRAPES_IDP support will be removed in a future release.',
    )
  }
  else if (config.defaults?.idp) {
    idp = config.defaults.idp
    idpSource = 'config'
  }

  // Always probe DDISA when we have an email — both as the auto-discovery
  // path (when no explicit IdP was supplied) and as a sanity-check against
  // explicit overrides. The caller surfaces the resulting mismatch and
  // gates it behind --force.
  let ddisaIdp: string | undefined
  let ddisaDomain: string | undefined
  if (email && email.includes('@')) {
    const domain = email.split('@')[1]!
    ddisaDomain = domain
    try {
      const record = await resolveDDISA(domain)
      if (record?.idp) ddisaIdp = record.idp
    }
    catch {
      // DNS failure is non-fatal
    }
  }

  if (!idp && ddisaIdp && ddisaDomain) {
    idp = ddisaIdp
    idpSource = 'ddisa'
    consola.info(`Discovered IdP via DDISA (_ddisa.${ddisaDomain}): ${idp}`)
  }

  // Mismatch only matters when the user explicitly chose an IdP that differs
  // from the authoritative DNS record. Auto-discovered IdPs (idpSource ===
  // 'ddisa') are by definition the DDISA record, so they can't mismatch.
  let ddisaMismatch: ResolvedLoginInputs['ddisaMismatch']
  if (idp && ddisaIdp && ddisaDomain && idp !== ddisaIdp && idpSource !== 'ddisa') {
    ddisaMismatch = { dnsIdp: ddisaIdp, chosenIdp: idp, domain: ddisaDomain }
  }

  return { keyPath, email, idp, ddisaMismatch }
}
