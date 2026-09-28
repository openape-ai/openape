import type { ReportDocument } from '../../shared/document'
import { createHash } from 'node:crypto'
import postcss from 'postcss'
import valueParser from 'postcss-value-parser'
import sanitizeHtml from 'sanitize-html'
import { createProblemError } from './problem'

export const documentPolicyVersion = 'static-document-1'
export const documentCsp = 'default-src \'none\'; script-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src \'none\'; connect-src \'none\'; media-src \'none\'; object-src \'none\'; frame-src \'none\'; worker-src \'none\'; base-uri \'none\'; form-action \'none\'; frame-ancestors \'self\'; sandbox'
const safeFunctions = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color', 'color-mix', 'calc', 'min', 'max', 'clamp', 'var', 'repeat', 'minmax', 'fit-content', 'linear-gradient', 'radial-gradient', 'conic-gradient', 'repeating-linear-gradient', 'repeating-radial-gradient', 'translate', 'translatex', 'translatey', 'scale', 'rotate'])

export function sanitizeDocumentCss(source: string) {
  if (/[\\<>\0]/.test(source)) throw createProblemError({ status: 400, title: 'CSS escapes and markup are unsupported' })
  try {
    const root = postcss.parse(source)
    root.walkComments((node) => { node.remove() })
    root.walkAtRules((node) => { if (!['media', 'supports', 'layer'].includes(node.name.toLowerCase())) node.remove() })
    root.walkDecls((node) => {
      let safe = !['behavior', '-moz-binding'].includes(node.prop.toLowerCase())
      valueParser(node.value).walk((value) => {
        if (value.type === 'function' && !safeFunctions.has(value.value.toLowerCase())) safe = false
      })
      if (!safe) node.remove()
    })
    return root.toString()
  }
  catch (error) {
    if (error instanceof postcss.CssSyntaxError) throw createProblemError({ status: 400, title: 'Invalid document CSS' })
    throw error
  }
}

export function sanitizeDocument(document: ReportDocument) {
  const assets = new Map(document.assets?.map(asset => [`asset:${asset.name}`, `data:${asset.contentType};base64,${asset.data}`]))
  const html = sanitizeHtml(document.html, {
    allowedTags: ['main', 'article', 'section', 'header', 'footer', 'nav', 'aside', 'div', 'span', 'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code', 'strong', 'b', 'em', 'i', 'u', 's', 'small', 'sub', 'sup', 'mark', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'figure', 'figcaption', 'img', 'a', 'details', 'summary', 'time'],
    allowedAttributes: { '*': ['class', 'title', 'lang', 'dir'], img: ['src', 'alt', 'width', 'height'], th: ['colspan', 'rowspan', 'scope'], td: ['colspan', 'rowspan'], ol: ['start'], details: ['open'], time: ['datetime'] },
    allowedSchemes: [], allowedSchemesByTag: { img: ['data'] }, allowProtocolRelative: false,
    nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'iframe', 'object', 'template', 'svg', 'math'],
    transformTags: {
      img: (tagName, attributes) => ({ tagName, attribs: { ...attributes, src: assets.get(attributes.src ?? '') ?? '' } }),
    },
  })
  const css = sanitizeDocumentCss(document.css ?? '')
  const title = sanitizeHtml(document.title, { allowedTags: [], allowedAttributes: {} })
  const artifact = `<!doctype html><html${document.language ? ` lang="${document.language}"` : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${css}</style></head><body>${html}</body></html>`
  return { artifact, artifactDigest: createHash('sha256').update(artifact).digest('hex'), policyVersion: documentPolicyVersion }
}
