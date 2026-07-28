import { Marked } from 'marked'
import hljs from 'highlight.js/lib/common'

// ponytail: assistant content comes from our own mock server, so it is trusted
// and rendered as raw HTML. Wire a sanitizer (e.g. DOMPurify) here before ever
// feeding real user- or LLM-authored HTML into v-html.
const marked = new Marked({ gfm: true, breaks: true })

marked.use({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      const language = lang && hljs.getLanguage(lang) ? lang : undefined
      const highlighted = language
        ? hljs.highlight(text, { language }).value
        : hljs.highlightAuto(text).value
      const label = language ?? 'code'
      return (
        '<div class="code-block"><div class="code-head">' +
        `<span class="code-lang">${label}</span>` +
        '<button class="copy-btn" type="button" data-copy>Copy</button></div>' +
        `<pre><code class="hljs">${highlighted}</code></pre></div>`
      )
    },
  },
})

export function renderMarkdown(src: string): string {
  return marked.parse(src) as string
}
