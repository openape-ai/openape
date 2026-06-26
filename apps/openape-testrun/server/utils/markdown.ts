import { marked } from 'marked'

// Uploaded captions/summaries are untrusted and the report URL is public, so
// raw HTML must never pass through. Escaping the source before parsing means
// only markdown-generated tags survive; the walkTokens hook additionally
// drops non-http(s) link targets (javascript: etc.).
function escapeHtml(src: string): string {
  return src.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

marked.use({
  walkTokens(token) {
    if (token.type === 'link' && !/^https?:\/\//i.test(token.href)) {
      token.href = '#'
    }
  },
})

export function renderMarkdown(src: string | undefined | null): string {
  if (!src) return ''
  return marked.parse(escapeHtml(src), { async: false })
}

export function renderMarkdownInline(src: string | undefined | null): string {
  if (!src) return ''
  return marked.parseInline(escapeHtml(src), { async: false })
}
