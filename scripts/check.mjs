#!/usr/bin/env node
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync, createWriteStream } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { gitRemotes, repository, resolveTruthRemote } from './repository.mjs'

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const contract = JSON.parse(readFileSync(join(root, '.openape/checks.json'), 'utf8'))
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()

export function workspaces() {
  return JSON.parse(execFileSync('pnpm', ['list', '-r', '--depth=-1', '--json'], { cwd: root, encoding: 'utf8' }))
    .filter(p => resolve(p.path) !== root)
    .map((p) => {
      const data = JSON.parse(readFileSync(join(p.path, 'package.json'), 'utf8'))
      return { ...data, path: relative(root, p.path), scripts: data.scripts ?? {}, deps: { ...data.dependencies, ...data.devDependencies, ...data.peerDependencies } }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function affectedWorkspaces(packages, files) {
  // Root-level tooling/configuration affects the entire workspace contract.
  if (files.some(f => !packages.some(p => f.startsWith(`${p.path}/`)))) return packages
  const selected = new Set(packages.filter(p => files.some(f => f.startsWith(`${p.path}/`))).map(p => p.name))
  let changed = true
  while (changed) {
    changed = false
    for (const p of packages) {
      if (!selected.has(p.name) && Object.keys(p.deps).some(d => selected.has(d))) {
        selected.add(p.name); changed = true
      }
    }
  }
  return packages.filter(p => selected.has(p.name))
}

export function validateScripts(packages, policy = contract) {
  for (const p of packages) {
    for (const task of ['lint', 'typecheck', 'test']) {
      if (!p.scripts[task] && !policy.unitExceptions[`${p.name}:${task}`]) throw new Error(`Missing required script ${p.name}:${task}. Add a real check or an explicitly reviewed exception in .openape/checks.json.`)
    }
  }
  for (const [suite, task] of [['e2e', 'test:e2e'], ['layout', 'test:layout']]) {
    for (const name of policy[suite]) {
      if (!packages.find(p => p.name === name)?.scripts[task]) throw new Error(`Missing required script ${name}:${task}`)
    }
  }
}

export function checkCommands(packages, selected, suites, policy = contract) {
  const steps = []
  if (selected.length === 0) return steps
  steps.push({ name: 'prebuild', command: 'pnpm', args: ['turbo', 'run', 'build', '--filter=./packages/*', '--filter=./modules/*', ...policy.consumedApps.map(n => `--filter=${n}`), '--concurrency=1'] })
  if (suites.includes('unit')) {
    steps.push({ name: 'audit', command: 'pnpm', args: ['audit', '--prod', '--audit-level=high'] })
    steps.push({ name: 'tooling', command: 'node', args: ['--test', ...readdirSync(join(root, 'scripts')).filter(n => n.endsWith('.test.mjs')).sort().map(n => `scripts/${n}`)] })
    for (const task of ['lint', 'typecheck', 'test']) {
      const targets = selected.filter(p => p.scripts[task] && !policy.unitExceptions[`${p.name}:${task}`])
      if (targets.length) steps.push({ name: task, command: 'pnpm', args: ['turbo', 'run', task, ...targets.map(p => `--filter=${p.name}`), '--concurrency=4'] })
    }
  }
  for (const [suite, task] of [['e2e', 'test:e2e'], ['layout', 'test:layout']]) {
    if (!suites.includes(suite)) continue
    for (const name of policy[suite].filter(n => selected.some(p => p.name === n))) {
      // Single-package invocation fails if the script disappears; no silent skip.
      steps.push({ name: `${suite}-${name.replaceAll(/[^a-z0-9]/gi, '-')}`, command: 'pnpm', args: ['--filter', name, task], ...(suite === 'e2e' ? { report: `${name.replaceAll(/[^a-z0-9]/gi, '-')}.json` } : {}) })
    }
  }
  return steps
}

async function runStep(step, logPath) {
  const stream = createWriteStream(logPath)
  const code = await new Promise((resolveCode, reject) => {
    const runArgs = [...step.args, ...(step.report ? ['--reporter=default', '--reporter=json', `--outputFile.json=${join(dirname(logPath), step.report)}`] : [])]
    const child = spawn(step.command, runArgs, { cwd: root, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] })
    const output = (chunk) => { stream.write(chunk); process.stdout.write(chunk) }
    child.stdout.on('data', output); child.stderr.on('data', output)
    child.on('error', reject)
    child.on('close', code => resolveCode(code ?? 1))
  }).finally(() => stream.end())
  return code
}

async function main() {
  const args = process.argv.slice(2)
  const mode = args.shift()
  if (!['affected', 'ci'].includes(mode)) throw new Error('Usage: node scripts/check.mjs affected|ci [--base REF --head REF] [--suite unit|e2e|layout] [--dry-run]')
  const value = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined
  const suite = value('--suite')
  if (suite && !['unit', 'e2e', 'layout'].includes(suite)) throw new Error('Unknown suite')
  const suites = suite ? [suite] : ['unit', 'e2e', 'layout']
  const head = git(['rev-parse', '--verify', `${value('--head') || 'HEAD'}^{commit}`])
  if (head !== git(['rev-parse', 'HEAD'])) throw new Error('Check out the requested head before running checks.')
  const dirty = Boolean(git(['status', '--porcelain']))
  let base = null
  const packages = workspaces()
  validateScripts(packages)
  let selected = packages
  if (mode === 'affected') {
    const candidate = value('--base') || `${resolveTruthRemote(gitRemotes(root))}/${repository.defaultBranch}`
    base = git(['rev-parse', '--verify', `${candidate}^{commit}`])
    if (base === head) base = git(['rev-parse', '--verify', `${head}^`])
    const files = new Set(git(['diff', '--name-only', base, head]).split('\n').filter(Boolean))
    for (const f of git(['diff', '--name-only', head]).split('\n').filter(Boolean)) files.add(f)
    for (const f of git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean)) files.add(f)
    selected = affectedWorkspaces(packages, [...files])
  }
  const steps = checkCommands(packages, selected, suites)
  const summary = { contract: contract.version, mode, suites, base, head, dirty, workspaces: selected.map(p => p.name), exceptions: contract.unitExceptions, steps, results: [], status: 'pending' }
  if (args.includes('--dry-run')) { console.log(JSON.stringify(summary, null, 2)); return }
  const logs = join(root, '.openape/check-results', `${Date.now()}-${head.slice(0, 8)}-${suite || 'all'}`)
  mkdirSync(logs, { recursive: true })
  const save = () => writeFileSync(join(logs, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  save()
  console.log(`[check] ${mode} ${suites.join(', ')}: ${selected.length} workspaces; ${base || 'full'} → ${head}; logs: ${logs}`)
  for (const step of steps) {
    console.log(`[check] ${step.name}`)
    const start = Date.now()
    const log = join(logs, `${step.name}.log`)
    let code
    try { code = await runStep(step, log) }
    catch (error) { code = 1; writeFileSync(log, `${error.message}\n`) }
    summary.results.push({ name: step.name, code, durationMs: Date.now() - start, log })
    if (code) { summary.status = 'failure'; save(); process.exitCode = 1; console.error(`[check] FAILED ${step.name}; ${log}`); return }
    save()
  }
  summary.status = 'success'; save()
  console.log(`[check] SUCCESS; ${join(logs, 'summary.json')}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`[check] ${error.message}`); process.exitCode = 1 })
}
