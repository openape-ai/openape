import type { OpenApeGrantWithdrawResult } from '@openape/core'
import { parseGrantWithdrawResult } from '@openape/grants'
import { readJSON } from '../connections/http'

interface WithdrawConnection { issuer: string, accessToken: () => Promise<string> }

/**
 * Withdraws the Pod identity's own referenced request at its IdP (issue 1536).
 * A brokered identity's agent provider forwards it to the decision IdP.
 */
export async function withdrawGrantRequest(connection: WithdrawConnection, body: { reference: string, reason?: string }, signal: AbortSignal): Promise<OpenApeGrantWithdrawResult> {
  const response = await fetch(`${connection.issuer}/api/grants/withdraw`, { method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${await connection.accessToken()}` }, body: JSON.stringify(body) })
  if (response.status === 404 || response.status === 405) throw new Error('The identity provider does not support withdrawing grant requests yet')
  if (response.status === 501) throw new Error('The deciding identity provider does not support withdrawing grant requests yet')
  return parseGrantWithdrawResult(await readJSON(response, 4096))
}
