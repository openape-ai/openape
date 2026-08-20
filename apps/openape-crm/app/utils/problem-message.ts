/**
 * Die API antwortet im Problem-Format (`server/utils/problem.ts`): Titel und
 * optionales Detail liegen unter `data`. Das hier ist der eine Ort, an dem aus
 * einem geworfenen Fehler ein Satz für den Nutzer wird.
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
