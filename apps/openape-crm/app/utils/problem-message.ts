/**
 * Die API antwortet im Problem-Format (`server/utils/problem.ts`): Titel und
 * optional detail sit under `data`. This is the one place where a thrown
 * error becomes a sentence for the user.
 */
export interface ProblemMessage {
  title: string
  detail?: string
}

interface FetchLikeError {
  data?: { title?: string, detail?: string, statusMessage?: string }
  statusMessage?: string
  message?: string
}

export function problemMessage(error: unknown, fallback = 'Das hat nicht geklappt'): ProblemMessage {
  const err = error as FetchLikeError | null
  const title = err?.data?.title ?? err?.data?.statusMessage ?? err?.statusMessage ?? err?.message
  return {
    title: title?.trim() ? title : fallback,
    detail: err?.data?.detail,
  }
}
