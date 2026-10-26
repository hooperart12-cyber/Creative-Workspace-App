import { useEffect } from 'react'
import { openPdf } from '../pdf/pdfjs'

/** Indexes one PDF page at a time so a long manuscript does not freeze the window. */
export function PdfIndexer() {
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const again = (delay: number) => {
      timer = setTimeout(() => void step(), delay)
    }
    const step = async () => {
      if (stopped) return
      const job = await window.api.invoke('search:nextPdf').catch(() => null)
      if (stopped) return
      if (!job) {
        again(1500)
        return
      }
      try {
        const task = openPdf(job.assetId, job.bytes)
        const pdf = await task.promise
        const pageNumber = job.pagesDone + 1
        if (pageNumber > pdf.numPages) {
          await window.api.invoke(
            'search:finishPdf',
            job.assetId,
            job.pagesDone > 0 ? 'done' : 'no-text'
          )
        } else {
          const content = await pdf.getPage(pageNumber).then((page) => page.getTextContent())
          const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ')
          await window.api.invoke('search:addPdfPage', job.assetId, pageNumber, text, job.name)
        }
        await task.destroy()
      } catch (error) {
        const locked =
          !!error &&
          typeof error === 'object' &&
          (error as { name?: string }).name === 'PasswordException'
        await window.api
          .invoke(
            'search:finishPdf',
            job.assetId,
            locked ? 'locked' : 'failed',
            error instanceof Error ? error.message : String(error)
          )
          .catch(() => {})
      }
      if (!stopped) again(0)
    }
    void step()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [])
  return null
}
