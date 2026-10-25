import { useEffect, useMemo, useState } from 'react'
import { AlertDialog, Dialog } from 'radix-ui'
import type { DuplicatePolicy, FolderDeletePreview } from '@shared/types'
import * as actions from '../canvas/actions'
import {
  dissolveFolder,
  importLibraryFiles,
  importLibraryTree,
  trashFolder
} from '../library/libraryActions'
import { buildTree, descendantIds, flattenTree } from '../lib/tree'
import { useWorkspaceStore, type ItemRef } from '../store/workspaceStore'
import { BoardIcon, FolderIcon } from './icons'

const overlay = 'fixed inset-0 z-40 bg-black/30'
const panel =
  'fixed top-1/2 left-1/2 z-50 w-[28rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-surface p-5 shadow-xl'
const button = 'rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-canvas'

export function WorkspaceDialogs() {
  const dialog = useWorkspaceStore((s) => s.dialog)
  const setDialog = useWorkspaceStore((s) => s.setDialog)
  const close = (open: boolean) => !open && setDialog(null)

  return (
    <>
      <Dialog.Root open={dialog?.kind === 'move'} onOpenChange={close}>
        {dialog?.kind === 'move' && <MoveDialog target={dialog.target} />}
      </Dialog.Root>
      <AlertDialog.Root open={dialog?.kind === 'delete'} onOpenChange={close}>
        {dialog?.kind === 'delete' && <DeleteDialog target={dialog.target} />}
      </AlertDialog.Root>
      <Dialog.Root open={dialog?.kind === 'import'} onOpenChange={close}>
        {dialog?.kind === 'import' && <ImportDialog />}
      </Dialog.Root>
    </>
  )
}

function useItemName(target: ItemRef): string {
  return useWorkspaceStore((s) =>
    target.type === 'board'
      ? (s.tree?.boards.find((b) => b.id === target.id)?.title ?? '')
      : (s.tree?.folders.find((f) => f.id === target.id)?.name ?? '')
  )
}

function MoveDialog({ target }: { target: ItemRef }) {
  const tree = useWorkspaceStore((s) => s.tree)
  const { moveFolder } = useWorkspaceStore.getState()
  const name = useItemName(target)
  const [destination, setDestination] = useState<string | null | undefined>(undefined)

  const { options, currentParent } = useMemo(() => {
    if (!tree) return { options: [], currentParent: undefined }
    if (target.type === 'board') {
      const excluded = descendantIds(tree.boards, (b) => b.parentBoardId, target.id)
      excluded.add(target.id)
      const flat = flattenTree(buildTree(tree.boards, (b) => b.parentBoardId))
      return {
        options: flat
          .filter((n) => !excluded.has(n.item.id))
          .map((n) => ({ id: n.item.id as string | null, label: n.item.title, depth: n.depth })),
        currentParent: tree.boards.find((b) => b.id === target.id)?.parentBoardId
      }
    }
    const excluded = descendantIds(tree.folders, (f) => f.parentId, target.id)
    excluded.add(target.id)
    const flat = flattenTree(buildTree(tree.folders, (f) => f.parentId))
    return {
      options: [
        { id: null as string | null, label: 'Library (top level)', depth: 0 },
        ...flat
          .filter((n) => !excluded.has(n.item.id))
          .map((n) => ({ id: n.item.id as string | null, label: n.item.name, depth: n.depth + 1 }))
      ],
      currentParent: tree.folders.find((f) => f.id === target.id)?.parentId
    }
  }, [tree, target])

  const confirm = () => {
    if (destination === undefined) return
    if (target.type === 'board' && destination) void actions.moveBoard(target.id, destination)
    if (target.type === 'folder') void moveFolder(target.id, destination)
  }

  const Icon = target.type === 'board' ? BoardIcon : FolderIcon
  return (
    <Dialog.Portal>
      <Dialog.Overlay className={overlay} />
      <Dialog.Content className={panel} aria-describedby={undefined}>
        <Dialog.Title className="text-base font-medium">Move “{name}” to…</Dialog.Title>
        <ul
          role="listbox"
          aria-label="Destination"
          className="mt-4 max-h-72 overflow-y-auto rounded-lg border border-line py-1 text-sm"
        >
          {options.map((option) => {
            const isCurrent = option.id === currentParent
            const selected = option.id === destination
            return (
              <li key={option.id ?? 'root'}>
                <button
                  role="option"
                  aria-selected={selected}
                  disabled={isCurrent}
                  onClick={() => setDestination(option.id)}
                  onDoubleClick={() => !isCurrent && confirm()}
                  style={{ paddingLeft: 12 + option.depth * 16 }}
                  className={`flex w-full items-center gap-2 py-1.5 pr-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-inset disabled:opacity-40 ${
                    selected ? 'bg-accent/10 text-accent' : 'hover:bg-canvas'
                  }`}
                >
                  <Icon width={14} height={14} className="shrink-0" />
                  <span className="truncate">{option.label}</span>
                  {isCurrent && <span className="ml-auto text-xs">(current)</span>}
                </button>
              </li>
            )
          })}
        </ul>
        <div className="mt-5 flex justify-end gap-2">
          <Dialog.Close className={button}>Cancel</Dialog.Close>
          <button
            onClick={confirm}
            disabled={destination === undefined}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            Move
          </button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  )
}

