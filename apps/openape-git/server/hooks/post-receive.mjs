#!/usr/bin/env node
// ape-git post-receive hook — the webhook firing point (plan M5).
//
// Deliberately dumb: it reports the ref updates plus the authenticated pusher
// to the app over loopback and exits. Signing, subscriber lookup and the
// delivery log live in the app, which owns the database. The internal token is
// minted per app process and handed down through the CGI env, so only a
// receive-pack this very process spawned can post an event.
//
// Standalone plain-JS on purpose: installed into <gitDataDir>/hooks at boot
// and executed by git, outside the Nuxt bundle.

import { readFileSync } from 'node:fs'
import process from 'node:process'

/** Parse the ref lines git feeds a receive hook on stdin. */
export function parseRefUpdates(stdin) {
  const updates = []
  for (const line of stdin.split('\n')) {
    const [before, after, ref] = line.split(' ')
    if (before && after && ref) updates.push({ before, after, ref: ref.trim() })
  }
  return updates
}

async function main() {
  const url = process.env.APE_GIT_EVENT_URL
  const token = process.env.APE_GIT_INTERNAL_TOKEN
  if (!url || !token) return

  const updates = parseRefUpdates(readFileSync(0, 'utf8'))
  if (updates.length === 0) return

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ape-internal-token': token },
    body: JSON.stringify({
      owner: process.env.APE_GIT_REPO_OWNER,
      name: process.env.APE_GIT_REPO_NAME,
      updates,
      pusher: {
        email: process.env.APE_GIT_AUTH_EMAIL,
        act: process.env.APE_GIT_AUTH_ACT,
        delegator: process.env.APE_GIT_DELEGATOR || undefined,
      },
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    // Visible to the pusher, but never fails the push: the objects are in.
    process.stderr.write(`ape-git: webhook dispatch returned HTTP ${response.status}\n`)
  }
}

if (process.argv[1] && process.argv[1].endsWith('post-receive')) {
  main().catch((err) => {
    process.stderr.write(`ape-git: webhook dispatch failed - ${err.message}\n`)
  })
}
