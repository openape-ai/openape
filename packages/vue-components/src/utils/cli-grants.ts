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