function DeleteDialog({ target }: { target: ItemRef }) {
  const tree = useWorkspaceStore((s) => s.tree)
  const name = useItemName(target)
  const [preview, setPreview] = useState<FolderDeletePreview | null>(null)
  const [renameConflicts, setRenameConflicts] = useState(false)

  useEffect(() => {
    if (target.type !== 'folder') return
    let cancel = false
    void window.api.invoke('folder:deletePreview', target.id).then((next) => {
      if (!cancel) setPreview(next)
    })
    return () => {
      cancel = true
    }
  }, [target])

  const nestedCount = useMemo(() => {
    if (!tree || target.type !== 'board') return 0
    return descendantIds(tree.boards, (b) => b.parentBoardId, target.id).size
  }, [tree, target])

  if (target.type === 'folder') {
    const clashes = preview?.conflicts ?? []
    return (
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={overlay} />
        <AlertDialog.Content className={panel}>
          <AlertDialog.Title className="text-base font-medium">Delete “{name}”?</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-muted">
            {preview
              ? `${preview.entries} files and ${preview.folders} folders inside. ${
                  preview.boardCount > 0
                    ? `Files are on ${preview.boardCount} board${preview.boardCount === 1 ? '' : 's'}; those appearances stay.`
                    : 'Nothing in here is on a board.'
                }`
              : 'Checking what’s inside…'}
          </AlertDialog.Description>
          {clashes.length > 0 && (
            <label className="mt-3 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={renameConflicts}
                onChange={(e) => setRenameConflicts(e.target.checked)}
              />
              <span>
                Keep both. These names already exist and will gain “ (2)”: {clashes.join(', ')}
              </span>
            </label>
          )}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <AlertDialog.Cancel className={button}>Cancel</AlertDialog.Cancel>
            <AlertDialog.Action
              onClick={(event) => {
                if (clashes.length > 0 && !renameConflicts) {
                  event.preventDefault()
                  return
                }
                useWorkspaceStore.getState().setDialog(null)
                void dissolveFolder(target.id, renameConflicts)
              }}
              className={button}
            >
              Delete folder only
            </AlertDialog.Action>
            <AlertDialog.Action
              onClick={() => {
                useWorkspaceStore.getState().setDialog(null)
                void trashFolder(target.id)
              }}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
            >
              Trash folder and contents
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    )
  }

  return (
    <AlertDialog.Portal>
      <AlertDialog.Overlay className={overlay} />
      <AlertDialog.Content className={panel}>
        <AlertDialog.Title className="text-base font-medium">
          Move “{name}” to the trash?
        </AlertDialog.Title>
        <AlertDialog.Description className="mt-2 text-sm text-muted">
          {nestedCount > 0
            ? `This also moves the ${nestedCount} board${nestedCount === 1 ? '' : 's'} inside it. `
            : ''}
          You can undo this with Ctrl+Z. Restore boards from Trash.
        </AlertDialog.Description>
        <div className="mt-5 flex justify-end gap-2">
          <AlertDialog.Cancel className={button}>Cancel</AlertDialog.Cancel>
          <AlertDialog.Action
            onClick={() => void actions.deleteBoard(target.id)}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
          >
            Move to trash
          </AlertDialog.Action>
        </div>
      </AlertDialog.Content>
    </AlertDialog.Portal>
  )
}

