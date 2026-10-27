import { useState } from 'react'
import type { BoardAppearance, SearchFilter, SearchHit } from '@shared/types'
import { useWorkspaceStore } from '../store/workspaceStore'
import { openAppearance, openSearchHit } from './openHit'

const FILTERS: { id: SearchFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'board', label: 'Boards' },
  { id: 'note', label: 'Notes' },
  { id: 'pdf', label: 'PDFs' },
  { id: 'image', label: 'Images' },
  { id: 'file', label: 'Files' },
  { id: 'folder', label: 'Folders' }
]

export function SearchView() {
  const showCanvas = useWorkspaceStore((s) => s.showCanvas)
  const [text, setText] = useState('')
  const [filter, setFilter] = useState<SearchFilter>('all')
  const [phrase, setPhrase] = useState(false)
  const [hits, setHits] = useState<SearchHit[]>([])
  const [note, setNote] = useState('')
  const [appearances, setAppearances] = useState<BoardAppearance[]>([])
  const [appearanceFor, setAppearanceFor] = useState<string | null>(null)

  const run = async (next = text) => {
    setNote(next.trim() ? 'Searching…' : '')
    const found = next.trim() ? await window.api.invoke('search:query', next, filter, phrase) : []
    setHits(found)
    setNote(found.length ? '' : next.trim() ? 'No matches' : '')
  }

  return (
    <div data-testid="search" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <button className="text-sm text-muted" onClick={() => showCanvas()}>
          Back
        </button>
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void run(event.currentTarget.value)
          }}
          aria-label="Project search"
          placeholder="Search boards, notes, files, and PDFs"
          className="min-w-0 flex-1 rounded-lg border border-line px-3 py-1.5 text-sm outline-none"
        />
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={phrase}
            onChange={(event) => setPhrase(event.target.checked)}
          />
          Phrase
        </label>
      </div>
      <div className="flex gap-1 px-3 py-2">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            aria-pressed={filter === item.id}
            className={`rounded-lg border px-2 py-1 text-sm ${filter === item.id ? 'border-ink' : 'border-line'}`}
            onClick={() => {
              setFilter(item.id)
              void window.api.invoke('search:query', text, item.id, phrase).then((found) => {
                setHits(text.trim() ? found : [])
              })
            }}
          >
            {item.label}
          </button>
        ))}
        <button
          className="ml-auto text-sm text-muted"
          onClick={() => void window.api.invoke('search:rebuild')}
        >
          Rebuild index
        </button>
      </div>
      <p className="px-3 text-xs text-muted">{note}</p>
      <ul className="min-h-0 flex-1 overflow-auto px-3 pb-4">
        {hits.map((hit) => (
          <li key={`${hit.kind}:${hit.sourceId}`} className="border-b border-line py-2">
            <button
              className="block w-full text-left"
              onClick={() => void openSearchHit(hit, text)}
            >
              <span className="text-sm font-medium">{hit.title}</span>
              <span className="ml-2 text-xs text-muted">{hit.kind}</span>
              <span className="mt-0.5 block text-xs text-muted">{hit.location}</span>
              {hit.snippet && (
                <span
                  className="mt-1 block text-sm"
                  dangerouslySetInnerHTML={{ __html: safeSnippet(hit.snippet) }}
                />
              )}
            </button>
            {hit.assetId && (
              <button
                className="mt-1 text-xs text-muted"
                onClick={() =>
                  void window.api.invoke('search:appearances', hit.assetId!).then((rows) => {
                    setAppearanceFor(hit.assetId)
                    setAppearances(rows)
                  })
                }
              >
                Used on boards
              </button>
            )}
            {appearanceFor === hit.assetId && (
              <ul className="mt-1 space-y-1">
                {appearances.length === 0 && <li className="text-xs text-muted">Not on a board</li>}
                {appearances.map((appearance) => (
                  <li key={appearance.objectId}>
                    <button className="text-xs" onClick={() => void openAppearance(appearance)}>
                      {appearance.path}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function safeSnippet(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\[/g, '<mark>')
    .replace(/\]/g, '</mark>')
}
