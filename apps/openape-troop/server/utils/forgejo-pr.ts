import { useRuntimeConfig } from 'nitropack/runtime'

export interface ForgejoPr {
  repository: string
  number: number
  title: string
  author: string
  url: string
}

export function parseForgejoPrEvent(body: unknown, baseUrl = ''): ForgejoPr | null {
  if (!body || typeof body !== 'object') return null
  const event = body as Record<string, any>
  if (event.action !== 'opened' || !event.pull_request || !event.repository) return null
  const pr = event.pull_request as Record<string, any>
  const repo = event.repository as Record<string, any>
  const number = Number(pr.number)
  const repository = String(repo.full_name ?? '')
  if (!Number.isInteger(number) || !repository || !String(pr.title ?? '') || !String(pr.user?.login ?? '')) return null
  return {
    repository,
    number,
    title: String(pr.title),
    author: String(pr.user.login),
    url: String(pr.html_url || `${String(repo.html_url || baseUrl).replace(/\/$/, '')}/pulls/${number}`),
  }
}

export async function notifyForgejoPr(ownerEmail: string, pr: ForgejoPr): Promise<string> {
  const config = useRuntimeConfig()
  const apiKey = String(config.resendApiKey || '')
  const from = String(config.mailFrom || 'troop@openape.ai')
  if (!apiKey) throw new Error('NUXT_RESEND_API_KEY not configured')

  const text = [
    `Repository: ${pr.repository}`,
    `PR: #${pr.number}`,
    `Titel: ${pr.title}`,
    `Autor: ${pr.author}`,
    `Link: ${pr.url}`,
  ].join('\n')
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: ownerEmail, subject: `Neuer Forgejo-PR: ${pr.repository}#${pr.number}`, text }),
  })
  const result = await response.json().catch(() => null) as { id?: string, message?: string } | null
  if (!response.ok) throw new Error(`Resend ${response.status}: ${result?.message || 'request failed'}`)
  return result?.id || 'unknown'
}
