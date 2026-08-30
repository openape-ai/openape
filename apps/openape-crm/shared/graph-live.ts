export function attachTarget(dealId?: string | null, contactId?: string | null) {
  const deal = dealId?.trim() || null
  const contact = contactId?.trim() || null
  if (!deal && !contact) return null
  return { dealId: deal, contactId: contact }
}

export function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export function messageBodyText(msg: {
  body?: { content?: string, contentType?: string }
  bodyPreview?: string
}) {
  const raw = msg.body?.content || msg.bodyPreview || ''
  return msg.body?.contentType === 'html' ? stripHtml(raw) : raw
}

export function recipientAddresses(rows?: { emailAddress?: { address?: string } }[] | null) {
  return (rows ?? []).map(r => r.emailAddress?.address || '').filter(Boolean)
}

export function eventsWindow(now = new Date()) {
  return {
    start: now.toISOString(),
    end: new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString(),
  }
}

export function mapDriveChildren(value: {
  id: string
  name: string
  folder?: unknown
  webUrl?: string
  size?: number
  parentReference?: { id?: string }
}[]) {
  return value.map(item => ({
    id: item.id,
    name: item.name,
    folder: Boolean(item.folder),
    web_url: item.webUrl || null,
    size: item.size ?? null,
    parent_id: item.parentReference?.id ?? null,
  }))
}
