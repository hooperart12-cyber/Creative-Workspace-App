import { useEffect, useState } from 'react'
import { reportError } from '../store/projectStore'

export function ContentsList({
  collectionId,
  pageId,
  onOpen
}: {
  collectionId: string
  pageId: string | null
  onOpen: (pageId: string) => void
}) {
  const [items, setItems] = useState<
    { id: string; pageId: string; kind: string; title: string; available: boolean }[]
  >([])
  const [title, setTitle] = useState('')
  const load = () => {
    void window.api
      .invoke('collections:nav', collectionId)
      .then(setItems)
      .catch((error) => reportError(error))
  }
  useEffect(() => {
    let cancel = false
    void window.api.invoke('collections:nav', collectionId).then((rows) => {
      if (!cancel) setItems(rows)
    })
    return () => {
      cancel = true
    }
  }, [collectionId])
  const add = (kind: 'toc' | 'bookmark') => {
    if (!pageId || !title.trim()) return
    void window.api
      .invoke('collections:addNav', collectionId, pageId, kind, title.trim())
      .then(() => {
        setTitle('')
        load()
      })
      .catch((error) => reportError(error))
  }
  return (
    <div className="flex w-56 shrink-0 flex-col gap-2 border-r border-line bg-surface p-3 text-sm">
      <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">Contents</h2>
      <ul className="min-h-0 flex-1 space-y-1 overflow-auto">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-1">
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left text-xs"
              disabled={!item.available}
              onClick={() => item.available && onOpen(item.pageId)}
            >
              {item.kind === 'bookmark' ? 'Bookmark' : 'Contents'} · {item.title || 'Untitled'}
              {!item.available ? ' (unavailable)' : ''}
            </button>
            <button
              type="button"
              className="text-xs text-muted"
              aria-label={`Remove ${item.title || 'entry'}`}
              onClick={() => {
                void window.api
                  .invoke('collections:removeNav', item.id)
                  .then(load)
                  .catch((error) => reportError(error))
              }}
            >
              ×
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="text-xs text-muted">No contents yet.</li>}
      </ul>
      <input
        aria-label="Contents title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        className="rounded border border-line bg-canvas px-2 py-1 text-xs"
      />
      <div className="flex gap-1">
        <button type="button" className={tiny} onClick={() => add('toc')}>
          Add contents
        </button>
        <button type="button" className={tiny} onClick={() => add('bookmark')}>
          Bookmark
        </button>
      </div>
    </div>
  )
}

const tiny = 'rounded border border-line px-2 py-1 text-xs'
