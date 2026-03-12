import { createResendTransport } from './transports/resend'

export interface DnsRecord {
  type: string
  name: string
  value: string
}

export interface EmailTransport {
  send(params: {
    from: string
    to: string
    subject: string
    html?: string
    text?: string
  }): Promise<{ id: string }>

  createDomain(domain: string): Promise<{
    id: string
    dnsRecords: DnsRecord[]
  }>

  verifyDomain(domainId: string): Promise<{
    status: 'verified' | 'pending' | 'failed'
  }>

  deleteDomain(domainId: string): Promise<void>

  getInboundMessage(emailId: string): Promise<{
    from: string
    to: string
    subject: string
    text?: string
    html?: string
  }>
}

let _transport: EmailTransport | null = null

export function useTransport(): EmailTransport {
  if (!_transport) {
    _transport = createResendTransport()
  }
  return _transport
}

export function setTransport(transport: EmailTransport) {
  _transport = transport
}
