import type { CodexCredential } from './codex-credential'
import type { ResponsesBody } from './types'

// The Codex Responses backend the ChatGPT subscription answers on (private,
// undocumented — the same endpoint the Codex CLI + OpenClaw use).
export const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'

/**
 * Headers for the Codex Responses request. `chatgpt-account-id` (from the JWT)
 * and `OpenAI-Beta: responses=experimental` are mandatory; a missing account id
 * 403s. `originator` self-identifies the caller (OpenClaw sends its own name).
 */
export function codexResponseHeaders(cred: CodexCredential, originator = 'openape'): Record<string, string> {
  return {
    'authorization': `Bearer ${cred.access_token}`,
    'chatgpt-account-id': cred.account_id,
    'originator': originator,
    'openai-beta': 'responses=experimental',
    'accept': 'text/event-stream',
    'content-type': 'application/json',
  }
}

async function* decodeStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  const reader = stream.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done)
        break
      yield decoder.decode(value, { stream: true })
    }
  }
  finally {
    reader.releaseLock()
  }
}

/** Real `fetchResponses`: POST the Responses body, return its SSE text chunks. */
export async function postCodexResponses(body: ResponsesBody, cred: CodexCredential, originator = 'openape'): Promise<AsyncIterable<string>> {
  const res = await fetch(CODEX_RESPONSES_URL, {
    method: 'POST',
    headers: codexResponseHeaders(cred, originator),
    body: JSON.stringify(body),
  })
  if (!res.ok || !res.body) {
    const text = res.body ? await res.text().catch(() => '') : ''
    throw new Error(`codex responses HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`)
  }
  return decodeStream(res.body)
}
