import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DomUtils, parseDocument } from 'htmlparser2'
import { digest } from './report-evidence'

export function renderReceipt(kind: 'plan' | 'test-run', source: Buffer, html: string) {
  const directory = new URL('../', import.meta.url)
  const pkg = JSON.parse(readFileSync(new URL('package.json', directory), 'utf8')) as { version: string }
  const template = readFileSync(new URL(`templates/${kind}.html`, directory))
  const styles = readFileSync(new URL('templates/document.css', directory))
  const document = parseDocument(html)
  const evidence = DomUtils.findAll(element => element.type === 'tag' && Boolean(element.attribs.id?.startsWith('evidence-')), document.children)
  const resolvedEvidenceDigests = evidence.flatMap((element) => {
    const img = DomUtils.getElementsByTagName('img', element)[0]
    const code = DomUtils.getElementsByTagName('code', element)[0]
    if (img) return [{ id: element.attribs.id!.slice(9), digest: digest(Buffer.from(img.attribs.src!.split(',')[1]!, 'base64')) }]
    if (code) return [{ id: element.attribs.id!.slice(9), digest: digest(DomUtils.textContent(code)) }]
    return []
  })
  if (!evidence.length) {
    DomUtils.getElementsByTagName('img', document).forEach((img, index) => {
      if (img.attribs.src?.startsWith('data:')) resolvedEvidenceDigests.push({ id: `legacy-image-${index + 1}`, digest: digest(Buffer.from(img.attribs.src.split(',')[1]!, 'base64')) })
    })
  }
  return { rendererVersion: pkg.version, templateDigest: digest(Buffer.concat([template, styles])), sourceFileDigest: digest(source), resolvedEvidenceDigests, htmlDigest: digest(html), template: fileURLToPath(new URL(`templates/${kind}.html`, directory)) }
}
