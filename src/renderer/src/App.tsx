import { useEffect } from 'react'
import { ProjectView } from './components/ProjectView'
import { StartScreen } from './components/StartScreen'
import { showNotice, useProjectStore } from './store/projectStore'

export function App() {
  const status = useProjectStore((s) => s.status)
  const project = useProjectStore((s) => s.project)
  const error = useProjectStore((s) => s.error)
  const notice = useProjectStore((s) => s.notice)
  const clearError = useProjectStore((s) => s.clearError)
  const init = useProjectStore((s) => s.init)

  useEffect(() => {
    void init()
  }, [init])

  return (
    <div className="flex h-full flex-col">
      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-4 bg-red-50 px-4 py-2 text-sm text-red-800"
        >
          <span>{error}</span>
          <button className="font-medium hover:underline" onClick={clearError}>
            Dismiss
          </button>
        </div>
      )}
      {notice && (
        // Floats over the canvas so it never moves what's under the pointer.
        <div
          role="status"
          className="fixed bottom-16 left-1/2 z-50 flex max-w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 items-start gap-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-lg"
        >
          <span className="min-w-0 break-words whitespace-pre-line">{notice}</span>
          <button className="shrink-0 font-medium hover:underline" onClick={() => showNotice(null)}>
            Dismiss
          </button>
        </div>
      )}
      {status === 'loading' ? null : project ? <ProjectView project={project} /> : <StartScreen />}
    </div>
  )
}
