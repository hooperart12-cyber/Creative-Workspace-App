import { readFile } from 'node:fs/promises'

export type PdfInspect =
  | { kind: 'pdf'; pageCount: number; width: number; height: number }
  | { kind: 'encrypted' }
  | { kind: 'invalid' }

/**
 * Reads a PDF enough to know its page count and first-page size.
 * No page is rendered here (that happens in the window that imported it).
 * A password is never passed in, so an encrypted file comes back as `encrypted`.
 */
export async function inspectPdf(path: string): Promise<PdfInspect> {
  const bytes = await readFile(path)
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: true,
    disableAutoFetch: true
  })
  try {
    const doc = await task.promise
    try {
      if (!doc.numPages) return { kind: 'invalid' }
      const page = await doc.getPage(1)
      const view = page.getViewport({ scale: 1 })
      if (!view.width || !view.height) return { kind: 'invalid' }
      return { kind: 'pdf', pageCount: doc.numPages, width: view.width, height: view.height }
    } finally {
      await doc.destroy()
    }
  } catch (error) {
    if (isPasswordError(error)) return { kind: 'encrypted' }
    return { kind: 'invalid' }
  }
}

function isPasswordError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    (error as { name?: string }).name === 'PasswordException'
  )
}
