export interface CodeToken { text: string, kind: string }
export function highlightScript(source: string): CodeToken[] {
  const expression = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|\b(?:import|from|export|async|function|const|let|await|return|if|else|throw|new|true|false|null)\b|\b\d+\b/g
  const tokens: CodeToken[] = []; let cursor = 0
  for (const match of source.matchAll(expression)) {
    tokens.push({ text: source.slice(cursor, match.index), kind: '' })
    const text = match[0]; const kind = text.startsWith('/') ? 'comment' : /^["'`]/.test(text) ? 'string' : /^\d/.test(text) ? 'number' : 'keyword'
    tokens.push({ text, kind }); cursor = match.index + text.length
  }
  tokens.push({ text: `${source.slice(cursor)}\n`, kind: '' }); return tokens
}
