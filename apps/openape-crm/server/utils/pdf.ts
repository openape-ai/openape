function pdfEscape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

export function simplePdf(lines: string[]): Buffer {
  const ops = lines.map((line, i) => `BT /F1 12 Tf 50 ${760 - i * 18} Td (${pdfEscape(line)}) Tj ET`).join('\n')
  const stream = `BT /F1 12 Tf 50 780 Td (OpenApe CRM) Tj ET\n${ops}`
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj',
    `4 0 obj << /Length ${Buffer.byteLength(stream)} >> stream\n${stream}\nendstream endobj`,
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
  ]
  let offset = 9
  const xref: number[] = [0]
  let body = '%PDF-1.4\n'
  for (const obj of objects) {
    xref.push(offset)
    body += `${obj}\n`
    offset = Buffer.byteLength(body)
  }
  const startxref = offset
  body += `xref\n0 ${xref.length}\n`
  body += '0000000000 65535 f \n'
  for (const pos of xref.slice(1)) {
    body += `${String(pos).padStart(10, '0')} 00000 n \n`
  }
  body += `trailer << /Size ${xref.length} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`
  return Buffer.from(body)
}
