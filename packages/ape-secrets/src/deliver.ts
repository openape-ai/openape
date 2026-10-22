import type { DeliveryPackage } from '@openape/secrets-crypto'
import { spawn } from 'node:child_process'
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { keyFingerprint, openDelivery, verifyDelivery } from '@openape/secrets-crypto'
import { KEY_DIR } from './keys.ts'

/**
 * Turning a collected package into plaintext on this machine, and handing it
 * to exactly one target. The value lives in local variables only: it is never
 * printed, put on a command line or included in an error message.
 */

export interface Collected {
  approval_id: string
  mode: 'once' | 'timed' | 'standing'
  expires_at: number | null
  vault_id: string
  consumer_key_fingerprint: string
  secret: { id: string, version: number }
  package: DeliveryPackage
  signature: string
  vault_signing_key: JsonWebKey
}

export interface PinStore {
  read: () => Record<string, string>
  write: (pins: Record<string, string>) => void
}

export class PinMismatchError extends Error {
  constructor(vaultId: string) {
    super(`The vault key for ${vaultId} is not the one this machine pinned. Refusing to open the package. If the owner really replaced the vault key, remove its entry from ${pinsPath()}.`)
  }
}

export function pinsPath(): string {
  return join(KEY_DIR, 'vault-keys.json')
}

/** Vault key fingerprints this machine trusts, one per vault, in a 0600 file. */
export const filePins: PinStore = {
  read: () => existsSync(pinsPath()) ? JSON.parse(readFileSync(pinsPath(), 'utf8')) as Record<string, string> : {},
  write: (pins) => {
    mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 })
    writeNewFile(`${pinsPath()}.${process.pid}.tmp`, JSON.stringify(pins, null, 2))
    renameSync(`${pinsPath()}.${process.pid}.tmp`, pinsPath())
  },
}

/**
 * Trust on first use: the first vault key seen for a vault is pinned; any
 * later different key is refused, so a server cannot swap in its own key.
 */
export function checkPin(vaultId: string, fingerprint: string, store: PinStore): 'pinned' | 'match' {
  const pins = store.read()
  const pinned = pins[vaultId]
  if (pinned === fingerprint) return 'match'
  if (pinned) throw new PinMismatchError(vaultId)
  store.write({ ...pins, [vaultId]: fingerprint })
  return 'pinned'
}

/** Check the pinned vault key and its signature, then open with this machine's private key. */
export async function openCollected(c: Collected, privateJwk: JsonWebKey, store: PinStore) {
  const fingerprint = await keyFingerprint(c.vault_signing_key)
  const pin = checkPin(c.vault_id, fingerprint, store)
  const context = { vaultId: c.vault_id, approvalId: c.approval_id, consumerKeyFingerprint: c.consumer_key_fingerprint, secretId: c.secret.id, version: c.secret.version }
  const signed = await verifyDelivery(c.vault_signing_key, c.package, context, c.signature).catch(() => false)
  if (!signed) throw new Error('The package signature does not match the vault key. Refusing to open it.')
  return { value: await openDelivery(privateJwk, c.package, context), pin, vaultKeyFingerprint: fingerprint }
}

function writeNewFile(path: string, content: string) {
  const fd = openSync(path, 'wx', 0o600)
  try {
    writeSync(fd, content)
  }
  finally {
    closeSync(fd)
  }
  chmodSync(path, 0o600)
}

function refuseSymlink(path: string) {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error(`${path} is a symlink. Refusing to write a secret through it.`)
}

/**
 * Check a file target before anything is collected, so a once approval is not
 * used up on a target that will be refused. Writes are owner-only (0600); an
 * overwrite goes through a new file in the same directory and an atomic rename.
 */
export function prepareFileTarget(path: string, overwrite: boolean) {
  refuseSymlink(path)
  if (existsSync(path) && !overwrite) throw new Error(`${path} already exists. Pass --overwrite to replace it.`)
  if (!existsSync(dirname(path))) throw new Error(`The directory ${dirname(path)} does not exist.`)
  return {
    write(value: string) {
      if (!overwrite) return writeNewFile(path, value)
      const temp = join(dirname(path), `.ape-secrets-${process.pid}-${Date.now()}.tmp`)
      writeNewFile(temp, value)
      try {
        refuseSymlink(path)
        renameSync(temp, path)
      }
      catch (err) {
        unlinkSync(temp)
        throw err
      }
    },
  }
}

/**
 * Start a command (no shell) and give it the value through stdin or one
 * environment variable. Resolves with the command's exit code.
 */
export function runWithSecret(command: string[], value: string, via: { stdin: true } | { env: string }): Promise<number> {
  const [file, ...args] = command
  if (!file) return Promise.reject(new Error('No command given. Put it after --, e.g. -- ./deploy.sh'))
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      shell: false,
      stdio: ['stdin' in via ? 'pipe' : 'inherit', 'inherit', 'inherit'],
      env: 'env' in via ? { ...process.env, [via.env]: value } : process.env,
    })
    child.on('error', err => reject(new Error(`The command could not start: ${(err as NodeJS.ErrnoException).code ?? 'error'} (${file})`)))
    child.on('close', code => resolve(code ?? 1))
    if ('stdin' in via && child.stdin) {
      child.stdin.on('error', () => {}) // a command that does not read stdin closes it early; its exit code tells the story
      child.stdin.end(value)
    }
  })
}
