declare module 'pdfjs-dist/legacy/build/pdf.mjs' {
  interface PdfPage {
    getViewport(options: { scale: number }): { width: number; height: number }
  }
  interface PdfDoc {
    numPages: number
    getPage(n: number): Promise<PdfPage>
    destroy(): Promise<void>
  }
  interface LoadingTask {
    promise: Promise<PdfDoc>
    destroy(): void
  }
  export function getDocument(src: Record<string, unknown>): LoadingTask
}
