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
  if (flags.idp) {
    idp = flags.idp
  }
  else if (process.env.APES_IDP) {
    idp = process.env.APES_IDP
  }
  else if (process.env.GRAPES_IDP) {
    idp = process.env.GRAPES_IDP
    consola.warn(
      'GRAPES_IDP is deprecated, use APES_IDP instead. '
      + 'GRAPES_IDP support will be removed in a future release.',
    )
  }
  else if (config.defaults?.idp) {
    idp = config.defaults.idp
  }
  else if (email && email.includes('@')) {
    const domain = email.split('@')[1]!
    try {
      const record = await resolveDDISA(domain)
      if (record?.idp) {
        idp = record.idp
        consola.info(`Discovered IdP via DDISA (_ddisa.${domain}): ${idp}`)
      }
    }
    catch {
      // DNS failure is non-fatal — caller will surface a clear error
    }
  }

  return { keyPath, email, idp }
}
