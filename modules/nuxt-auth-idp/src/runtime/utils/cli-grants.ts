import type { OpenApeAuthorizationDetail, OpenApeCliAuthorizationDetail } from '@openape/core'

export function getCliAuthorizationDetails(details?: OpenApeAuthorizationDetail[]): OpenApeCliAuthorizationDetail[] {
  return (details ?? []).filter((detail): detail is OpenApeCliAuthorizationDetail => detail.type === 'openape_cli')
}

export function formatCliResourceChain(detail: OpenApeCliAuthorizationDetail): string {
  return detail.resource_chain
    .map((resource) => {
      const selector = resource.selector && Object.keys(resource.selector).length > 0
        ? Object.entries(resource.selector).map(([key, value]) => `${key}=${value}`).join(', ')
        : '*'
      return `${resource.resource}[${selector}]`
    })
    .join(' -> ')
}

export function summarizeCliGrant(details?: OpenApeAuthorizationDetail[]): string | null {
  const cliDetails = getCliAuthorizationDetails(details)
  if (cliDetails.length === 0)
    return null

  if (cliDetails.length === 1) {
    return cliDetails[0]!.display
  }

  const first = cliDetails[0]!
  return `${first.cli_id}: ${cliDetails.length} requested operations`
}

export function formatWidenedPreview(details: OpenApeCliAuthorizationDetail[]): string[] {
  return details.map(d => d.permission)
}

export function describeExtension(
  original: OpenApeCliAuthorizationDetail[],
  widened: OpenApeCliAuthorizationDetail[],
): string[] {
  const descriptions: string[] = []
  for (const w of widened) {
    const match = original.find(o => o.cli_id === w.cli_id && o.action === w.action)
    if (match && match.permission !== w.permission) {
      descriptions.push(`${match.permission} → ${w.permission}`)
    }
  }
  return descriptions
}
