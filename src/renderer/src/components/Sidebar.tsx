import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { BoardListItem, FolderListItem, LibraryEntry } from '@shared/types'
import * as actions from '../canvas/actions'
import { buildTree, descendantIds, type TreeNode } from '../lib/tree'
import { useCanvasStore } from '../store/canvasStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { EditableTitle } from './EditableTitle'
import { BoardIcon, ChevronRight, FolderIcon, Plus } from './icons'
import { CollectionSidebar } from '../collections/CollectionSidebar'
import { ItemMenu } from './ItemMenu'

const BOARD_MIME = 'application/x-cw-board'
const FOLDER_MIME = 'application/x-cw-folder'
const ENTRY_MIME = 'application/x-cw-entries'

/** The tree item being dragged in the sidebar (dataTransfer can't be read during dragover). */
let dragging: { type: 'board' | 'folder'; id: string } | null = null

/** Can the item being dragged be dropped onto this board/folder (or the library root, null)? */
function canDrop(type: 'board' | 'folder', targetId: string | null): boolean {
  const tree = useWorkspaceStore.getState().tree
  if (!dragging || dragging.type !== type || !tree) return false
  if (dragging.id === targetId) return false
  if (type === 'board') {
    if (!targetId) return false
    const below = descendantIds(tree.boards, (b) => b.parentBoardId, dragging.id)
    const current = tree.boards.find((b) => b.id === dragging!.id)?.parentBoardId
    return !below.has(targetId) && current !== targetId
  }
  const below = descendantIds(tree.folders, (f) => f.parentId, dragging.id)
  const current = tree.folders.find((f) => f.id === dragging!.id)?.parentId ?? null
  return (targetId === null || !below.has(targetId)) && current !== targetId
}

/** Drag-and-drop handlers for a sidebar row (or the library header when `targetId` is null). */
function useTreeDrop(type: 'board' | 'folder', targetId: string | null) {
  const [over, setOver] = useState(false)
  return {
    over,
    handlers: {
      onDragOver: (e: React.DragEvent) => {
        if (!canDrop(type, targetId)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setOver(true)
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: React.DragEvent) => {
        setOver(false)
        if (!canDrop(type, targetId)) return
        e.preventDefault()
        const id = dragging!.id
        dragging = null
        if (type === 'board') void actions.moveBoard(id, targetId!)
        else void useWorkspaceStore.getState().moveFolder(id, targetId)
      }
    }
  }
}

function dragSource(type: 'board' | 'folder', id: string) {
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      dragging = { type, id }
      e.dataTransfer.setData(type === 'board' ? BOARD_MIME : FOLDER_MIME, id)
      e.dataTransfer.effectAllowed = 'move'
    },
    onDragEnd: () => {
      dragging = null
    }
  }
}

export function Sidebar() {
  const tree = useWorkspaceStore((s) => s.tree)
  const createFolder = useWorkspaceStore((s) => s.createFolder)
  const libraryDrop = useTreeDrop('folder', null)
  const filter = useWorkspaceStore((s) => s.sidebarFilter)
  const setSidebarFilter = useWorkspaceStore((s) => s.setSidebarFilter)
  const openLibrary = useWorkspaceStore((s) => s.openLibrary)

  const boardRoots = useMemo(
    () => buildTree(tree?.boards ?? [], (b) => b.parentBoardId),
    [tree?.boards]
  )
  const folderRoots = useMemo(
    () => buildTree(tree?.folders ?? [], (f) => f.parentId),
    [tree?.folders]
  )

  return (
    <nav
      aria-label="Project navigation"
      className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface py-3 text-sm"
    >
      <Section
        title="Boards"
        addLabel="New board on the current board"
        onAdd={() => void actions.createBoardOnCanvas()}
      >
        {boardRoots.map((node) => (
          <BoardRow key={node.item.id} node={node} depth={0} />
        ))}
      </Section>

      <CollectionSidebar />

      <Section
        title="Library folders"
        addLabel="New library folder"
        onAdd={() => void createFolder(null)}
        dropHighlight={libraryDrop.over}
        dropHandlers={libraryDrop.handlers}
      >
        <li className="px-3 pb-1">
          <input
            value={filter}
            onChange={(e) => setSidebarFilter(e.target.value)}
            placeholder="Filter"
            aria-label="Filter library"
            className="w-full rounded border border-line bg-canvas px-2 py-1 text-xs"
          />
        </li>
        <li>
          <button
            type="button"
            onClick={() => openLibrary(null)}
            className="w-full px-4 py-1 text-left text-xs text-muted hover:bg-canvas hover:text-ink"
          >
            Open library
          </button>
        </li>
        <EntryList folderId={null} depth={0} />
        {folderRoots.length === 0 ? (
          <p className="px-4 py-1 text-xs text-muted">
            Folders organize imported images and files.
          </p>
        ) : (
          folderRoots.map((node) => <FolderRow key={node.item.id} node={node} depth={0} />)
        )}
      </Section>
    </nav>
  )
}

