export interface ErrorCopy {
  title: string
  detail: string
}

// A repo you may not read and a repo that does not exist both answer 404, so a
// stranger cannot map the forge by probing URLs. The 404 copy has to keep the
// two indistinguishable — naming access there would undo that.
const BY_STATUS: Record<number, ErrorCopy> = {
  404: { title: 'Not found', detail: 'This page does not exist, or your grants do not cover it.' },
  403: { title: 'Not allowed', detail: 'Your grants do not cover this action.' },
}

const FALLBACK: ErrorCopy = { title: 'Something broke', detail: 'That is on us. Try again in a moment.' }

export function errorCopy(status: number | undefined): ErrorCopy {
  return (status !== undefined && BY_STATUS[status]) || FALLBACK
}
