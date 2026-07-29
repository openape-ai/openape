// Shell-segment analysis shared by grant-policy evaluation (IdP YOLO hook)
// and — as of the shapes track (plan 2026-07-29-compound-shapes-grants) —
// compound-command resolution in ape-shell. Battle-tested logic from the
// #1079 hardening; behavior changes here are security-relevant on both
// consumers, so every edit needs the test suite in __tests__/shell-segments.

/**
 * Split a command line at the shell control operators (`&&`, `||`, `;`, `|`,
 * `&`, newlines) into trimmed, non-empty segments. Operators inside single
 * or double quotes are literal text, not separators; a backslash escapes the
 * next character (except inside single quotes) so `\"` never toggles quote
 * state. Why: allow/deny patterns describe COMMANDS, not line prefixes —
 * every chained command must be judged on its own (#1079).
 */
export function splitCommandSegments(target: string): string[] {
  const segments: string[] = []
  let current = ''
  let quote: '\'' | '"' | null = null
  let escaped = false
  for (const ch of target) {
    if (escaped) {
      current += ch
      escaped = false
      continue
    }
    if (ch === '\\' && quote !== '\'') {
      current += ch
      escaped = true
      continue
    }
    if (quote) {
      current += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === '\'' || ch === '"') {
      current += ch
      quote = ch
      continue
    }
    if (ch === '&' || ch === '|' || ch === ';' || ch === '\n' || ch === '\r') {
      segments.push(current)
      current = ''
      continue
    }
    current += ch
  }
  segments.push(current)
  return segments.map(s => s.trim()).filter(s => s.length > 0)
}

/**
 * True when the text contains a construct the shell would run as a NESTED
 * command inside a single segment: command substitution (`$(…)`, backticks)
 * or process substitution (`<(…)`, `>(…)`). Quote semantics follow the
 * shell: single-quoted text is literal; inside double quotes `$(…)` and
 * backticks still execute (process substitution does not); a backslash
 * escapes the next character. Boundary drawn on purpose: plain `${…}`
 * parameter expansion only expands variables and spawns no command — and a
 * command substitution nested inside it (`${x:-$(cmd)}`) still contains
 * `$(` and is caught by this character scan.
 */
export function containsCommandSubstitution(text: string): boolean {
  let quote: '\'' | '"' | null = null
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\' && quote !== '\'') {
      escaped = true
      continue
    }
    if (quote === '\'') {
      if (ch === '\'') quote = null
      continue
    }
    if (ch === '`') return true
    if (ch === '$' && text[i + 1] === '(') return true
    if (quote === '"') {
      if (ch === '"') quote = null
      continue
    }
    if ((ch === '<' || ch === '>') && text[i + 1] === '(') return true
    if (ch === '\'' || ch === '"') quote = ch
  }
  return false
}
