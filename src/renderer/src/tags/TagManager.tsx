import { useEffect, useState } from 'react'
import type { TagRecord, TagTarget } from '@shared/types'
import { reportError } from '../store/projectStore'
import { TagEditor } from './TagEditor'
import { searchForTag } from './tagActions'

interface EditorRequest {
  title: string
  targets: TagTarget[]
  inherited?: { id: string; name: string }[]
}

export function TagDialogs() {
  const [manager, setManager] = useState(false)
  const [editor, setEditor] = useState<EditorRequest | null>(null)

  useEffect(() => {
    const openManager = () => setManager(true)
    const openEditor = (event: Event) => {
      setEditor((event as CustomEvent<EditorRequest>).detail)
    }
    window.addEventListener('cw-tag-manager', openManager)
    window.addEventListener('cw-tag-editor', openEditor)
    return () => {
      window.removeEventListener('cw-tag-manager', openManager)
      window.removeEventListener('cw-tag-editor', openEditor)
    }
  }, [])

  return (
    <>
      {manager && <TagManager onClose={() => setManager(false)} />}
      {editor && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 p-8">
          <div
            role="dialog"
            aria-label={editor.title}
            className="w-full max-w-md rounded-xl border border-line bg-surface p-4 shadow-lg"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">{editor.title}</h2>
              <button className="text-sm text-muted" onClick={() => setEditor(null)}>
                Close
              </button>
            </div>
            <TagEditor targets={editor.targets} title={editor.title} inherited={editor.inherited} />
          </div>
        </div>
      )}
    </>
  )
}

export function openTagEditor(request: EditorRequest): void {
  window.dispatchEvent(new CustomEvent('cw-tag-editor', { detail: request }))
}

export function openTagManager(): void {
  window.dispatchEvent(new CustomEvent('cw-tag-manager'))
}

