import { useState, type FormEvent } from 'react'
import { useProjectStore } from '../store/projectStore'

export function StartScreen() {
  const recent = useProjectStore((s) => s.recent)
  const createProject = useProjectStore((s) => s.createProject)
  const openProject = useProjectStore((s) => s.openProject)
  const removeRecent = useProjectStore((s) => s.removeRecent)
  const [name, setName] = useState('')

  const onCreate = (event: FormEvent) => {
    event.preventDefault()
    if (name.trim()) void createProject(name)
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-6 py-16">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Creative Workspace</h1>
        <p className="mt-2 text-muted">
          Boards, references and artwork for your creative projects.
        </p>
      </header>

      <section className="rounded-xl border border-line bg-surface p-6">
        <h2 className="text-lg font-medium">New project</h2>
        <form onSubmit={onCreate} className="mt-4 flex gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name"
            aria-label="Project name"
            className="flex-1 rounded-lg border border-line px-3 py-2 outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={!name.trim()}
            className="rounded-lg bg-accent px-4 py-2 font-medium text-white disabled:opacity-40"
          >
            Choose location & create
          </button>
        </form>
        <p className="mt-3 text-sm text-muted">
          Projects are folders on your computer. Put one in a OneDrive or Dropbox folder to back it
          up automatically.
        </p>
      </section>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Recent projects</h2>
          <button
            onClick={() => void openProject()}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:bg-canvas"
          >
            Open project…
          </button>
        </div>
        {recent.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No recent projects yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {recent.map((p) => (
              <li key={p.path} className="flex items-center gap-3 px-4 py-3">
                <button
                  onClick={() => void openProject(p.path)}
                  className="min-w-0 flex-1 text-left"
                  title={p.path}
                >
                  <div className="truncate font-medium">{p.name}</div>
                  <div className="truncate text-xs text-muted">{p.path}</div>
                </button>
                <button
                  onClick={() => void removeRecent(p.path)}
                  className="text-xs text-muted hover:text-ink"
                  aria-label={`Remove ${p.name} from recent projects`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