function Section({
  title,
  addLabel,
  onAdd,
  children,
  dropHighlight,
  dropHandlers
}: {
  title: string
  addLabel: string
  onAdd: () => void
  children: ReactNode
  dropHighlight?: boolean
  dropHandlers?: React.HTMLAttributes<HTMLElement>
}) {
  return (
    <section className="mb-4">
      <header
        {...dropHandlers}
        title={dropHandlers ? 'Drop a folder here to move it to the top level' : undefined}
        className={`flex items-center justify-between px-4 pb-1 ${dropHighlight ? 'bg-accent/10' : ''}`}
      >
        <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">{title}</h2>
        <button
          onClick={onAdd}
          title={addLabel}
          aria-label={addLabel}
          className="rounded p-0.5 text-muted hover:bg-canvas hover:text-ink"
        >
          <Plus />
        </button>
      </header>
      <ul role="tree">{children}</ul>
    </section>
  )
}

function Row({
  depth,
  hasChildren,
  expanded,
  onToggle,
  active,
  dropHighlight,
  onClick,
  icon,
  label,
  extra
}: {
  depth: number
  hasChildren: boolean
  expanded: boolean
  onToggle: () => void
  active: boolean
  dropHighlight?: boolean
  onClick: () => void
  icon: ReactNode
  label: ReactNode
  extra?: React.HTMLAttributes<HTMLDivElement> & Record<string, unknown>
}) {
  return (
    <div
      role="treeitem"
      aria-selected={active}
      aria-expanded={hasChildren ? expanded : undefined}
      onClick={onClick}
      style={{ paddingLeft: 8 + depth * 14 }}
      {...extra}
      className={`flex cursor-default items-center gap-1 py-1 pr-3 ${
        dropHighlight
          ? 'bg-accent/15 text-accent ring-2 ring-accent ring-inset'
          : active
            ? 'bg-accent/10 text-accent'
            : 'hover:bg-canvas'
      }`}
    >
      <button
        tabIndex={-1}
        aria-label={expanded ? 'Collapse' : 'Expand'}
        onClick={(e) => {
          e.stopPropagation()
          onToggle()
        }}
        className={`rounded p-0.5 text-muted ${hasChildren ? '' : 'invisible'}`}
      >
        <ChevronRight
          width={12}
          height={12}
          className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
      </button>
      <span className="shrink-0 text-muted">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </div>
  )
}

