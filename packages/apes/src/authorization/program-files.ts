import { createHash } from 'node:crypto'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { createRequire, isBuiltin } from 'node:module'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ProgramCall } from './program.js'

export interface ProgramFile { path: string, sha256: string }

function bindFile(path: string): ProgramFile {
  const absolute = resolve(path)
  if (!statSync(absolute).isFile()) throw new Error(`Program input is not a regular file: ${absolute}`)
  return { path: absolute, sha256: createHash('sha256').update(readFileSync(absolute)).digest('hex') }
}

export function nodeProgramFiles(call: ProgramCall, context: { cwd: string, env: NodeJS.ProcessEnv } = { cwd: process.cwd(), env: process.env }): ProgramFile[] {
  if (![call.program.name, basename(realpathSync(call.program.path))].some(name => /^(?:node|nodejs)(?:\.exe)?$/.test(name))) return []
  if (context.env.NODE_OPTIONS) throw new Error('NODE_OPTIONS must be expressed as explicit authorized arguments')
  const files: ProgramFile[] = []
  const require = createRequire(resolve(context.cwd, '__ape_shell_resolution__.cjs'))
  const args = call.argv
  let inlineCode = false
  let scriptFile = false
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!
    if (argument === '--') {
      if (inlineCode) break
      const script = args[index + 1]
      if (script && script !== '-') { files.push(bindFile(resolve(context.cwd, script))); scriptFile = true }
      else {
        throw new Error('Node stdin execution needs an explicit code argument')
      }
      break
    }
    if (['-e', '--eval', '-p', '--print'].includes(argument)) {
      if (args[++index] === undefined) throw new Error(`Missing code for ${argument}`)
      inlineCode = true
      continue
    }
    if (/^--(?:eval|print)=/.test(argument)) { inlineCode = true; continue }
    if (argument === '-') throw new Error('Node stdin execution needs an explicit code argument')
    if (!argument.startsWith('-')) {
      if (!inlineCode) { files.push(bindFile(resolve(context.cwd, argument))); scriptFile = true }
      break
    }
    const [option, inline] = argument.split(/=(.*)/s)
    if (['-r', '--require', '--import', '--loader', '--experimental-loader'].includes(option!)) {
      const value = inline ?? args[++index]
      if (!value) throw new Error(`Missing value for ${option}`)
      if (isBuiltin(value)) continue
      const path = value.startsWith('file:') ? fileURLToPath(value) : require.resolve(value)
      files.push(bindFile(path))
      continue
    }
    if (option === '--input-type') { if (inline === undefined) index++; continue }
    if (['--version', '-v', '--help', '-h'].includes(argument)) return []
    if (inline !== undefined && ['--max-old-space-size', '--max-semi-space-size', '--stack-size'].includes(option!)) continue
    if (['--no-warnings', '--enable-source-maps', '--use-strict', '--use-env-proxy', '--check', '-c'].includes(argument)) continue
    throw new Error(`Node option ${argument} needs an explicit execution binding before it can run`)
  }
  if (!inlineCode && !scriptFile) throw new Error('Node stdin execution needs an explicit code argument')
  return [...new Map(files.map(file => [file.path, file])).values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
}

export function assertProgramFiles(files: ProgramFile[] = []): void {
  for (const file of files) {
    if (bindFile(file.path).sha256 !== file.sha256) throw new Error(`${file.path} changed after authorization; nothing was executed`)
  }
}

/** Bind script files of other supported interpreters; inline code remains part of exact argv. */
export function interpreterProgramFiles(call: ProgramCall, context: { cwd: string, env: NodeJS.ProcessEnv } = { cwd: process.cwd(), env: process.env }): ProgramFile[] {
  const names = [call.program.name, basename(realpathSync(call.program.path))]
  if (names.some(name => /^(?:node|nodejs)(?:\.exe)?$/.test(name))) return nodeProgramFiles(call, context)
  const python = names.some(name => /^python(?:[23](?:\.\d+)?)?(?:\.exe)?$/.test(name))
  const shell = names.some(name => /^(?:sh|bash|dash|zsh|ksh)$/.test(name))
  if (!python && !shell) return []
  const files: ProgramFile[] = []
  if (shell) {
    for (const key of ['BASH_ENV', 'ENV']) {
      if (context.env[key]) files.push(bindFile(resolve(context.cwd, context.env[key]!)))
    }
  }
  for (let index = 0; index < call.argv.length; index++) {
    const argument = call.argv[index]!
    if (argument === '-c' || (shell && /^-[eux]+c$/.test(argument))) {
      if (call.argv[index + 1] === undefined) throw new Error('Interpreter code argument is missing')
      return files
    }
    if (argument === '--version' || argument === '--help' || (python && argument === '-V')) return files
    if (argument === '--') {
      const path = call.argv[++index]
      if (!path || path === '-') throw new Error('Interpreter stdin needs an explicit code argument')
      return [...files, bindFile(resolve(context.cwd, path))]
    }
    if (!argument.startsWith('-')) return [...files, bindFile(resolve(context.cwd, argument))]
    if ((python && /^-[IESsBu]+$/.test(argument)) || (shell && /^-[eux]+$/.test(argument))) continue
    throw new Error(`Interpreter option ${argument} needs an explicit execution binding before it can run`)
  }
  throw new Error('Interpreter stdin needs an explicit code argument')
}
