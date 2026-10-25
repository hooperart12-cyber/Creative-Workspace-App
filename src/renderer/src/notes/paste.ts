import DOMPurify from 'dompurify'

const ALLOWED_TAGS = [
  'p', 'br', 'div', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'a', 'mark',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'sub', 'sup',
  // Table cells keep their text (the table itself is dropped by the note schema).
  'table', 'thead', 'tbody', 'tr', 'td', 'th'
]
const ALLOWED_ATTR = ['href', 'title', 'style', 'start', 'data-color', 'data-pm-slice']

/** Styles kept from other programs and web pages: structure and emphasis, not their colours and fonts. */
const EXTERNAL_STYLES = new Set([
  'font-weight',
  'font-style',
  'text-decoration',
  'text-decoration-line',
  'text-align'
])
/** Copying between notes keeps everything the note format supports. */
const INTERNAL_STYLES = new Set([
  ...EXTERNAL_STYLES,
  'color',
  'background-color',
  'font-family',
  'font-size',
  'line-height',
  'margin-bottom'
])

/**
 * Cleans HTML pasted into a note (§5): no scripts, event handlers, images, frames or unsafe
 * links. Formatting from other programs keeps emphasis, headings, lists and links; text copied
 * from another note keeps its full formatting. The note schema then drops anything else.
 */
export function cleanPastedHtml(html: string): string {
  const fromNote = html.includes('data-pm-slice')
  const body = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
    RETURN_DOM: true
  }) as HTMLElement
  const keep = fromNote ? INTERNAL_STYLES : EXTERNAL_STYLES
  body.querySelectorAll<HTMLElement>('[style]').forEach((el) => {
    const kept: string[] = []
    for (const property of [...el.style]) {
      if (keep.has(property)) kept.push(`${property}: ${el.style.getPropertyValue(property)}`)
    }
    if (kept.length) el.setAttribute('style', kept.join('; '))
    else el.removeAttribute('style')
  })
  if (!fromNote) body.querySelectorAll('mark').forEach((el) => el.removeAttribute('data-color'))
  return body.innerHTML
}
