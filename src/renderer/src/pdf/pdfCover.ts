import { AnnotationMode } from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useProjectStore } from '../store/projectStore'
import { openPdf } from './pdfjs'

/** Renders page 1 and asks the main process to store it as the PDF's cover. */
export async function saveCoverFromDocument(doc: PDFDocumentProxy, assetId: string): Promise<void> {
  const page = await doc.getPage(1)
  const base = page.getViewport({ scale: 1 })
  const scale = Math.min(2, 1024 / Math.max(base.width, base.height))
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(viewport.width))
  canvas.height = Math.max(1, Math.ceil(viewport.height))
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  await page.render({
    canvas,
    canvasContext: ctx,
    viewport,
    annotationMode: AnnotationMode.DISABLE
  }).promise
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) return
  await window.api.invoke('assets:saveCover', assetId, new Uint8Array(await blob.arrayBuffer()))
}

/** Makes covers for PDFs that were just imported in this window. Failures leave the placeholder. */
export async function ensurePdfCovers(
  imported: { id: string; mime: string; bytes: number; width: number | null }[]
): Promise<void> {
  const projectId = useProjectStore.getState().project?.id
  if (!projectId) return
  for (const asset of imported) {
    if (asset.mime !== 'application/pdf' || !asset.width) continue
    try {
      const task = openPdf(asset.id, asset.bytes)
      const doc = await task.promise
      try {
        await saveCoverFromDocument(doc, asset.id)
      } finally {
        await doc.destroy()
      }
    } catch {
      // The card keeps its placeholder. Opening the reader can try again.
    }
  }
}
