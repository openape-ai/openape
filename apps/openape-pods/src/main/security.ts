import { randomBytes } from 'node:crypto'
import { resolve, sep } from 'node:path'

export const rendererURL = 'pods://app/index.html'
export const rendererStyleNonce = randomBytes(24).toString('base64')
export const contentSecurityPolicy = `default-src 'none'; script-src 'self'; style-src 'self' 'nonce-${rendererStyleNonce}'; img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`
export function assetPath(requestURL: string, root: string): string {
  const url = new URL(requestURL)
  if (url.protocol !== 'pods:' || url.hostname !== 'app' || url.port || url.username || url.password || url.search) throw new Error('Unassigned asset origin')
  const pathname = decodeURIComponent(url.pathname)
  if (pathname.includes('\\') || pathname.includes('\0')) throw new Error('Invalid asset path')
  const file = resolve(root, `.${pathname}`)
  if (!file.startsWith(`${resolve(root)}${sep}`)) throw new Error('Asset escapes renderer directory')
  return file
}
export function assertStatusRequest(trusted: boolean, args: unknown[]): void {
  if (!trusted || args.length !== 0) throw new Error('Rejected Pods status request')
}
