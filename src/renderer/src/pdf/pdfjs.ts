import {
  AnnotationMode,
  getDocument,
  GlobalWorkerOptions,
  PDFDataRangeTransport,
  type PDFDocumentLoadingTask
} from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

/** Standard fonts and cmaps are copied next to the page (see electron.vite.config.ts). */
function pdfAssetDir(kind: 'standard_fonts' | 'cmaps'): string {
  return new URL(`pdfjs/${kind}/`, window.location.href).href
}

/**
 * Opens a stored PDF. The worker cannot fetch cw-asset://, so each range is read
 * through the main process and only the pages on screen are rendered.
 * Scripting and eval stay off. The password is not stored.
 */
export function openPdf(assetId: string, bytes: number, password?: string): PDFDocumentLoadingTask {
  const transport = new PDFDataRangeTransport(bytes, null)
  transport.requestDataRange = (begin, end) => {
    void window.api.invoke('assets:readRange', assetId, begin, end).then(
      (chunk) => {
        const copy = new Uint8Array(chunk.byteLength)
        copy.set(chunk)
        transport.onDataRange(begin, copy)
      },
      () => transport.abort()
    )
  }
  return getDocument({
    range: transport,
    password,
    disableStream: true,
    isEvalSupported: false,
    useSystemFonts: true,
    enableXfa: false,
    standardFontDataUrl: pdfAssetDir('standard_fonts'),
    cMapUrl: pdfAssetDir('cmaps'),
    cMapPacked: true
  })
}

export { AnnotationMode }
