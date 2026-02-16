import { DOH_PROVIDERS, DNS_TXT_TYPE } from '../constants.js'

interface DoHAnswer {
  type: number
  data: string
}

interface DoHResponse {
  Answer?: DoHAnswer[]
}

export async function resolveTXT(
  domain: string,
  provider: string = DOH_PROVIDERS[0],
): Promise<string[]> {
  const url = `${provider}?type=TXT&name=${encodeURIComponent(domain)}`

  const response = await fetch(url, {
    headers: { accept: 'application/dns-json' },
  })

  if (!response.ok) {
    throw new Error(`DoH request failed: ${response.status}`)
  }

  const data = await response.json() as DoHResponse

  if (!data.Answer) {
    return []
  }

  return data.Answer
    .filter(a => a.type === DNS_TXT_TYPE)
    .map(a => a.data.replace(/^"|"$/g, ''))
}
