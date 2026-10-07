import { DomUtils, parseDocument } from 'htmlparser2'

export function planLanguageView(html: string, language: 'en' | 'de'): string {
  const document = parseDocument(html)
  const elements = DomUtils.findAll(element => element.type === 'tag', document.children)
  const ids = new Set(elements.flatMap(element => element.attribs.id ? [element.attribs.id] : []))
  for (const element of elements) {
    if (element.attribs.id) element.attribs.id = `${language}-${element.attribs.id}`
    const href = element.attribs.href
    if (href?.startsWith('#') && ids.has(href.slice(1))) element.attribs.href = `#${language}-${href.slice(1)}`
    for (const attribute of ['aria-labelledby', 'aria-describedby']) {
      if (element.attribs[attribute]) element.attribs[attribute] = element.attribs[attribute].split(' ').map(id => ids.has(id) ? `${language}-${id}` : id).join(' ')
    }
  }
  return `<section class="plan-language plan-${language}" lang="${language}">${DomUtils.getOuterHTML(document)}</section>`
}
