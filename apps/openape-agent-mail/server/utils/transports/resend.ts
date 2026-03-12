import { Resend } from 'resend'
import { useRuntimeConfig } from 'nitropack/runtime'
import type { EmailTransport, DnsRecord } from '../transport'

let _resend: Resend | null = null

function getResend(): Resend {
  if (!_resend) {
    const config = useRuntimeConfig()
    _resend = new Resend((config.resendApiKey as string).trim())
  }
  return _resend
}

export function createResendTransport(): EmailTransport {
  return {
    async send({ from, to, subject, html, text }) {
      const resend = getResend()
      const result = await resend.emails.send({
        from,
        to,
        subject,
        html: html || '',
        text: text || '',
      } as any)
      if (result.error) throw new Error(result.error.message)
      return { id: result.data!.id }
    },

    async createDomain(domain: string) {
      const resend = getResend()
      const result = await resend.domains.create({ name: domain })
      if (result.error) throw new Error(result.error.message)

      const data = result.data!
      const dnsRecords: DnsRecord[] = (data.records || []).map((r: any) => ({
        type: r.type,
        name: r.name,
        value: r.value,
      }))

      return { id: String(data.id), dnsRecords }
    },

    async verifyDomain(domainId: string) {
      const resend = getResend()
      const result = await resend.domains.verify(domainId)
      if (result.error) throw new Error(result.error.message)

      const status = (result.data as any)?.status as string
      if (status === 'verified') return { status: 'verified' as const }
      if (status === 'failed') return { status: 'failed' as const }
      return { status: 'pending' as const }
    },

    async deleteDomain(domainId: string) {
      const resend = getResend()
      const result = await resend.domains.remove(domainId)
      if (result.error) throw new Error(result.error.message)
    },

    async getInboundMessage(emailId: string) {
      const resend = getResend()
      const result = await resend.emails.get(emailId)
      if (result.error) throw new Error(result.error.message)

      const data = result.data as any
      return {
        from: String(data.from || ''),
        to: String(Array.isArray(data.to) ? data.to[0] || '' : data.to || ''),
        subject: String(data.subject || ''),
        text: data.text as string | undefined,
        html: data.html as string | undefined,
      }
    },
  }
}
