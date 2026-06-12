#!/usr/bin/env node
// Tested-image deploy for a static site (same pattern as the OpenApe web
// apps): package the dist dir into an amd64 Caddy image, smoke-test it,
// push to registry.openape.ai, then chatty pulls + restarts the container
// with a health gate and tag rollback.
//
//   node scripts/deploy-image.mjs
//
// Prereqs: `docker login registry.openape.ai` and SSH access as openape.

import { execFileSync } from 'node:child_process'
import process from 'node:process'

const SITE = {
  /** Directory to serve (build context of compose/site.Dockerfile). */
  dist: 'apps/docs/.output/public',
  /** Command to (re)build `dist`, or null for plain checked-in files. */
  build: ['pnpm', 'turbo', 'run', 'build', '--filter', 'docs'],
  image: 'site-docs',
  compose: 'web',
  domain: 'docs.openape.ai',
  envVar: 'DOCS_TAG',
  prodDir: '/home/openape/prod-site-docs',
}

const REGISTRY = 'registry.openape.ai'
const HOST = process.env.CHATTY_HOST || 'chatty.delta-mind.at'
const USER = process.env.CHATTY_USER || 'openape'

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: 'inherit', ...opts })
}
function out(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8' }).trim()
}
function ssh(script) {
  return execFileSync('ssh', ['-o', 'ConnectTimeout=15', '-o', 'BatchMode=yes', `${USER}@${HOST}`, 'bash', '-s'], {
    input: script,
    encoding: 'utf8',
  }).trim()
}
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function smokeTest(tag) {
  const name = `smoke-${SITE.image}`
  try { execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' }) }
  catch {}
  sh('docker', ['run', '-d', '--name', name, '--platform', 'linux/amd64', '-p', '127.0.0.1:18080:80', tag])
  try {
    for (let i = 0; i < 15; i++) {
      try {
        const res = await fetch('http://127.0.0.1:18080/')
        if (res.ok) return
      }
      catch {}
      await sleep(1000)
    }
    throw new Error('smoke test failed: / never returned 200 on :18080')
  }
  finally {
    try { execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' }) }
    catch {}
  }
}

async function externalHealth() {
  for (let i = 0; i < 15; i++) {
    try {
      const res = await fetch(`https://${SITE.domain}/`, { signal: AbortSignal.timeout(8000) })
      if (res.ok) return true
    }
    catch {}
    await sleep(2000)
  }
  return false
}

const sha = out('git', ['rev-parse', '--short', 'HEAD'])
const tag = `${REGISTRY}/${SITE.image}:prod-${sha}`
console.log(`━━━ ${SITE.image} → ${tag}`)

if (SITE.build) {
  console.log(`→ build: ${SITE.build.join(' ')}`)
  sh(SITE.build[0], SITE.build.slice(1))
}
console.log('→ package (amd64)')
sh('docker', ['buildx', 'build', '--platform', 'linux/amd64', '-f', 'compose/site.Dockerfile', '-t', tag, '--load', SITE.dist])
console.log('→ smoke test')
await smokeTest(tag)
console.log('→ push')
sh('docker', ['push', tag])

console.log('→ chatty: sync compose, pin tag, pull + up')
ssh(`mkdir -p ${SITE.prodDir}`)
sh('scp', ['-q', 'compose/docs-site.yml', `${USER}@${HOST}:${SITE.prodDir}/docker-compose.yml`])
const prev = ssh(`
  set -euo pipefail
  cd ${SITE.prodDir}
  touch .env
  OLD=$(grep -E '^${SITE.envVar}=' .env | cut -d= -f2- || true)
  grep -vE '^${SITE.envVar}(_PREV)?=' .env > .env.new || true
  if [ -n "$OLD" ]; then echo "${SITE.envVar}_PREV=$OLD" >> .env.new; fi
  echo "${SITE.envVar}=prod-${sha}" >> .env.new
  mv .env.new .env
  docker compose --env-file .env -f docker-compose.yml pull -q ${SITE.compose}
  docker compose --env-file .env -f docker-compose.yml up -d ${SITE.compose}
  echo "$OLD"
`)

console.log(`→ health gate https://${SITE.domain}/`)
if (await externalHealth()) {
  console.log(`✓ deployed (prod-${sha}${prev ? `, prev ${prev}` : ''})`)
}
else {
  console.error('✗ health gate failed — rolling back')
  if (prev) {
    ssh(`
      set -euo pipefail
      cd ${SITE.prodDir}
      grep -vE '^${SITE.envVar}=' .env > .env.new || true
      echo "${SITE.envVar}=${prev}" >> .env.new
      mv .env.new .env
      docker compose --env-file .env -f docker-compose.yml up -d ${SITE.compose}
    `)
    console.error(`→ rolled back to ${prev}`)
  }
  process.exit(1)
}
