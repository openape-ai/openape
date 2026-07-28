import { marked } from 'marked'

function escapeHtml(src: string): string {
  return src.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

// Descriptions/comments come from authenticated agents/humans, but must never
// inject raw HTML. Rather than pre-escaping the source (which double-escapes
// code spans — `<textarea>` became `&lt;textarea&gt;` on screen), we let marked
// escape text/code exactly once and override the `html` renderer so any raw
// HTML token is escaped to literal text. The walkTokens hook drops non-http(s)
// link targets (javascript: etc.).
marked.use({
  walkTokens(token) {
    if (token.type === 'link' && !/^https?:\/\//i.test(token.href)) {
      token.href = '#'
    }
  },
  renderer: {
    html(token: unknown): string {
      const text = typeof token === 'string' ? token : ((token as { text?: string })?.text ?? '')
      return escapeHtml(text)
    },
  },
})

export function renderMarkdown(src: string | undefined | null): string {
  if (!src) return ''
  return marked.parse(src, { async: false })
}

export function renderMarkdownInline(src: string | undefined | null): string {
  if (!src) return ''
  return marked.parseInline(src, { async: false })
}

/**
 * Render markdown, rewriting relative image sources to `${assetBase}/<path>`
 * so embedded images (`![](desc/before.png)`) resolve to the asset endpoint.
 * Absolute (http/https) and root-relative srcs are left untouched.
 */
export function renderMarkdownWithAssets(src: string | undefined | null, assetBase: string): string {
  const html = renderMarkdown(src)
  return html.replace(/<img([^>]*?)src="([^"]+)"/g, (match, attrs, url) => {
    if (/^(https?:\/\/|\/)/i.test(url)) return match
    return `<img${attrs}src="${assetBase}/${url}"`
  })
}
