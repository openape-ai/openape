#!/usr/bin/env node
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs'

const STATIC = '.vercel/output/static'
const CONFIG = '.vercel/output/config.json'

if (existsSync('public')) {
  cpSync('public', STATIC, { recursive: true })
  console.log('[post-build] Copied SPA to static/')
}

if (existsSync(CONFIG)) {
  const c = JSON.parse(readFileSync(CONFIG, 'utf8'))
  const idx = c.routes.findIndex(r => r.src === '/(.*)')
  if (idx >= 0) {
    c.routes.splice(idx, 0, { src: '/(login|grant-approval|enroll|register|account|admin|grants)', dest: '/index.html' })
    writeFileSync(CONFIG, JSON.stringify(c, null, 2))
    console.log('[post-build] Added SPA rewrites')
  }
}
