import { convert } from 'html-to-text'
import { Unzip, UnzipInflate } from 'fflate'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/build/pdf.mjs'

export const parserVersion = 'mail-text-v1/pdfjs-6.3.289/html-10.0.1/fflate-0.8.3'
export interface Extraction { text: string, gap: string | null, parser: string }
const maximumText = 60000
function html(input: string): string {
  if (input.length > 2 * 1024 * 1024) throw new Error('HTML exceeds extraction limit')
  const result = convert(input, { wordwrap: false, limits: { maxInputLength: 2 * 1024 * 1024, maxDepth: 100, maxChildNodes: 10000, ellipsis: '[UNEXAMINED CONTENT]' }, selectors: [{ selector: 'script', format: 'skip' }, { selector: 'style', format: 'skip' }, { selector: 'img', format: 'skip' }, { selector: 'a', options: { ignoreHref: true } }] })
  if (result.includes('[UNEXAMINED CONTENT]')) throw new Error('HTML nesting or child limit exceeded')
  return result
}
function docx(bytes: Uint8Array): string {
  let count = 0; let total = 0; let finished = false
  const chunks: Uint8Array[] = []
  const unzip = new Unzip((file) => {
    if (++count > 1000) throw new Error('DOCX entry limit exceeded')
    if (file.name !== 'word/document.xml') return
    if (chunks.length || finished) throw new Error('Duplicate DOCX document')
    file.ondata = (error, data, final) => {
      if (error) throw error
      total += data.length
      if (total > 2 * 1024 * 1024) throw new Error('DOCX text exceeds extraction limit')
      chunks.push(data); finished = final
    }
    file.start()
  })
  unzip.register(UnzipInflate)
  for (let offset = 0; offset < bytes.length; offset += 1024) unzip.push(bytes.subarray(offset, offset + 1024), offset + 1024 >= bytes.length)
  if (!finished) throw new Error('DOCX document is missing or incomplete')
  const xml = Buffer.concat(chunks).toString('utf8')
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('DOCX declarations are unsupported')
  return html(xml.replace(/<\/w:p\s*>/g, '</p>').replace(/<w:p(?:\s[^>]*)?>/g, '<p>').replace(/<w:tab\s*\/>/g, ' ').replace(/<w:br\s*\/>/g, '<br>'))
}
async function pdf(bytes: Uint8Array, worker: string): Promise<string> {
  GlobalWorkerOptions.workerSrc = worker
  const loading = getDocument({ data: new Uint8Array(bytes), useWasm: false, useSystemFonts: false, disableFontFace: true, enableXfa: false, stopAtErrors: true, disableAutoFetch: true, disableStream: true, disableRange: true, verbosity: 0 })
  try {
    const document = await loading.promise
    if (document.numPages > 100) throw new Error('PDF page limit exceeded')
    const pages: string[] = []; let size = 0
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number)
      const content = await page.getTextContent()
      const text = content.items.map(item => 'str' in item ? item.str : '').join(' ')
      size += text.length
      if (size > maximumText) throw new Error('PDF text limit exceeded')
      pages.push(`[Page ${number}]\n${text}`); page.cleanup()
    }
    if (!pages.some(text => text.replace(/\[Page \d+\]/g, '').trim())) throw new Error('PDF has no extractable text; OCR is not enabled')
    return pages.join('\n\n')
  }
  finally { await loading.destroy() }
}
export async function extract(bytes: Uint8Array, type: string, worker: string): Promise<Extraction> {
  try {
    if (bytes.length > 20 * 1024 * 1024) throw new Error('Document exceeds 20 MiB limit')
    let text: string
    if (type === 'text' || type === 'text/plain') text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    else if (type === 'html' || type === 'text/html') text = html(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    else if (type === 'application/pdf') text = await pdf(bytes, worker)
    else if (type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') text = docx(bytes)
    else throw new Error('Unsupported attachment format')
    if (!text.trim()) throw new Error('Document contains no extractable text')
    const truncated = text.length > maximumText
    return { text: text.slice(0, maximumText), gap: truncated ? 'Text exceeds extraction limit; remainder is unexamined' : null, parser: parserVersion }
  }
  catch (error) {
    return { text: '', gap: error instanceof Error && /limit|unsupported|Unsupported|missing|incomplete|extractable|declarations/.test(error.message) ? error.message.slice(0, 200) : 'Document could not be parsed; it remains unexamined', parser: parserVersion }
  }
}
