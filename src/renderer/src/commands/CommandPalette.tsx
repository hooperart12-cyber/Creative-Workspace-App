import { Command } from 'cmdk'
import { useEffect, useState } from 'react'
import type { SearchHit } from '@shared/types'
import { isEditingNote } from '../notes/noteStore'
import { useCanvasStore } from '../store/canvasStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { availableCommands } from './registry'
import { openSearchHit } from '../search/openHit'

const RECENT = 'cw-recent-commands'

function free(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null
  if (target?.closest('input, textarea, select, [contenteditable="true"]')) return false
  if (isEditingNote()) return false
  if (useWorkspaceStore.getState().dialog) return false
  const canvas = useCanvasStore.getState()
  if (canvas.pdfReaderId || canvas.pdfAsset || canvas.viewerObjectId || canvas.fileDetailsId)
    return false
  return true
}

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<{ query: string; hits: SearchHit[] }>({ query: '', hits: [] })
  const hits = open && found.query === query ? found.hits : []
  const openSearch = useWorkspaceStore((s) => s.openSearch)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!free(event)) return
      const mod = event.ctrlKey || event.metaKey
      if (mod && event.shiftKey && event.code === 'KeyF') {
        event.preventDefault()
        openSearch()
      } else if (mod && event.code === 'KeyK') {
        event.preventDefault()
        setOpen(true)
      } else if (mod && event.code === 'Slash') {
        event.preventDefault()
        document.dispatchEvent(new CustomEvent('cw-shortcuts'))
      }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    document.addEventListener('cw-palette', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('cw-palette', onOpen)
    }
  }, [openSearch])

  useEffect(() => {
    if (!open || query.trim().length < 2) return
    const timer = setTimeout(() => {
      void window.api
        .invoke('search:query', { text: query, filter: 'all' })
        .then((page) => setFound({ query, hits: page.hits.slice(0, 8) }))
    }, 150)
    return () => clearTimeout(timer)
  }, [open, query])

  const run = (id: string, action: () => void) => {
    const recent = JSON.parse(localStorage.getItem(RECENT) ?? '[]') as string[]
    localStorage.setItem(
      RECENT,
      JSON.stringify([id, ...recent.filter((item) => item !== id)].slice(0, 5))
    )
    setOpen(false)
    action()
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command palette"
      overlayClassName="fixed inset-0 bg-black/30"
      contentClassName="fixed inset-0 z-50 flex items-start justify-center pt-24"
    >
      <div className="w-[32rem] max-w-[calc(100%-2rem)] overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Commands, boards, and files"
          aria-label="Command palette"
          className="w-full border-b border-line bg-transparent px-4 py-3 text-sm outline-none"
        />
        <Command.List className="max-h-80 overflow-auto p-2">
          <Command.Empty className="px-2 py-3 text-sm text-muted">No matches</Command.Empty>
          <Command.Group heading="Commands" className="text-xs text-muted">
            {availableCommands().map((command) => (
              <Command.Item
                key={command.id}
                value={`${command.title} ${command.group}`}
                onSelect={() => run(command.id, command.run)}
                className="flex cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 text-sm aria-selected:bg-canvas"
              >
                <span>{command.title}</span>
                {command.shortcut && <span className="text-xs text-muted">{command.shortcut}</span>}
              </Command.Item>
            ))}
          </Command.Group>
          {hits.length > 0 && (
            <Command.Group heading="In this project" className="text-xs text-muted">
              {hits.map((hit) => (
                <Command.Item
                  key={`${hit.kind}:${hit.sourceId}`}
                  value={`${hit.title} ${hit.location}`}
                  onSelect={() => run(hit.sourceId, () => void openSearchHit(hit, query))}
                  className="flex cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 text-sm aria-selected:bg-canvas"
                >
                  <span className="truncate">{hit.title}</span>
                  <span className="ml-3 shrink-0 text-xs text-muted">{hit.kind}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
          {query.trim() && (
            <Command.Item
              value={`search everything ${query}`}
              onSelect={() => run('search-query', () => openSearch())}
              className="rounded-lg px-2 py-1.5 text-sm aria-selected:bg-canvas"
            >
              Search the whole project for “{query}”
            </Command.Item>
          )}
        </Command.List>
      </div>
    </Command.Dialog>
  )
}
