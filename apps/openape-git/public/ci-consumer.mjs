#!/usr/bin/env node
// ape-git reference CI consumer (plan M5).
//
// The forge itself runs no CI: it posts a signed push event and takes a status
// back. This is the smallest honest consumer of that contract — verify the
// signature, fetch the pushed tree, run the repo's `.ape-ci.sh`, report the
// result plus the log. Zero dependencies, so anyone can copy it: it ships
// inside the app image and is downloadable at /ci-consumer.mjs.
//
//   APE_CI_SECRETS='{"owner/repo":"<webhook secret>"}'   (required)
//   APE_CI_FORGE=https://repos.openape.ai                 (API base)
//   APE_CI_PUBLIC_BASE=https://repos.openape.ai           (links, default = FORGE)
//   APE_CI_PORT=8080
//   APE_CI_TIMEOUT_SEC=600
//
// ponytail: one run at a time per event, no queue, no retries, no sandbox
// beyond this container. CI scripts are untrusted code — isolate per run when
// this serves repos that don't trust each other.

import { spawn } from 'node:child_process'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const SECRETS = JSON.parse(process.env.APE_CI_SECRETS || '{}')
const FORGE = (process.env.APE_CI_FORGE || 'https://repos.openape.ai').replace(/\/$/, '')
const PUBLIC_BASE = (process.env.APE_CI_PUBLIC_BASE || FORGE).replace(/\/$/, '')
const PORT = Number(process.env.APE_CI_PORT || 8080)
const TIMEOUT_MS = Number(process.env.APE_CI_TIMEOUT_SEC || 600) * 1000
const CONTEXT = 'ape-ci'
const MAX_LOG_BYTES = 64 * 1024
const CI_SCRIPT = '.ape-ci.sh'

function sign(payload, secret) {
  return `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`
}

function verify(payload, secret, signature) {
  if (!signature) return false
  const expected = Buffer.from(sign(payload, secret))
  const given = Buffer.from(signature)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

function log(...args) {
  console.log(new Date().toISOString(), ...args)
}

async function postStatus(repo, sha, secret, body) {
  const payload = JSON.stringify({ context: CONTEXT, ...body })
  const response = await fetch(`${FORGE}/api/repos/${repo}/statuses/${sha}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ape-signature-256': sign(payload, secret) },
    body: payload,
  })
  if (!response.ok) log(`status POST failed: HTTP ${response.status}`)
}

/** Fetch and unpack the pushed tree — signed GET, no git credential needed. */
async function fetchTree(repo, sha, secret, dir) {
  const ts = String(Math.floor(Date.now() / 1000))
  const response = await fetch(`${FORGE}/api/repos/${repo}/archive?sha=${sha}`, {
    headers: {
      'x-ape-timestamp': ts,
      'x-ape-signature-256': sign(`${repo}\n${sha}\n${ts}`, secret),
    },
  })
  if (!response.ok) throw new Error(`archive fetch failed: HTTP ${response.status}`)
  const tarball = join(dir, 'tree.tar.gz')
  await writeFile(tarball, Buffer.from(await response.arrayBuffer()))
  await run('tar', ['-xzf', tarball, '-C', dir], dir)
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, CI: 'true' } })
    let output = ''
    const collect = (chunk) => {
      output = (output + chunk).slice(-MAX_LOG_BYTES)
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS)
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(output)
      else reject(Object.assign(new Error(`exit ${code}`), { output }))
    })
  })
}

async function runCi(payload, secret) {
  const { repo, after: sha } = payload
  const dir = await mkdtemp(join(tmpdir(), 'ape-ci-'))
  const targetUrl = `${PUBLIC_BASE}/repos/${repo}/checks/${sha}`
  try {
    await fetchTree(repo, sha, secret, dir)
    if (!existsSync(join(dir, CI_SCRIPT))) {
      log(`${repo}@${sha.slice(0, 7)}: no ${CI_SCRIPT}, nothing to run`)
      return
    }

    await postStatus(repo, sha, secret, { state: 'pending', description: `running ${CI_SCRIPT}`, targetUrl })
    log(`${repo}@${sha.slice(0, 7)}: running ${CI_SCRIPT}`)
    const output = await run('bash', [CI_SCRIPT], dir)
    await postStatus(repo, sha, secret, { state: 'success', description: 'ci passed', targetUrl, log: output })
    log(`${repo}@${sha.slice(0, 7)}: success`)
  }
  catch (err) {
    await postStatus(repo, sha, secret, {
      state: 'failure',
      description: err.message.slice(0, 200),
      targetUrl,
      log: err.output ?? err.message,
    })
    log(`${repo}@${sha.slice(0, 7)}: failure - ${err.message}`)
  }
  finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

createServer(async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"status":"ok"}')
    return
  }
  if (req.method !== 'POST' || req.url !== '/hook') {
    res.writeHead(404).end('not found\n')
    return
  }

  const raw = await readBody(req)
  let payload
  try {
    payload = JSON.parse(raw)
  }
  catch {
    res.writeHead(400).end('invalid json\n')
    return
  }

  const secret = SECRETS[payload.repo]
  if (!secret) {
    log(`rejected: no secret configured for ${payload.repo}`)
    res.writeHead(404).end('unknown repo\n')
    return
  }
  if (!verify(raw, secret, req.headers['x-ape-signature-256'])) {
    log(`REJECTED: bad signature for ${payload.repo} (delivery ${req.headers['x-ape-delivery']})`)
    res.writeHead(401).end('invalid signature\n')
    return
  }

  log(`accepted ${payload.event} ${payload.repo} ${payload.ref} -> ${payload.after?.slice(0, 7)} (delivery ${req.headers['x-ape-delivery']})`)
  res.writeHead(202).end('accepted\n')

  // Deliveries are acknowledged before the run: the forge should not wait for CI.
  if (payload.event === 'push' && !/^0+$/.test(payload.after ?? '')) {
    runCi(payload, secret).catch(err => log(`run failed: ${err.message}`))
  }
}).listen(PORT, () => log(`ape-ci consumer listening on :${PORT} for ${Object.keys(SECRETS).join(', ') || '(no repos configured)'}`))
