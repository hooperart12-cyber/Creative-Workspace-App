import { useEffect, useState } from 'react'
import type { TagRecord, TagTarget } from '@shared/types'
import { reportError } from '../store/projectStore'
import { addTags, createOneOff, removeTags, replaceTags, searchForTag } from './tagActions'

interface Summary {
  id: string
  name: string
  color: string | null
  present: number
  total: number
}

/** Adds, removes, or replaces direct tags. One-offs are offered only for a single item. */
export function TagEditor({
  targets,
  title,
  inherited = []
}: {
  targets: TagTarget[]
  title: string
  inherited?: { id: string; name: string }[]
}) {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<TagRecord[]>([])
  const [summary, setSummary] = useState<Summary[]>([])
  const [includeArchived, setIncludeArchived] = useState(false)
  const [chosen, setChosen] = useState<string[]>([])
  const single = targets.length === 1

  const targetKey = targets.map((target) => `${target.type}:${target.id}`).join('|')

  const reload = async () => {
    const [listed, counts] = await Promise.all([
      window.api.invoke('tags:list', { query, includeArchived }),
      window.api.invoke('tags:summary', targets)
    ])
    setSuggestions(listed)
    setSummary(counts)
  }

  useEffect(() => {
    let cancel = false
    void Promise.all([
      window.api.invoke('tags:list', { query, includeArchived }),
      window.api.invoke('tags:summary', targets)
    ]).then(([listed, counts]) => {
      if (cancel) return
      setSuggestions(listed)
      setSummary(counts)
    })
    return () => {
      cancel = true
    }
  }, [query, includeArchived, targetKey, targets])

  const apply = async (action: 'add' | 'remove' | 'replace') => {
    try {
      if (action === 'replace') {
        const ok = window.confirm(
          `Replace the direct tags on ${targets.length} item${targets.length === 1 ? '' : 's'} with the tags you checked?`
        )
        if (!ok) return
        await replaceTags(chosen, targets)
      } else if (action === 'add') await addTags(chosen, targets)
      else await removeTags(chosen, targets)
      setChosen([])
      await reload()
    } catch (error) {
      reportError(error)
    }
  }

  return (
    <div className="mt-3 border-t border-line pt-3">
      <h3 className="text-xs font-medium text-muted">{title}</h3>
      {inherited.length > 0 && (
        <p className="mt-1 text-xs text-muted">
          On the original: {inherited.map((tag) => tag.name).join(', ')}
        </p>
      )}
      <ul className="mt-1 flex flex-wrap gap-1">
        {summary.map((tag) => (
          <li key={tag.id}>
            <button
              className="rounded-full border border-line px-2 py-0.5 text-xs"
              style={{ background: tag.color ? `${tag.color}33` : undefined }}
              onClick={(event) => searchForTag(tag.id, event.metaKey || event.ctrlKey)}
            >
              {tag.name}
              {tag.present < tag.total ? ` ${tag.present}/${tag.total}` : ''}
            </button>
          </li>
        ))}
        {summary.length === 0 && <li className="text-xs text-muted">No direct tags</li>}
      </ul>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label={`Find a tag for ${title}`}
        placeholder="Find or create a tag"
        className="mt-2 w-full rounded-lg border border-line px-2 py-1 text-sm outline-none"
      />
      <label className="mt-1 flex items-center gap-1 text-xs text-muted">
        <input
          type="checkbox"
          checked={includeArchived}
          onChange={(event) => setIncludeArchived(event.target.checked)}
        />
        Show archived
      </label>
      <ul className="mt-1 max-h-32 overflow-auto">
        {suggestions.map((tag) => (
          <li key={tag.id}>
            <label className="flex items-center gap-2 py-0.5 text-sm">
              <input
                type="checkbox"
                checked={chosen.includes(tag.id)}
                onChange={(event) =>
                  setChosen((current) =>
                    event.target.checked
                      ? [...current, tag.id]
                      : current.filter((id) => id !== tag.id)
                  )
                }
              />
              <span>{tag.name}</span>
              {tag.archived && <span className="text-xs text-muted">archived</span>}
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap gap-1">
        <button
          className="rounded-lg border border-line px-2 py-1 text-xs"
          onClick={() => void apply('add')}
        >
          Add
        </button>
        <button
          className="rounded-lg border border-line px-2 py-1 text-xs"
          onClick={() => void apply('remove')}
        >
          Remove
        </button>
        <button
          className="rounded-lg border border-line px-2 py-1 text-xs"
          onClick={() => void apply('replace')}
        >
          Replace
        </button>
        <button
          className="rounded-lg border border-line px-2 py-1 text-xs"
          onClick={() =>
            void window.api
              .invoke('tags:create', query)
              .then(async (tag) => {
                await addTags([tag.id], targets)
                setQuery('')
                await reload()
              })
              .catch(reportError)
          }
        >
          Create reusable
        </button>
        {single && (
          <button
            className="rounded-lg border border-line px-2 py-1 text-xs"
            onClick={() =>
              void createOneOff(query, targets[0])
                .then(async () => {
                  setQuery('')
                  await reload()
                })
                .catch(reportError)
            }
          >
            Create one-off
          </button>
        )}
      </div>
    </div>
  )
}
