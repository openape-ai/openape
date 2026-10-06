// @vitest-environment node
import { resolve } from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { expect, it } from 'vitest'
import { extract } from '../../src/worker/mail/parsers/extract'

// The parser's own contract, formerly asserted through the native sandbox in
// e2e/mail-knowledge.test.ts. That file keeps one packaged run proving the
// parser executes inside the bundle's sandbox.
const worker = resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')
function pdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 20 150 Td (${text}) Tj ET`
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`]
  let output = '%PDF-1.4\n'; const offsets = [0]
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(output)); output += `${index + 1} 0 obj\n${object}\nendobj\n` }
  const xref = Buffer.byteLength(output)
  output += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(output)
}

it.each([
  ['text/plain', Buffer.from('Delivery is June 8.')],
  ['text/html', Buffer.from('<p>Delivery is <b>June 8</b>.</p><script>stealSecrets()</script><img src="https://attacker.invalid/tracking">')],
  ['application/pdf', pdf('Delivery is June 8.')],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', Buffer.from(zipSync({ 'word/document.xml': strToU8('<w:document><w:body><w:p><w:r><w:t>Delivery is June 8.</w:t></w:r></w:p></w:body></w:document>') }))],
])('extracts readable text from %s and drops scripts and tracking', async (type, bytes) => {
  const result = await extract(bytes, type, worker)
  expect(result.gap).toBeNull()
  expect(result.text).toContain('Delivery is June 8.')
  expect(result.text).not.toContain('stealSecrets'); expect(result.text).not.toContain('attacker.invalid')
})

it.each([
  ['unsupported', 'application/octet-stream', Buffer.from('unsupported')],
  ['scanned', 'application/pdf', pdf('')],
  ['malformed', 'application/pdf', Buffer.from('broken PDF')],
  ['oversized', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', Buffer.from(zipSync({ 'word/document.xml': strToU8(`<w:document>${'a'.repeat(3 * 1024 * 1024)}</w:document>`) }))],
])('keeps a %s document as an explicit gap without text', async (_kind, type, bytes) => {
  const result = await extract(bytes, type, worker)
  expect(result.gap).toBeTruthy(); expect(result.text).toBe('')
})
