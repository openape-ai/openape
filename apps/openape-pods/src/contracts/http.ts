import { parseCredentialAlias } from './credentials'

export interface HttpPermission { origin: string, methods: string[] }
export interface HttpRequest { url: string, method: string, headers: Record<string, string>, body?: string, key?: string, receipt?: 'digest' }
export interface HttpReply { status: number, headers: Record<string, string>, body: string, receipt?: HttpDigest }
export interface HttpDigest { sha256: string, bytes: number }
export interface HttpAuthentication { type: 'ddisaAgent', credential: string, subject: string, issuer: string }
export const httpRequestBodyChars = 64 * 1024
export const httpResponseBodyBytes = 128 * 1024
const httpRequestBytes = 96 * 1024
const httpReplyBytes = 192 * 1024
const methods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']
export function isHttpEffect(method: string): boolean { return !['GET', 'HEAD'].includes(method) }

export function parseHttpPermission(value: unknown): HttpPermission {
  const permission = value as HttpPermission
  if (!permission || typeof permission !== 'object' || Object.keys(permission).some(key => !['origin', 'methods'].includes(key)) || typeof permission.origin !== 'string' || !Array.isArray(permission.methods) || !permission.methods.length || permission.methods.length > methods.length || permission.methods.some(method => !methods.includes(method)) || new Set(permission.methods).size !== permission.methods.length) throw new Error('Invalid HTTP permission')
  const url = new URL(permission.origin)
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('HTTP permissions require a public HTTPS origin on port 443')
  if (url.pathname !== '/' || url.search || url.hash || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(url.hostname) || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local')) throw new Error('Choose a public HTTPS origin without a path')
  return { origin: url.origin, methods: [...permission.methods] }
}

export function parseHttpRequest(value: unknown, permission?: HttpPermission): HttpRequest {
  const request = value as HttpRequest
  if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).some(key => !['url', 'method', 'headers', 'body', 'key', 'receipt'].includes(key)) || typeof request.url !== 'string' || request.url.length > 8192 || typeof request.method !== 'string' || !methods.includes(request.method)) throw new Error('Invalid HTTP request')
  const url = new URL(request.url)
  parseHttpPermission({ origin: url.origin, methods: [request.method] })
  if (url.username || url.password || url.hash || (permission && (url.origin !== permission.origin || !permission.methods.includes(request.method)))) throw new Error('HTTP request is outside the assigned origin or methods')
  if (request.key !== undefined && (typeof request.key !== 'string' || !/^[\w.:-]{1,160}$/.test(request.key))) throw new Error('Invalid HTTP effect key')
  if (isHttpEffect(request.method) && !request.key) throw new Error('A stable effect key is required for this HTTP method')
  if (request.receipt !== undefined && (request.receipt !== 'digest' || !isHttpEffect(request.method))) throw new Error('HTTP receipt must be "digest" and is only valid for effect methods')
  if (request.body !== undefined && (typeof request.body !== 'string' || request.body.length > httpRequestBodyChars || ['GET', 'HEAD'].includes(request.method))) throw new Error('Invalid HTTP request body')
  const headers = request.headers ?? {}
  if (!headers || typeof headers !== 'object' || Array.isArray(headers) || Object.keys(headers).length > 20 || Object.entries(headers).some(([key, value]) => !/^[a-z0-9-]{1,100}$/i.test(key) || ['host', 'connection', 'content-length', 'transfer-encoding', 'upgrade', 'expect', 'proxy-authorization'].includes(key.toLowerCase()) || typeof value !== 'string' || value.length > 4096 || /[\r\n\0]/.test(value))) throw new Error('Invalid HTTP request headers')
  const parsed = { url: url.href, method: request.method, headers: { ...headers }, ...(request.body !== undefined ? { body: request.body } : {}), ...(request.key ? { key: request.key } : {}), ...(request.receipt ? { receipt: request.receipt } : {}) }
  if (new TextEncoder().encode(JSON.stringify(parsed)).length > httpRequestBytes) throw new Error('HTTP request exceeds its size limit')
  return parsed
}

export function parseHttpReply(value: unknown): HttpReply {
  const reply = value as HttpReply
  if (!reply || typeof reply !== 'object' || !Number.isInteger(reply.status) || reply.status < 200 || reply.status > 599 || typeof reply.body !== 'string' || !reply.headers || typeof reply.headers !== 'object' || Array.isArray(reply.headers) || Object.entries(reply.headers).some(([key, item]) => typeof item !== 'string' || /[\r\n\0]/.test(key + item)) || new TextEncoder().encode(JSON.stringify(reply)).length > httpReplyBytes) throw new Error('Invalid HTTP response')
  return reply
}

export function parseHttpAuthentication(value: unknown): HttpAuthentication {
  const authentication = value as HttpAuthentication
  if (!authentication || typeof authentication !== 'object' || Array.isArray(authentication) || Object.keys(authentication).some(key => !['type', 'credential', 'subject', 'issuer'].includes(key)) || authentication.type !== 'ddisaAgent') throw new Error('Invalid HTTP authentication')
  parseCredentialAlias(authentication.credential)
  if (typeof authentication.subject !== 'string' || authentication.subject.length > 320 || !/^[^\s@]+@[^\s@]+$/.test(authentication.subject)) throw new Error('HTTP authentication needs the DDISA agent email')
  const issuer = parseHttpPermission({ origin: authentication.issuer, methods: ['POST'] }).origin
  return { type: 'ddisaAgent', credential: authentication.credential, subject: authentication.subject, issuer }
}
