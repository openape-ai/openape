#!/usr/bin/env node
// Fetch the authenticated account's Bluesky home timeline and print the
// recent posts as JSON on stdout. The LLM does the summarising — this
// tool only fetches.
//
// Credentials come from the environment (BLUESKY_HANDLE +
// BLUESKY_APP_PASSWORD). The agent's runtime materialised them from a
// sealed blob (Agent Recipe M2e); this script never logs them. AT-Proto
// is stateful (createSession → short-lived JWT) so we log in per run.
//
// Exit codes: 0 ok · 2 missing creds · 3 auth failed · 4 fetch failed.

const PDS = process.env.BLUESKY_PDS || 'https://bsky.social'

function fail(code, msg) {
  process.stderr.write(`${msg}\n`)
  process.exit(code)
}

const handle = process.env.BLUESKY_HANDLE
const appPassword = process.env.BLUESKY_APP_PASSWORD
if (!handle || !appPassword) {
  fail(2, 'BLUESKY_HANDLE / BLUESKY_APP_PASSWORD not set — secret not bound or revoked')
}

async function main() {
  let session
  try {
    const res = await fetch(`${PDS}/xrpc/com.atproto.server.createSession`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: handle, password: appPassword }),
    })
    if (!res.ok) fail(3, `createSession failed (HTTP ${res.status}) — credential likely revoked`)
    session = await res.json()
  }
  catch (e) {
    fail(3, `createSession error: ${e.message}`)
  }

  let feed
  try {
    const res = await fetch(
      `${PDS}/xrpc/app.bsky.feed.getTimeline?limit=50`,
      { headers: { Authorization: `Bearer ${session.accessJwt}` } },
    )
    if (!res.ok) fail(4, `getTimeline failed (HTTP ${res.status})`)
    feed = await res.json()
  }
  catch (e) {
    fail(4, `getTimeline error: ${e.message}`)
  }

  const posts = (feed.feed ?? []).map((item) => ({
    author: item.post?.author?.handle,
    text: item.post?.record?.text,
    likes: item.post?.likeCount ?? 0,
    reposts: item.post?.repostCount ?? 0,
    at: item.post?.indexedAt,
  }))
  process.stdout.write(JSON.stringify({ count: posts.length, posts }, null, 2))
}

main()
