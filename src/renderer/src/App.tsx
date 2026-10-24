import { useEffect } from 'react'
import { ProjectView } from './components/ProjectView'
import { StartScreen } from './components/StartScreen'
import { useProjectStore } from './store/projectStore'

export function App() {
  const status = useProjectStore((s) => s.status)
  const project = useProjectStore((s) => s.project)
  const error = useProjectStore((s) => s.error)
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
      {status === 'loading' ? null : project ? <ProjectView project={project} /> : <StartScreen />}
    </div>
  )
}
