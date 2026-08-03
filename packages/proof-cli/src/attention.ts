/**
 * Attention events from the CLI side (plan 01KZ3QPW5EC0JRXN5TB60R54TQ).
 *
 * Emission belongs here, not in the proof-link apps: bearer tokens are
 * audience-scoped, so a token minted for pr.openape.ai is worthless at
 * troop.openape.ai (the app-side attempt got a 401 on every upload). The CLI
 * holds the apes identity and can exchange a token per audience, so it is the
 * only place that can write to both. It also keeps the apps independent —
 * pr.openape.ai never needs to know troop exists.
 */
import { randomBytes } from 'node:crypto'
import { createSpClient } from '@openape/cli-auth'

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** ULID: 10 time chars (unix ms) + 16 chars of randomness, Crockford base32. */
export function ulid(nowMs = Date.now()): string {
  let time = ''
  for (let i = 0, t = nowMs; i < 10; i++, t = Math.floor(t / 32)) {
    time = CROCKFORD[t % 32] + time
  }
  let rand = ''
  for (let bits = BigInt(`0x${randomBytes(10).toString('hex')}`), i = 0; i < 16; i++, bits >>= 5n) {
    rand = CROCKFORD[Number(bits & 31n)] + rand
  }
  return time + rand
}

export interface AttentionActor {
  /** DDISA subject of whoever runs the CLI. */
  actor: string
  actorKind: 'human' | 'agent'
  /** Opaque work reference ("ape-tasks:<id>"); groups a task's whole chain. */
  taskRef: string
}

/** The pair a finished PR upload raises: a verdict card and its proof. */
export function verdictRequestedEvents(who: AttentionActor, prUrl: string, nowSeconds: number) {
  const envelope = { ts: nowSeconds, actor: who.actor, actor_kind: who.actorKind, task_ref: who.taskRef }
  return [
    { id: ulid(), ...envelope, type: 'verdict.requested', payload: { pr_url: prUrl } },
    { id: ulid(), ...envelope, type: 'proof.attached', payload: { url: prUrl, kind: 'pr' } },
  ]
}

const troopClient = createSpClient({
  defaultEndpoint: 'https://troop.openape.ai',
  envVar: 'OPENAPE_TROOP_URL',
  configFile: 'auth-troop-attention.json',
  defaultAud: 'troop.openape.ai',
})

/**
 * Post events to troop's inbox. Best-effort by design: a troop outage must
 * never fail the command the user actually ran, so failures warn and return
 * the count that got through.
 */
export async function emitAttentionEvents(
  events: Array<Record<string, unknown>>,
  onWarn: (message: string) => void = () => {},
): Promise<number> {
  let accepted = 0
  for (const body of events) {
    try {
      await troopClient._request('/api/events', { method: 'POST', body })
      accepted++
    }
    catch (err) {
      onWarn(`attention: could not reach troop — ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return accepted
}
