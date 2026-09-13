import { createServer } from 'node:https'
import { connect } from 'node:net'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startMailProxy } from '../../src/main/mail/proxy'

const execute = promisify(execFile)
export async function mailTLSFixture(root: string) {
  const certificate = join(root, 'certificate.pem'); const key = join(root, 'key.pem'); const config = join(root, 'openssl.cnf')
  await writeFile(config, '[req]\ndistinguished_name=dn\nx509_extensions=extensions\nprompt=no\n[dn]\nCN=Pods synthetic fixture\n[extensions]\nbasicConstraints=critical,CA:TRUE\nsubjectAltName=DNS:graph.microsoft.com,DNS:login.microsoftonline.com\n')
  await execute('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-config', config, '-keyout', key, '-out', certificate])
  const requests: string[] = []; const state = { refreshes: 0, reads: 0, invalidRefresh: false, wrongAccount: false, stallRead: false }
  const authority = 'https://login.microsoftonline.com/common'
  const server = createServer({ key: await readFile(key), cert: await readFile(certificate) }, (request, response) => {
    const handle = async () => {
      requests.push(`${request.method} ${request.headers.host}${request.url}`)
      response.setHeader('Content-Type', 'application/json')
      const url = new URL(request.url ?? '/', `https://${request.headers.host}`)
      if (url.hostname === 'login.microsoftonline.com') {
        if (url.pathname.includes('discovery/instance')) { response.end(JSON.stringify({ tenant_discovery_endpoint: `${authority}/v2.0/.well-known/openid-configuration`, metadata: [{ preferred_network: 'login.microsoftonline.com', preferred_cache: 'login.microsoftonline.com', aliases: ['login.microsoftonline.com'] }] })); return }
        if (url.pathname.includes('.well-known')) { response.end(JSON.stringify({ token_endpoint: `${authority}/oauth2/v2.0/token`, authorization_endpoint: `${authority}/oauth2/v2.0/authorize`, issuer: `${authority}/v2.0` })); return }
        if (url.pathname.endsWith('/token') && request.method === 'POST') {
          let body = ''; for await (const chunk of request) { body += chunk.toString(); if (body.length > 16384) throw new Error('Oversized fixture request') }
          const form = new URLSearchParams(body)
          if (form.get('grant_type') !== 'refresh_token' || form.get('refresh_token') !== 'synthetic-refresh' || !form.get('scope')?.includes('Mail.Read') || /Write|Send|Calendars/.test(form.get('scope') ?? '')) throw new Error('Unexpected OAuth contract')
          state.refreshes++
          if (state.invalidRefresh) { response.statusCode = 400; response.end('{"error":"invalid_grant"}'); return }
          const now = Math.floor(Date.now() / 1000)
          const claims = { aud: '5aa6d895-1072-41c4-beb6-d8e3fdf0e7cd', exp: now + 3600, iat: now, iss: `${authority}/v2.0`, tid: 'fixture-tenant', oid: 'fixture-user', sub: 'fixture-user', preferred_username: state.wrongAccount ? 'other@example.invalid' : 'pod@example.invalid' }
          response.end(JSON.stringify({ access_token: 'SYNTHETIC_TLS_ACCESS', token_type: 'Bearer', expires_in: 3600, refresh_token: 'SYNTHETIC_TLS_REFRESH', scope: 'https://graph.microsoft.com/Mail.Read', id_token: `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`, client_info: Buffer.from('{"uid":"fixture-user","utid":"fixture-tenant"}').toString('base64url') })); return
        }
      }
      if (url.hostname === 'graph.microsoft.com' && request.method === 'GET' && request.headers.authorization === 'Bearer SYNTHETIC_TLS_ACCESS' && request.headers.prefer === 'IdType="ImmutableId"') {
        state.reads++
        if (state.stallRead) return
        if (!url.pathname.endsWith('/mailFolders/inbox/messages')) throw new Error('Unassigned fixture folder')
        const next = new URL(url)
        next.searchParams.set('$skip', '10')
        response.end(JSON.stringify({ value: [{ id: url.searchParams.has('$skip') ? 'second' : 'first', changeKey: 'v1', parentFolderId: 'inbox', receivedDateTime: '2020-01-01T00:00:00Z', subject: 'Synthetic TLS mail', body: { contentType: 'text', content: 'Read without changing isRead.' }, isRead: false }], ...(!url.searchParams.has('$skip') ? { '@odata.nextLink': next.href } : {}) })); return
      }
      response.statusCode = 400; response.end('{"error":"Unexpected fixture request"}')
    }
    void handle().catch((error: unknown) => { response.statusCode = 500; response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Fixture failed' })) })
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing TLS fixture address')
  const controller = new AbortController()
  const proxy = await startMailProxy(controller.signal, () => connect({ host: '127.0.0.1', port: address.port }))
  return { certificate, state, requests, proxy, dial: () => connect({ host: '127.0.0.1', port: address.port }), close: async () => { controller.abort(); await proxy.close(); server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) } }
}
