import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const repository = JSON.parse(readFileSync(new URL('../.openape/repository.json', import.meta.url), 'utf8'))

/** Compare the entire repository identity, never just a hostname substring. */
export function repositoryIdentity(input) {
  const scp = input.match(/^(?:[^/@]+@)?([^/:]+):([^/].*)$/)
  try {
    const url = new URL(scp ? `ssh://${scp[1]}/${scp[2]}` : input)
    if (!['https:', 'ssh:'].includes(url.protocol) || url.search || url.hash || url.password) return null
    if (url.port) return null
    return `${url.hostname}${url.pathname.replace(/\/$/, '').replace(/\.git$/, '')}`
  }
  catch {
    return null
  }
}

export function resolveTruthRemote(remotes, config = repository) {
  const expected = repositoryIdentity(config.url)
  if (!expected) throw new Error('Invalid canonical repository URL in .openape/repository.json')
  const matches = Object.entries(remotes).filter(([, url]) => repositoryIdentity(url) === expected).map(([name]) => name)
  if (matches.includes('origin')) return 'origin'
  if (matches.length === 1) return matches[0]
  throw new Error(matches.length
    ? `Ambiguous canonical remotes: ${matches.join(', ')}. Use origin for ${config.url}.`
    : `No remote points at ${config.url}. Check git remote -v; do not use a mirror as the base.`)
}

export function gitRemotes(cwd = process.cwd()) {
  const names = execFileSync('git', ['remote'], { cwd, encoding: 'utf8' }).trim().split('\n').filter(Boolean)
  return Object.fromEntries(names.map(name => [name, execFileSync('git', ['remote', 'get-url', name], { cwd, encoding: 'utf8' }).trim()]))
}

export function assertPushTarget(url, config = repository) {
  if (repositoryIdentity(url) !== repositoryIdentity(config.url)) {
    throw new Error(`Push rejected: development pushes belong on ${config.url}. Mirrors are populated by the forge.`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === 'check-push') {
      assertPushTarget(process.argv[3] || '')
    }
    else {
      const remote = resolveTruthRemote(gitRemotes())
      console.log(JSON.stringify({ ...repository, remote, baseRef: `${remote}/${repository.defaultBranch}` }, null, 2))
    }
  }
  catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
