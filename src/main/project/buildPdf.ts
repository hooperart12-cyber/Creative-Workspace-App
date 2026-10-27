/** A tiny valid PDF, for tests. Text uses Helvetica; no images, scripts, or encryption. */
export interface PdfOutlineItem {
  title: string
  /** 1-based page number. */
  page: number
}

export interface PdfPageSpec {
  text: string
  width?: number
  height?: number
}

/**
 * Builds a PDF 1.4 document. Page 1 is a cover when tests use spread mode.
 * Outline entries jump straight at a page (no user-made table of contents).
 */
export function buildPdf(
  pages: Array<string | PdfPageSpec>,
  options?: { outline?: PdfOutlineItem[] }
): Buffer {
  const specs = pages.map((page) => (typeof page === 'string' ? { text: page } : page))
  if (specs.length === 0) throw new Error('A PDF needs at least one page.')
  const outline = options?.outline ?? []
  const pageObject = (index: number) => 4 + index * 2
  const outlineObject = 4 + specs.length * 2

  const chunks: string[] = []
  const offsets: number[] = []
  const length = () => chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const add = (body: string) => {
    const n = offsets.length + 1
    offsets.push(length())
    chunks.push(`${n} 0 obj\n${body}\nendobj\n`)
  }

  chunks.push('%PDF-1.4\n')
  const outlineRef = outline.length ? ` /Outlines ${outlineObject} 0 R` : ''
  add(`<< /Type /Catalog /Pages 2 0 R${outlineRef} >>`)
  const kids = specs.map((_, index) => `${pageObject(index)} 0 R`).join(' ')
  add(`<< /Type /Pages /Kids [${kids}] /Count ${specs.length} >>`)
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')

  specs.forEach((page, index) => {
    const width = page.width ?? 300
    const height = page.height ?? 400
    const content = pageObject(index) + 1
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents ${content} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`
    )
    const stream = page.text ? `BT /F1 18 Tf 36 72 Td (${escapePdfText(page.text)}) Tj ET` : ''
    add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  })

  if (outline.length) {
    const first = outlineObject + 1
    const last = outlineObject + outline.length
    add(`<< /Type /Outlines /First ${first} 0 R /Last ${last} 0 R /Count ${outline.length} >>`)
    outline.forEach((item, index) => {
      const page = specs[item.page - 1]
      if (!page) throw new Error(`Outline points at missing page ${item.page}.`)
      const id = outlineObject + 1 + index
      const next = index < outline.length - 1 ? ` /Next ${id + 1} 0 R` : ''
      const prev = index > 0 ? ` /Prev ${id - 1} 0 R` : ''
      const height = page.height ?? 400
      add(
        `<< /Title (${escapePdfText(item.title)}) /Parent ${outlineObject} 0 R /Dest [${pageObject(item.page - 1)} 0 R /XYZ 0 ${height} 0]${prev}${next} >>`
      )
    })
  }

  const startxref = length()
  let xref = `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) xref += `${String(offset).padStart(10, '0')} 00000 n \n`
  chunks.push(xref)
  chunks.push(
    `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`
  )
  return Buffer.from(chunks.join(''), 'latin1')
}

function escapePdfText(text: string): string {
  return text.replace(/[()\\]/g, (char) => `\\${char}`)
}
