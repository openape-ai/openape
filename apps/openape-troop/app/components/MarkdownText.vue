<script setup lang="ts">
import { computed } from 'vue'
import { marked } from 'marked'

// Renders markdown (vision, reports, agent chat replies) as styled HTML.
// No sanitizer dependency in this app, so we render with marked and strip the
// realistic XSS vectors ourselves: dangerous tags, inline event handlers, and
// javascript:/data: URLs. Content here is owner- or agent-authored in an
// owner-only authenticated app, so this is defence-in-depth, not the primary
// trust boundary.
const props = defineProps<{ content: string | null | undefined }>()

function sanitize(html: string): string {
  return html
    .replace(/<\/?(?:script|style|iframe|object|embed|link|meta|form|input|base)\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/(?:href|src)\s*=\s*"(?:javascript|data):[^"]*"/gi, '')
    .replace(/(?:href|src)\s*=\s*'(?:javascript|data):[^']*'/gi, '')
}

const html = computed(() => {
  const md = props.content?.trim()
  if (!md) return ''
  return sanitize(marked.parse(md, { async: false, breaks: true, gfm: true }) as string)
})
</script>

<template>
  <!-- eslint-disable vue/no-v-html -->
  <div class="md" v-html="html" />
  <!-- eslint-enable vue/no-v-html -->
</template>

<style scoped>
.md { line-height: 1.6; word-break: break-word; overflow-wrap: anywhere; }
.md :deep(p) { margin: 0.4rem 0; }
.md :deep(h1), .md :deep(h2), .md :deep(h3) { font-weight: 600; color: #e4e4e7; margin: 0.8rem 0 0.4rem; line-height: 1.3; }
.md :deep(h1) { font-size: 1.25rem; }
.md :deep(h2) { font-size: 1.1rem; }
.md :deep(h3) { font-size: 1rem; }
.md :deep(ul), .md :deep(ol) { margin: 0.4rem 0; padding-left: 1.25rem; }
.md :deep(li) { margin: 0.2rem 0; }
.md :deep(ul) { list-style: disc; }
.md :deep(ol) { list-style: decimal; }
.md :deep(strong) { color: #e4e4e7; font-weight: 600; }
.md :deep(em) { font-style: italic; }
.md :deep(a) { color: #34d399; text-decoration: underline; }
.md :deep(code) { background: rgba(255, 255, 255, 0.08); padding: 0.1rem 0.3rem; border-radius: 0.25rem; font-size: 0.85em; }
.md :deep(pre) { background: rgba(255, 255, 255, 0.05); padding: 0.75rem; border-radius: 0.5rem; overflow-x: auto; margin: 0.5rem 0; }
.md :deep(pre code) { background: none; padding: 0; }
.md :deep(blockquote) { border-left: 3px solid rgba(255, 255, 255, 0.15); padding-left: 0.75rem; color: #a1a1aa; margin: 0.5rem 0; }
.md :deep(table) { border-collapse: collapse; margin: 0.5rem 0; display: block; overflow-x: auto; }
.md :deep(th), .md :deep(td) { border: 1px solid rgba(255, 255, 255, 0.12); padding: 0.3rem 0.6rem; text-align: left; }
.md :deep(hr) { border: none; border-top: 1px solid rgba(255, 255, 255, 0.12); margin: 0.8rem 0; }
.md :deep(:first-child) { margin-top: 0; }
.md :deep(:last-child) { margin-bottom: 0; }
</style>
