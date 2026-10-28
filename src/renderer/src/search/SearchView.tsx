import { useEffect, useState } from 'react'
import type { BoardAppearance, SearchFilter, SearchHit, TagRecord } from '@shared/types'
import { useWorkspaceStore } from '../store/workspaceStore'
import { groupSearchHits } from './groupHits'
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
  const [cursor, setCursor] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [appearances, setAppearances] = useState<BoardAppearance[]>([])
  const [appearanceFor, setAppearanceFor] = useState<string | null>(null)
  const [included, setIncluded] = useState<TagRecord[]>([])
  const [excluded, setExcluded] = useState<TagRecord[]>([])
  const [tagMode, setTagMode] = useState<'all' | 'any'>('all')
  const [tagMatch, setTagMatch] = useState<'effective' | 'direct'>('effective')
  const [tagName, setTagName] = useState('')
  const [scope, setScope] = useState<'project' | 'board' | 'folder'>('project')
  const boardId = useWorkspaceStore((s) => s.board?.id)
  const folderId = useWorkspaceStore((s) => s.libraryFolderId)

  const requestFor = (next: string, nextFilter = filter, nextCursor: string | null = null) => ({
    text: next,
    phrase,
    filter: nextFilter,
    tags: {
      included: included.map((tag) => tag.id),
      excluded: excluded.map((tag) => tag.id),
      mode: tagMode
    },
    tagMatch,
    scope:
      scope === 'board' && boardId
        ? { type: 'board' as const, id: boardId }
        : scope === 'folder' && folderId
          ? { type: 'folder' as const, id: folderId }
          : { type: 'project' as const },
    cursor: nextCursor,
    limit: 50
  })

  const run = async (next = text, nextFilter = filter) => {
    const hasTags = included.length > 0 || excluded.length > 0
    if (!next.trim() && !hasTags) {
      setHits([])
      setCursor(null)
      setNote('')
      return
    }
    setNote('Searching…')
    const page = await window.api.invoke('search:query', requestFor(next, nextFilter))
    setHits(page.hits)
    setCursor(page.nextCursor)
    setNote(page.hits.length ? '' : 'No matches')
  }

  useEffect(() => {
    const onTag = (event: Event) => {
      const detail = (event as CustomEvent<{ tagId: string; additive: boolean }>).detail
      void window.api.invoke('tags:list', { includeArchived: true }).then((tags) => {
        const tag = tags.find((item) => item.id === detail.tagId)
        if (!tag) return
        if (detail.additive) {
          setIncluded((current) =>
            current.some((item) => item.id === tag.id)
              ? current.filter((item) => item.id !== tag.id)
              : [...current, tag]
          )
        } else {
          setIncluded([tag])
          setExcluded([])
        }
      })
    }
    window.addEventListener('cw-tag-search', onTag)
    return () => window.removeEventListener('cw-tag-search', onTag)
  }, [])

  const addNamedTag = async (negate: boolean) => {
    const tags = await window.api.invoke('tags:list', { query: tagName, includeArchived: true })
    const tag = tags.find(
      (item) => item.name.toLocaleLowerCase('en') === tagName.trim().toLocaleLowerCase('en')
    )
    if (!tag) return
    if (negate) setExcluded((current) => [...current, tag])
    else setIncluded((current) => [...current, tag])
    setTagName('')
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
        <input
          value={tagName}
          onChange={(event) => setTagName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void addNamedTag(event.shiftKey)
          }}
          aria-label="Add a tag to this search"
          placeholder="Tag"
          className="w-28 rounded-lg border border-line px-2 py-1 text-sm outline-none"
        />
        <button className="text-sm" onClick={() => void addNamedTag(true)}>
          Not
        </button>
        <select
          aria-label="Search scope"
          value={scope}
          onChange={(event) => setScope(event.target.value as 'project' | 'board' | 'folder')}
          className="rounded-lg border border-line px-2 py-1 text-sm"
        >
          <option value="project">Whole project</option>
          <option value="board">This board</option>
          <option value="folder">This folder</option>
        </select>
        <button
          className="text-sm"
          aria-pressed={tagMode === 'all'}
          onClick={() => setTagMode(tagMode === 'all' ? 'any' : 'all')}
        >
          {tagMode === 'all' ? 'All tags' : 'Any tag'}
        </button>
        <button
          className="text-sm"
          aria-pressed={tagMatch === 'direct'}
          onClick={() => setTagMatch(tagMatch === 'direct' ? 'effective' : 'direct')}
        >
          {tagMatch === 'direct' ? 'Direct only' : 'Including original'}
        </button>
      </div>
      {(included.length > 0 || excluded.length > 0) && (
        <div className="flex flex-wrap gap-1 px-3 pb-2">
          {included.map((tag) => (
            <button
              key={tag.id}
              className="rounded-full border border-line px-2 py-0.5 text-xs"
              onClick={() => setIncluded((current) => current.filter((item) => item.id !== tag.id))}
            >
              {tag.name} ×
            </button>
          ))}
          {excluded.map((tag) => (
            <button
              key={tag.id}
              className="rounded-full border border-line px-2 py-0.5 text-xs"
              onClick={() => setExcluded((current) => current.filter((item) => item.id !== tag.id))}
            >
              Not {tag.name} ×
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-1 px-3 py-2">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            aria-pressed={filter === item.id}
            className={`rounded-lg border px-2 py-1 text-sm ${filter === item.id ? 'border-ink' : 'border-line'}`}
            onClick={() => {
              setFilter(item.id)
              void run(text, item.id)
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
        {groupSearchHits(hits).map((group) =>
          group.kind === 'single' ? (
            <HitRow
              key={group.key}
              hit={group.hit}
              text={text}
              appearanceFor={appearanceFor}
              appearances={appearances}
              setAppearanceFor={setAppearanceFor}
              setAppearances={setAppearances}
            />
          ) : (
            <li key={group.key} className="border-b border-line py-2">
              <button
                className="block w-full text-left"
                onClick={() => void openSearchHit(group.stack, text)}
              >
                <span className="text-sm font-medium">{group.title}</span>
                <span className="ml-2 text-xs text-muted">stack</span>
              </button>
              <ul className="mt-1 space-y-1 pl-3">
                {group.slides.map((hit) => (
                  <li key={hit.slideId}>
                    <button className="text-sm" onClick={() => void openSearchHit(hit, text)}>
                      {hit.title}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          )
        )}
        {cursor && (
          <li>
            <button
              className="py-2 text-sm text-muted"
              onClick={() =>
                void window.api
                  .invoke('search:query', requestFor(text, filter, cursor))
                  .then((page) => {
                    setHits((current) => [...current, ...page.hits])
                    setCursor(page.nextCursor)
                  })
              }
            >
              Load more
            </button>
          </li>
        )}
      </ul>
    </div>
  )
}

function HitRow({
  hit,
  text,
  appearanceFor,
  appearances,
  setAppearanceFor,
  setAppearances
}: {
  hit: SearchHit
  text: string
  appearanceFor: string | null
  appearances: BoardAppearance[]
  setAppearanceFor: (id: string | null) => void
  setAppearances: (rows: BoardAppearance[]) => void
}) {
  return (
    <li
      key={`${hit.kind}:${hit.sourceId}:${hit.page ?? ''}:${hit.objectId ?? ''}:${hit.entryId ?? ''}`}
      className="border-b border-line py-2"
    >
      <button className="block w-full text-left" onClick={() => void openSearchHit(hit, text)}>
        <span className="text-sm font-medium">{hit.title}</span>
        <span className="ml-2 text-xs text-muted">{hit.kind}</span>
        <span className="mt-0.5 block text-xs text-muted">{hit.location}</span>
        {hit.matchedTags && hit.matchedTags.length > 0 && (
          <span className="mt-1 block text-xs text-muted">
            {hit.matchedTags
              .map(
                (tag) =>
                  `${tag.name}${tag.source === 'asset' ? ' (on the original)' : tag.source === 'stack' ? ' (on the stack)' : ''}`
              )
              .join(', ')}
          </span>
        )}
        {hit.snippet && (
          <span
            className="mt-1 block text-sm"
            dangerouslySetInnerHTML={{ __html: safeSnippet(hit.snippet) }}
          />
        )}
      </button>
      {hit.kind === 'entry' && hit.entryId && (
        <button
          className="mt-1 block text-xs text-muted"
          onClick={() =>
            void window.api.invoke('library:details', hit.entryId!).then((details) => {
              useWorkspaceStore.getState().openLibrary(details.entry.folderId, hit.entryId)
            })
          }
        >
          Show in library
        </button>
      )}
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
            <li key={`${appearance.objectId}:${appearance.slideId ?? ''}`}>
              <button className="text-xs" onClick={() => void openAppearance(appearance)}>
                {appearance.path}
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
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
