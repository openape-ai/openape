// Sentry v11 collects cookies, HTTP bodies and user info by default. An IdP
// handles passwords, passkeys and tokens, so keep the restrictive v10 baseline.
// 'referer' carries the page URL, e.g. /recover?token=…; header values are not scrubbed.
const scrubbed = { deny: ['forwarded', '-ip', 'remote-', 'via', '-user', 'referer'] }

export const dataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: scrubbed, response: scrubbed },
  httpBodies: [],
  urlQueryParams: scrubbed,
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  graphQL: { document: false, variables: false },
}
