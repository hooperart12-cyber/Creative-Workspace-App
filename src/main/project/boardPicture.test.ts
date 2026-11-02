import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { pdfOfPng, writeBoardPicture } from './boardPicture'

describe('board pictures', () => {
  it('writes a png and a one-page pdf of the same picture', async () => {
    const png = await sharp({
      create: { width: 12, height: 8, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } }
    })
      .png()
      .toBuffer()
    const dir = mkdtempSync(join(tmpdir(), 'cw-pic-'))
    try {
      const pngPath = join(dir, 'board.png')
      const pdfPath = join(dir, 'board.pdf')
      await writeBoardPicture({ png, destination: pngPath, format: 'png' })
      await writeBoardPicture({ png, destination: pdfPath, format: 'pdf' })
      expect(readFileSync(pngPath).subarray(0, 4).toString('hex')).toBe('89504e47')
      const pdf = readFileSync(pdfPath)
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
      expect(pdf.includes(Buffer.from('/Width 12'))).toBe(true)
      expect(pdf.includes(Buffer.from('/Height 8'))).toBe(true)
      const made = await pdfOfPng(png)
      expect(made.subarray(0, 5).toString()).toBe('%PDF-')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
