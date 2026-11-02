/** Writes a board picture. The PNG comes from the canvas. The PDF is that same picture, one page. */
import { randomUUID } from 'node:crypto'
import { rename, rm, writeFile } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'
import sharp from 'sharp'

const MAX_PNG_BYTES = 80_000_000

/** Saves a PNG, or a one-page PDF of that PNG. The page matches the picture's shape. */
export async function writeBoardPicture(input: {
  png: Buffer
  destination: string
  format: 'png' | 'pdf'
}): Promise<void> {
  if (input.png.length < 8 || input.png[0] !== 0x89 || input.png[1] !== 0x50)
    throw new Error('The picture was not a PNG.')
  if (input.png.length > MAX_PNG_BYTES) throw new Error('The picture is too large.')
  const bytes = input.format === 'png' ? input.png : await pdfOfPng(input.png)
  const staging = `${input.destination}.${randomUUID()}.partial`
  try {
    await writeFile(staging, bytes)
    await rename(staging, input.destination)
  } catch (error) {
    await rm(staging, { force: true })
    throw error
  }
}

/** One page, sized so 144 picture pixels are one inch. Nothing is cropped. */
export async function pdfOfPng(png: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(png)
    .flatten({ background: '#f6f5f2' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (info.channels !== 3) throw new Error('The picture could not be prepared for PDF.')
  return pdfDocument(deflateSync(data), info.width, info.height)
}

function pdfDocument(image: Buffer, width: number, height: number): Buffer {
  const pageW = round((width * 72) / 144)
  const pageH = round((height * 72) / 144)
  const content = Buffer.from(`q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q\n`, 'latin1')
  const chunks: Buffer[] = []
  const offsets = [0]
  let size = 0
  const add = (value: string | Buffer) => {
    const buf = typeof value === 'string' ? Buffer.from(value, 'latin1') : value
    chunks.push(buf)
    size += buf.length
  }
  const object = () => offsets.push(size)
  add('%PDF-1.4\n%\xff\xff\xff\xff\n')
  object()
  add('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  object()
  add('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n')
  object()
  add(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>\nendobj\n`
  )
  object()
  add(`4 0 obj\n<< /Length ${content.length} >>\nstream\n`)
  add(content)
  add('endstream\nendobj\n')
  object()
  add(
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${image.length} >>\nstream\n`
  )
  add(image)
  add('\nendstream\nendobj\n')
  const xrefAt = size
  let xref = `xref\n0 ${offsets.length}\n0000000000 65535 f \n`
  for (let index = 1; index < offsets.length; index += 1) {
    xref += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`
  }
  add(xref)
  add(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`)
  return Buffer.concat(chunks)
}

function round(value: number): number {
  return Math.max(1, Math.round(value * 100) / 100)
}