function BoardRow({ node, depth }: { node: TreeNode<BoardListItem>; depth: number }) {
  const [expanded, setExpanded] = useState(true)
  const active = useWorkspaceStore((s) => s.board?.id === node.item.id)
  const renaming = useWorkspaceStore(
    (s) =>
      s.renaming?.type === 'board' &&
      s.renaming.id === node.item.id &&
      s.renaming.source === 'sidebar'
  )
  const openBoard = useWorkspaceStore((s) => s.openBoard)
  const setRenaming = useWorkspaceStore((s) => s.setRenaming)
  const isMain = useWorkspaceStore((s) => s.tree?.mainBoardId === node.item.id)
  // Canvas cards dragged over this row (data-drop-board-id), or a sidebar board dragged here.
  const canvasDropHere = useCanvasStore((s) => s.drag?.dropBoardId === node.item.id)
  const treeDrop = useTreeDrop('board', node.item.id)
  const renameBoard = actions.renameBoard

  return (
    <li>
      <ItemMenu target={{ type: 'board', id: node.item.id }} source="sidebar">
        <div>
          <Row
            depth={depth}
            hasChildren={node.children.length > 0}
            expanded={expanded}
            onToggle={() => setExpanded(!expanded)}
            active={active}
            dropHighlight={canvasDropHere || treeDrop.over}
            extra={{
              'data-drop-board-id': node.item.id,
              ...treeDrop.handlers,
              ...(isMain || renaming ? {} : dragSource('board', node.item.id))
            }}
            onClick={() => void openBoard(node.item.id)}
            icon={<BoardIcon width={14} height={14} />}
            label={
              renaming ? (
                <EditableTitle
                  value={node.item.title}
                  ariaLabel="Board name"
                  onCommit={(v) => void renameBoard(node.item.id, v)}
                  onCancel={() => setRenaming(null)}
                />
              ) : (
                node.item.title
              )
            }
          />
        </div>
      </ItemMenu>
      {expanded && node.children.length > 0 && (
        <ul role="group">
          {node.children.map((child) => (
            <BoardRow key={child.item.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}

function FolderRow({ node, depth }: { node: TreeNode<FolderListItem>; depth: number }) {
  const [expanded, setExpanded] = useState(true)
  const active = useWorkspaceStore((s) => s.selectedFolderId === node.item.id)
  const renaming = useWorkspaceStore(
    (s) => s.renaming?.type === 'folder' && s.renaming.id === node.item.id
  )
  const openLibrary = useWorkspaceStore((s) => s.openLibrary)
  const renameFolder = useWorkspaceStore((s) => s.renameFolder)
  const setRenaming = useWorkspaceStore((s) => s.setRenaming)
  const treeDrop = useTreeDrop('folder', node.item.id)

  return (
    <li>
      <ItemMenu target={{ type: 'folder', id: node.item.id }} source="sidebar">
        <div>
          <Row
            depth={depth}
            hasChildren
            expanded={expanded}
            onToggle={() => setExpanded(!expanded)}
            active={active}
            dropHighlight={treeDrop.over}
            extra={{
              ...treeDrop.handlers,
              ...(renaming ? {} : dragSource('folder', node.item.id))
            }}
            onClick={() => openLibrary(node.item.id)}
            icon={<FolderIcon width={14} height={14} />}
            label={
              renaming ? (
                <EditableTitle
                  value={node.item.name}
                  ariaLabel="Folder name"
                  onCommit={(v) => void renameFolder(node.item.id, v)}
                  onCancel={() => setRenaming(null)}
                />
              ) : (
                node.item.name
              )
            }
          />
        </div>
      </ItemMenu>
      {expanded && (
        <ul role="group">
          <EntryList folderId={node.item.id} depth={depth + 1} />
          {node.children.map((child) => (
            <FolderRow key={child.item.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}

function EntryList({ folderId, depth }: { folderId: string | null; depth: number }) {
  const filter = useWorkspaceStore((s) => s.sidebarFilter)
  const epoch = useWorkspaceStore((s) => s.sidebarEpoch)
  const openLibrary = useWorkspaceStore((s) => s.openLibrary)
  const [entries, setEntries] = useState<LibraryEntry[]>([])
  const [more, setMore] = useState(0)

  useEffect(() => {
    let cancel = false
    void window.api
      .invoke('library:list', {
        folderId,
        scope: 'folder',
        direct: true,
        query: filter,
        sort: 'name',
        direction: 'asc',
        limit: 40
      })
      .then((page) => {
        if (cancel) return
        setEntries(page.entries)
        setMore(Math.max(0, page.total - page.entries.length))
      })
      .catch(() => {})
    return () => {
      cancel = true
    }
  }, [folderId, filter, epoch])

  if (entries.length === 0) return null
  return (
    <>
      {entries.map((entry) => (
        <li key={entry.id}>
          <button
            type="button"
            draggable
            aria-label={entry.name}
            onClick={() => openLibrary(folderId, entry.id)}
            onDragStart={(event) => {
              event.dataTransfer.setData(
                ENTRY_MIME,
                JSON.stringify([{ id: entry.id, assetId: entry.assetId }])
              )
              event.dataTransfer.effectAllowed = 'copy'
            }}
            style={{ paddingLeft: 8 + depth * 14 }}
            className="flex w-full items-center gap-2 py-1 pr-3 text-left hover:bg-canvas"
          >
            <span className="w-4 shrink-0 text-[10px] text-muted uppercase">{entry.asset.ext}</span>
            <span className="truncate">{entry.name}</span>
          </button>
        </li>
      ))}
      {more > 0 && (
        <li className="px-4 py-1 text-xs text-muted" style={{ paddingLeft: 8 + depth * 14 }}>
          {more} more in the library
        </li>
      )}
    </>
  )
}
