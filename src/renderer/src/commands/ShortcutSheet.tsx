import { useEffect, useState } from 'react'
import { commands } from './registry'

export function ShortcutSheet() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  useEffect(() => {
    const onOpen = () => setOpen(true)
    document.addEventListener('cw-shortcuts', onOpen)
    return () => document.removeEventListener('cw-shortcuts', onOpen)
  }, [])
  if (!open) return null
  const needle = query.trim().toLowerCase()
  const groups = new Map<string, ReturnType<typeof commands>>()
  for (const command of commands()) {
    if (
      needle &&
      !`${command.title} ${command.shortcut ?? ''} ${command.group}`.toLowerCase().includes(needle)
    ) {
      continue
    }
    const list = groups.get(command.group) ?? []
    list.push(command)
    groups.set(command.group, list)
  }
  return (
    <div
      role="dialog"
      aria-label="Keyboard shortcuts"
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/20"
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false)
      }}
    >
      <div className="max-h-[80%] w-[36rem] overflow-auto rounded-xl border border-line bg-surface p-5 shadow-lg">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-medium">Keyboard shortcuts</h2>
          <button
            className="text-sm text-muted"
            onClick={() => setOpen(false)}
            aria-label="Close shortcuts"
          >
            Close
          </button>
        </div>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter shortcuts"
          aria-label="Filter shortcuts"
          className="mt-3 w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm outline-none"
        />
        {[...groups.entries()].map(([group, items]) => (
          <section key={group} className="mt-4">
            <h3 className="text-xs font-medium tracking-wide text-muted uppercase">{group}</h3>
            <ul className="mt-2 space-y-1">
              {items.map((command) => (
                <li key={command.id} className="flex items-center justify-between text-sm">
                  <span>{command.title}</span>
                  <span className="text-muted">{command.shortcut ?? 'Palette'}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
