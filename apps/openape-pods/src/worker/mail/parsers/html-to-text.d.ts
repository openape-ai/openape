declare module 'html-to-text' {
  export function convert(html: string, options?: { wordwrap?: number | false, limits?: { maxInputLength?: number, maxDepth?: number, maxChildNodes?: number, ellipsis?: string }, selectors?: { selector: string, format?: string, options?: Record<string, unknown> }[] }): string
}
declare module 'pdfjs-dist/build/pdf.mjs' {
  export { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
}
