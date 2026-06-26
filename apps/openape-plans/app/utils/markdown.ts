import { marked } from 'marked'

// Render Markdown to HTML using marked. GFM enabled; line breaks honored so that
// plan bodies (written by humans and agents) render close to how they look in an
// editor. XSS risk is bounded: only the current user's team members can write.
marked.setOptions({ gfm: true, breaks: true })

export function renderMarkdown(src: string): string {
  return marked.parse(src) as string
}
