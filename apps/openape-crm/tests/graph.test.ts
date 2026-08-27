import { describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret } from '../server/utils/secret'
import { accessTokenFresh, buildEventBody, buildSendMailBody, folderPath, graphAuthorizeUrl, isGraphConfigured } from '../server/utils/graph'

const cfg = {
  clientId: 'cid',
  clientSecret: 'sec',
  tokenSecret: 'tokensecret-at-least-16',
  publicUrl: 'https://crm.openape.ai',
  webhookUrl: 'https://crm.openape.ai/api/graph/notifications',
}

describe('graph helpers', () => {
  it('builds the authorize URL with crm scopes', () => {
    const url = graphAuthorizeUrl(cfg, 'state-1')
    expect(url).toContain('client_id=cid')
    expect(url).toContain('Mail.Send')
    expect(url).toContain('Files.ReadWrite')
    expect(url).toContain(encodeURIComponent('https://crm.openape.ai/api/auth/microsoft/callback'))
    expect(url).toContain('login.microsoftonline.com/common/')
  })

  it('uses the tenant authority when set', () => {
    const url = graphAuthorizeUrl({ ...cfg, tenantId: 'tenant-1' }, 'state-1')
    expect(url).toContain('login.microsoftonline.com/tenant-1/')
    expect(url).not.toContain('/common/')
  })

  it('is unconfigured without a client id', () => {
    expect(isGraphConfigured({ ...cfg, clientId: '' })).toBe(false)
    expect(isGraphConfigured(cfg)).toBe(true)
  })

  it('builds sendMail and event payloads', () => {
    const mail = buildSendMailBody({ to: ['a@b.c'], subject: 'Hi', body: 'Text' })
    expect(mail.message.toRecipients[0]!.emailAddress.address).toBe('a@b.c')
    const event = buildEventBody({
      subject: 'Demo',
      start: '2026-09-01T10:00:00Z',
      end: '2026-09-01T11:00:00Z',
      attendees: ['a@b.c'],
    })
    expect(event.isOnlineMeeting).toBe(true)
  })

  it('uses the OneDrive folder convention', () => {
    expect(folderPath('ws1', 'deal1')).toBe('OpenApe CRM/ws1/deal1')
  })
})

describe('token encryption', () => {
  it('round-trips a refresh token', () => {
    const blob = encryptSecret('refresh-xyz', cfg.tokenSecret)
    expect(blob).not.toContain('refresh-xyz')
    expect(decryptSecret(blob, cfg.tokenSecret)).toBe('refresh-xyz')
  })
})

describe('accessTokenFresh', () => {
  it('reuses tokens until near expiry', () => {
    expect(accessTokenFresh(200_000, 100_000, 60_000)).toBe(true)
    expect(accessTokenFresh(150_000, 100_000, 60_000)).toBe(false)
    expect(accessTokenFresh(100_000, 100_000, 60_000)).toBe(false)
  })
})