function remembered<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const value = localStorage.getItem(key)
    return allowed.includes(value as T) ? (value as T) : fallback
  } catch {
    return fallback
  }
}

function ImportDialog() {
  const folders = useWorkspaceStore((s) => s.tree?.folders ?? [])
  const current = useWorkspaceStore((s) => s.libraryFolderId)
  const [folderId, setFolderId] = useState<string | null>(current)
  const [structure, setStructure] = useState<'preserve' | 'flatten'>(() =>
    remembered('cw-import-structure', 'preserve', ['preserve', 'flatten'] as const)
  )
  const [duplicates, setDuplicates] = useState<DuplicatePolicy>(() =>
    remembered('cw-import-duplicates', 'skip', ['skip', 'entry'] as const)
  )
  const close = () => useWorkspaceStore.getState().setDialog(null)
  const remember = () => {
    try {
      localStorage.setItem('cw-import-structure', structure)
      localStorage.setItem('cw-import-duplicates', duplicates)
    } catch {
      // The choice still applies to this import.
    }
  }
  const options = { folderId, duplicates }

  return (
    <Dialog.Portal>
      <Dialog.Overlay className={overlay} />
      <Dialog.Content className={panel}>
        <Dialog.Title className="text-base font-medium">Import into the library</Dialog.Title>
        <Dialog.Description className="mt-2 text-sm text-muted">
          Files are copied in. The originals you picked are left where they are. Nothing is placed
          on a board.
        </Dialog.Description>
        <label className="mt-4 block text-sm">
          Destination
          <select
            aria-label="Import destination"
            value={folderId ?? ''}
            onChange={(e) => setFolderId(e.target.value || null)}
            className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1"
          >
            <option value="">Library</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="mt-3 text-sm">
          <legend className="text-muted">Folders</legend>
          <label className="mt-1 flex gap-2">
            <input
              type="radio"
              name="structure"
              checked={structure === 'preserve'}
              onChange={() => setStructure('preserve')}
            />
            Keep folders
          </label>
          <label className="mt-1 flex gap-2">
            <input
              type="radio"
              name="structure"
              checked={structure === 'flatten'}
              onChange={() => setStructure('flatten')}
            />
            Put everything in the destination
          </label>
        </fieldset>
        <fieldset className="mt-3 text-sm">
          <legend className="text-muted">If the project already has the file</legend>
          <label className="mt-1 flex gap-2">
            <input
              type="radio"
              name="duplicates"
              checked={duplicates === 'skip'}
              onChange={() => setDuplicates('skip')}
            />
            Skip it
          </label>
          <label className="mt-1 flex gap-2">
            <input
              type="radio"
              name="duplicates"
              checked={duplicates === 'entry'}
              onChange={() => setDuplicates('entry')}
            />
            Add another entry
          </label>
        </fieldset>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Dialog.Close className={button}>Cancel</Dialog.Close>
          <button
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white"
            onClick={() => {
              remember()
              close()
              void window.api.invoke('dialog:pickFiles').then((paths) => {
                if (paths.length) void importLibraryFiles(paths, options)
              })
            }}
          >
            Choose files
          </button>
          <button
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white"
            onClick={() => {
              remember()
              close()
              void window.api.invoke('dialog:pickFolder').then((root) => {
                if (root) void importLibraryTree(root, { ...options, structure })
              })
            }}
          >
            Choose folder
          </button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  )
}