function TagManager({ onClose }: { onClose: () => void }) {
  const [tags, setTags] = useState<TagRecord[]>([])
  const [oneOffs, setOneOffs] = useState<TagRecord[]>([])
  const [name, setName] = useState('')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [mergeInto, setMergeInto] = useState('')

  const reload = async () => {
    const [listed, singles] = await Promise.all([
      window.api.invoke('tags:list', { includeArchived }),
      window.api.invoke('tags:oneOffs')
    ])
    setTags(listed)
    setOneOffs(singles)
  }

  useEffect(() => {
    let cancel = false
    void Promise.all([
      window.api.invoke('tags:list', { includeArchived }),
      window.api.invoke('tags:oneOffs')
    ]).then(([listed, singles]) => {
      if (cancel) return
      setTags(listed)
      setOneOffs(singles)
    })
    return () => {
      cancel = true
    }
  }, [includeArchived])

  const run = (work: () => Promise<unknown>) => void work().then(reload).catch(reportError)

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 p-8">
      <div
        role="dialog"
        aria-label="Tag manager"
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-line bg-surface p-4 shadow-lg"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Tag manager</h2>
          <button className="text-sm text-muted" onClick={onClose}>
            Close
          </button>
        </div>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            run(() => window.api.invoke('tags:create', name).then(() => setName('')))
          }}
        >
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="New tag name"
            placeholder="New reusable tag"
            className="min-w-0 flex-1 rounded-lg border border-line px-2 py-1 text-sm outline-none"
          />
          <button className="rounded-lg border border-line px-2 py-1 text-sm">Create</button>
        </form>
        <label className="mt-2 flex items-center gap-1 text-xs text-muted">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => setIncludeArchived(event.target.checked)}
          />
          Show archived
        </label>
        <ul className="mt-2 min-h-0 flex-1 overflow-auto">
          {tags.map((tag) => (
            <li key={tag.id} className="border-b border-line py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <button className="truncate text-left" onClick={() => searchForTag(tag.id)}>
                  {tag.name}
                  <span className="ml-2 text-xs text-muted">{tag.assignmentCount} uses</span>
                  {tag.archived && <span className="ml-2 text-xs text-muted">archived</span>}
                </button>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                <button
                  className="text-xs text-muted"
                  onClick={() => {
                    const next = window.prompt('Rename tag', tag.name)
                    if (next) run(() => window.api.invoke('tags:rename', tag.id, next))
                  }}
                >
                  Rename
                </button>
                <button
                  className="text-xs text-muted"
                  onClick={() => {
                    const next = window.prompt('Color as #RRGGBB, or blank', tag.color ?? '')
                    if (next != null)
                      run(() => window.api.invoke('tags:recolor', tag.id, next || null))
                  }}
                >
                  Color
                </button>
                <button
                  className="text-xs text-muted"
                  onClick={() =>
                    run(() =>
                      tag.archived
                        ? window.api.invoke('tags:unarchive', tag.id)
                        : window.api.invoke('tags:archive', tag.id)
                    )
                  }
                >
                  {tag.archived ? 'Unarchive' : 'Archive'}
                </button>
                <button
                  className="text-xs text-muted"
                  onClick={() => {
                    if (
                      window.confirm(
                        `Move “${tag.name}” to Tag Trash? It is on ${tag.assignmentCount} items.`
                      )
                    ) {
                      run(() => window.api.invoke('tags:trash', tag.id))
                    }
                  }}
                >
                  Trash
                </button>
                <button className="text-xs text-muted" onClick={() => searchForTag(tag.id)}>
                  View all uses
                </button>
              </div>
              <div className="mt-1 flex gap-1">
                <select
                  aria-label={`Merge ${tag.name} into`}
                  value={mergeInto}
                  onChange={(event) => setMergeInto(event.target.value)}
                  className="rounded border border-line text-xs"
                >
                  <option value="">Merge into…</option>
                  {tags
                    .filter((other) => other.id !== tag.id && !other.archived)
                    .map((other) => (
                      <option key={other.id} value={other.id}>
                        {other.name}
                      </option>
                    ))}
                </select>
                <button
                  className="text-xs text-muted"
                  onClick={() => {
                    if (!mergeInto) return
                    const destination = tags.find((other) => other.id === mergeInto)
                    if (
                      destination &&
                      window.confirm(
                        `Merge “${tag.name}” (${tag.assignmentCount}) into “${destination.name}” (${destination.assignmentCount})?`
                      )
                    ) {
                      run(() => window.api.invoke('tags:merge', tag.id, mergeInto))
                    }
                  }}
                >
                  Merge
                </button>
              </div>
            </li>
          ))}
        </ul>
        {oneOffs.length > 0 && (
          <>
            <h3 className="mt-3 text-xs font-medium text-muted">One-off tags</h3>
            <ul>
              {oneOffs.map((tag) => (
                <li key={tag.id} className="flex items-center justify-between py-1 text-sm">
                  <span>{tag.name}</span>
                  <button
                    className="text-xs text-muted"
                    onClick={() =>
                      void window.api
                        .invoke('tags:promote', tag.id)
                        .then(async (result) => {
                          if (result.status === 'use-existing') {
                            if (
                              window.confirm(
                                `“${result.existing.name}” already exists. Use that tag?`
                              )
                            ) {
                              await window.api.invoke('tags:promote', tag.id, { useExisting: true })
                            }
                            return
                          }
                          if (result.status === 'trashed-exists') {
                            if (
                              window.confirm(
                                `“${result.existing.name}” is in Tag Trash. Restore that tag and use it?`
                              )
                            ) {
                              await window.api.invoke('tags:promote', tag.id, {
                                restoreTrashed: true
                              })
                            }
                            return
                          }
                        })
                        .then(reload)
                        .catch(reportError)
                    }
                  >
                    Promote
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}

export function TagTrash() {
  const [tags, setTags] = useState<TagRecord[]>([])
  const reload = () =>
    void window.api.invoke('tags:list', { trash: true }).then(setTags).catch(reportError)
  useEffect(() => {
    reload()
  }, [])
  return (
    <ul className="min-h-0 flex-1 overflow-auto px-3">
      {tags.length === 0 && <li className="py-4 text-sm text-muted">Tag Trash is empty</li>}
      {tags.map((tag) => (
        <li
          key={tag.id}
          className="flex items-center justify-between border-b border-line py-2 text-sm"
        >
          <span>
            {tag.name}
            <span className="ml-2 text-xs text-muted">{tag.assignmentCount} assignments</span>
          </span>
          <span className="flex gap-2">
            <button
              className="text-xs"
              onClick={() =>
                void window.api
                  .invoke('tags:restore', tag.id)
                  .then(async (result) => {
                    if (result.status === 'name-taken') {
                      const next = window.prompt(
                        `“${tag.name}” is already used. Restore as this name, or cancel.`,
                        result.suggestedName
                      )
                      if (!next) return
                      const renamed = await window.api.invoke('tags:restore', tag.id, next)
                      if (renamed.status === 'name-taken') {
                        reportError(new Error('That name is also taken. Nothing was restored.'))
                      }
                    }
                  })
                  .then(reload)
                  .catch(reportError)
              }
            >
              Restore
            </button>
            <button
              className="text-xs text-red-700"
              onClick={() => {
                if (
                  window.confirm(
                    `Permanently delete “${tag.name}” and remove it from ${tag.assignmentCount} items?`
                  )
                ) {
                  void window.api.invoke('tags:purge', tag.id).then(reload).catch(reportError)
                }
              }}
            >
              Delete forever
            </button>
          </span>
        </li>
      ))}
    </ul>
  )
}
