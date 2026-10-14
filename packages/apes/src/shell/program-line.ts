import { parse } from 'shell-quote'

/**
 * Bash builtins and keywords: bash runs these itself, so no program file proves what runs.
 */
const BASH_BUILTINS = new Set([
  '.', ':', '[', '[[', '!', '{', '}', 'alias', 'bg', 'bind', 'break', 'builtin', 'caller', 'case', 'cd', 'command',
  'compgen', 'complete', 'compopt', 'continue', 'coproc', 'declare', 'dirs', 'disown', 'do', 'done', 'echo', 'elif',
  'else', 'enable', 'esac', 'eval', 'exec', 'exit', 'export', 'false', 'fc', 'fg', 'fi', 'for', 'function', 'getopts',
  'hash', 'help', 'history', 'if', 'in', 'jobs', 'kill', 'let', 'local', 'logout', 'mapfile', 'popd', 'printf',
  'pushd', 'pwd', 'read', 'readarray', 'readonly', 'return', 'select', 'set', 'shift', 'shopt', 'source', 'suspend',
  'test', 'then', 'time', 'times', 'trap', 'true', 'type', 'typeset', 'ulimit', 'umask', 'unalias', 'unset', 'until',
  'wait', 'while',
])

/**
 * Characters after which bash may run something other than the literal words: expansions, globs, escapes, history,
 * comments and line breaks. Lines containing them stay on the shell session path.
 */
const SHELL_SYNTAX = /[\n\r$`~{}*?[\]\\!#]/

export interface ProgramLine {
  executable: string
  argv: string[]
}

/**
 * The program call a shell line is, when bash would run exactly these words: one command of plain words, no
 * operators, redirections, expansions or variable assignments, and not a builtin. Anything else returns null.
 */
export function programLine(line: string): ProgramLine | null {
  if (SHELL_SYNTAX.test(line)) return null
  let tokens: ReturnType<typeof parse>
  try {
    tokens = parse(line)
  }
  catch {
    return null
  }
  const words: string[] = []
  for (const token of tokens) {
    if (typeof token !== 'string') return null
    words.push(token)
  }
  const [executable, ...argv] = words
  if (!executable || executable.includes('=') || BASH_BUILTINS.has(executable)) return null
  return { executable, argv }
}

function singleQuoted(word: string): string {
  return `'${word.replaceAll('\'', '\'\\\'\'')}'`
}

/**
 * The line the interactive bash runs for an authorized program call: the located file by its absolute path with
 * exactly the authorized arguments, each single-quoted, through `command` so that aliases and functions of the same
 * name cannot run instead. Bash never parses the typed line for such a call.
 */
export function programCommandLine(path: string, argv: string[]): string {
  return ['\\builtin command --', ...[path, ...argv].map(singleQuoted)].join(' ')
}
