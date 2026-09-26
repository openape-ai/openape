#!/usr/bin/env node
import { readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function microsoftMail(argv = process.argv.slice(2), environment = process.env) {
  const graphOrigin = 'https://graph.microsoft.com'
  const fields = 'id,changeKey,parentFolderId,internetMessageId,conversationId,subject,from,receivedDateTime,webLink,body,hasAttachments,flag,importance,isRead,toRecipients,ccRecipients,replyTo'
  const args = [...argv]
  const operation = args.shift()
  const values = {}
  const allowed = { list: ['account', 'cursor'], read: ['account', 'message'], thread: ['account', 'conversation'], archive: ['account', 'message', 'version', 'folder'] }
  if (!Object.hasOwn(allowed, operation)) throw new Error('Use list, read, thread or archive')
  while (args.length) {
    const key = args.shift()?.replace(/^--/, ''); const value = args.shift()
    if (!allowed[operation].includes(key) || Object.hasOwn(values, key) || !value || value.length > 8192) throw new Error('Invalid mail arguments')
    values[key] = value
  }
  const account = values.account?.toLowerCase()
  if (!account || !/^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/.test(account)) throw new Error('An exact mailbox is required')
  const cacheRoot = environment.O365_CACHE_DIR
  if (!cacheRoot) throw new Error('Assign the dedicated Microsoft authentication directory')
  const cache = JSON.parse(await readFile(join(cacheRoot, 'token.json'), 'utf8'))
  const accounts = Object.values(cache.Account ?? {}).filter(item => item.username?.toLowerCase() === account && item.environment === 'login.microsoftonline.com')
  if (accounts.length !== 1) throw new Error('Microsoft account is missing or ambiguous')
  const identity = accounts[0]
  const tokenPath = join(environment.HOME, `pods-mail-${encodeURIComponent(account)}.json`)
  let cached
  try { cached = JSON.parse(await readFile(tokenPath, 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  async function accessToken() {
    if (cached?.account === account && cached.expiresAt > Date.now() + 60000) return cached.accessToken
    const existing = Object.values(cache.AccessToken ?? {}).find(item => item.home_account_id === identity.home_account_id && item.environment === identity.environment && item.target?.includes('https://graph.microsoft.com/') && Number(item.expires_on) * 1000 > Date.now() + 60000)
    if (existing) return existing.secret
    const refresh = Object.values(cache.RefreshToken ?? {}).find(item => item.home_account_id === identity.home_account_id && item.environment === identity.environment)
    if (!refresh) throw new Error('Microsoft sign-in must be renewed in the assigned program')
    const response = await fetch('https://login.microsoftonline.com/organizations/oauth2/v2.0/token', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: refresh.client_id, grant_type: 'refresh_token', refresh_token: cached?.account === account && cached.refreshToken ? cached.refreshToken : refresh.secret, scope: 'https://graph.microsoft.com/Mail.ReadWrite offline_access' }) })
    if (!response.ok) throw new Error(`Microsoft authentication renewal failed (${response.status})`)
    const result = await response.json()
    if (typeof result.access_token !== 'string' || typeof result.expires_in !== 'number') throw new Error('Invalid Microsoft authentication renewal')
    cached = { account, accessToken: result.access_token, refreshToken: result.refresh_token ?? refresh.secret, expiresAt: Date.now() + result.expires_in * 1000 }
    await writeFile(`${tokenPath}.tmp`, JSON.stringify(cached), { mode: 0o600 }); await rename(`${tokenPath}.tmp`, tokenPath)
    return cached.accessToken
  }
  const token = await accessToken()
  async function request(path, method = 'GET', body) {
    const url = new URL(path, graphOrigin)
    if (url.origin !== graphOrigin || !url.pathname.startsWith('/v1.0/me/')) throw new Error('Mail request escaped the assigned Microsoft mailbox')
    const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${token}`, Prefer: 'IdType="ImmutableId", outlook.body-content-type="text"', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
    if (response.status === 404 && method === 'GET') return null
    if (!response.ok) throw new Error(`Microsoft mail ${method} failed (${response.status})`)
    const text = await response.text()
    if (text.length > 4000000) throw new Error('Microsoft mail response exceeds its limit')
    return JSON.parse(text)
  }
  function mail(item, includeBody = false) {
    const sender = item.from?.emailAddress?.address
    if ([item.id, item.changeKey, item.parentFolderId, item.internetMessageId, sender, item.receivedDateTime, item.webLink].some(value => typeof value !== 'string' || !value)) throw new Error('Microsoft mail identity is incomplete')
    const content = item.body?.content ?? ''
    return { id: item.id, version: item.changeKey, folder: item.parentFolderId, internetMessageId: item.internetMessageId, sender, subject: (item.subject ?? '').replace(/\s+/g, ' ').trim(), receivedAt: item.receivedDateTime, url: item.webLink,
      ...(includeBody ? { conversation: item.conversationId, body: content.slice(0, 6000), truncated: content.length > 6000, hasAttachments: item.hasAttachments === true, flagged: item.flag?.flagStatus === 'flagged', important: item.importance === 'high', unread: item.isRead !== true, participants: [...item.toRecipients ?? [], ...item.ccRecipients ?? [], ...item.replyTo ?? []].map(item => item.emailAddress?.address).filter(Boolean) } : {}) }
  }
  const inbox = await request('/v1.0/me/mailFolders/inbox?$select=id,totalItemCount')
  if (!inbox?.id) throw new Error('Microsoft Inbox could not be resolved')
  const output = { protocol: 'pods-mail-review/v1', account, operation }
  if (operation === 'list') {
    let path = `/v1.0/me/mailFolders/inbox/messages?$top=20&$orderby=receivedDateTime%20desc&$select=${fields}`
    if (values.cursor) {
      const url = new URL(values.cursor)
      const paths = ['/v1.0/me/mailFolders/inbox/messages', '/v1.0/me/mailFolders(\'inbox\')/messages', `/v1.0/me/mailFolders/${inbox.id}/messages`, `/v1.0/me/mailFolders('${inbox.id.replaceAll('\'', '\'\'')}')/messages`]
      if (url.origin !== graphOrigin || !paths.includes(decodeURIComponent(url.pathname))) throw new Error('Invalid Inbox pagination cursor')
      path = url.href
    }
    const page = await request(path)
    if (!Array.isArray(page?.value)) throw new Error('Incomplete Microsoft Inbox page')
    output.messages = page.value.map(item => mail(item, true)); output.next = page['@odata.nextLink'] ?? null; output.total = inbox.totalItemCount
  }
  else if (operation === 'thread') {
    if (!values.conversation) throw new Error('Conversation is required')
    const filter = `conversationId eq '${values.conversation.replaceAll('\'', '\'\'')}'`
    const page = await request(`/v1.0/me/messages?$top=20&$filter=${encodeURIComponent(filter)}&$select=${fields}`)
    if (!Array.isArray(page?.value)) throw new Error('Incomplete Microsoft conversation')
    output.messages = page.value.map(item => mail(item, true)); output.truncated = Boolean(page['@odata.nextLink'])
  }
  else {
    if (!values.message) throw new Error('Message is required')
    const current = await request(`/v1.0/me/mailFolders/${encodeURIComponent(inbox.id)}/messages/${encodeURIComponent(values.message)}?$select=${fields}`)
    if (operation === 'read') {
      output.message = current?.parentFolderId === inbox.id ? mail(current) : null
    }
    else {
      if (!values.version || !values.folder) throw new Error('Reviewed version and source folder are required')
      if (!current || current.id !== values.message || current.changeKey !== values.version || current.parentFolderId !== values.folder || values.folder !== inbox.id) { output.state = 'skipped'; output.reason = 'Message changed or left the Inbox' }
      else {
        const archive = await request('/v1.0/me/mailFolders/archive?$select=id')
        if (!archive?.id || archive.id === inbox.id) throw new Error('Microsoft Archive could not be resolved')
        const moved = await request(`/v1.0/me/mailFolders/${encodeURIComponent(inbox.id)}/messages/${encodeURIComponent(current.id)}/move`, 'POST', { destinationId: archive.id })
        if (moved?.id !== current.id || moved.parentFolderId !== archive.id || moved.internetMessageId !== current.internetMessageId) throw new Error('Microsoft move receipt does not match the reviewed message')
        output.state = 'archived'; output.message = mail(moved)
      }
    }
  }
  return output

}
async function main() { process.stdout.write(JSON.stringify(await microsoftMail())) }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => { console.error(error instanceof SyntaxError ? 'Invalid Microsoft mail JSON' : error.message); process.exitCode = 1 })
}
