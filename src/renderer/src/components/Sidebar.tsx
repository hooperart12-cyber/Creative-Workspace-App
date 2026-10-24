import { useMemo, useState, type ReactNode } from 'react'
import type { BoardListItem, FolderListItem } from '@shared/types'
import { buildTree, type TreeNode } from '../lib/tree'
import { useWorkspaceStore } from '../store/workspaceStore'
import { EditableTitle } from './EditableTitle'
import { BoardIcon, ChevronRight, FolderIcon, Plus } from './icons'
import { ItemMenu } from './ItemMenu'

export function Sidebar() {
  const tree = useWorkspaceStore((s) => s.tree)
  const createFolder = useWorkspaceStore((s) => s.createFolder)
  const createBoard = useWorkspaceStore((s) => s.createBoard)
  const currentBoardId = useWorkspaceStore((s) => s.board?.id)

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
        onAdd={() => currentBoardId && void createBoard(currentBoardId)}
      >
        {boardRoots.map((node) => (
          <BoardRow key={node.item.id} node={node} depth={0} />
        ))}
      </Section>

      <Section
        title="Library folders"
        addLabel="New library folder"
        onAdd={() => void createFolder(null)}
      >
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
  children
}: {
  title: string
  addLabel: string
  onAdd: () => void
  children: ReactNode
}) {
  return (
    <section className="mb-4">
      <header className="flex items-center justify-between px-4 pb-1">
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
  onClick,
  icon,
  label
}: {
  depth: number
  hasChildren: boolean
  expanded: boolean
  onToggle: () => void
  active: boolean
  onClick: () => void
  icon: ReactNode
  label: ReactNode
}) {
  return (
    <div
      role="treeitem"
      aria-selected={active}
      aria-expanded={hasChildren ? expanded : undefined}
      onClick={onClick}
      style={{ paddingLeft: 8 + depth * 14 }}
      className={`flex cursor-default items-center gap-1 py-1 pr-3 ${
        active ? 'bg-accent/10 text-accent' : 'hover:bg-canvas'
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
  const renameBoard = useWorkspaceStore((s) => s.renameBoard)
  const setRenaming = useWorkspaceStore((s) => s.setRenaming)

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
  const selectFolder = useWorkspaceStore((s) => s.selectFolder)
  const renameFolder = useWorkspaceStore((s) => s.renameFolder)
  const setRenaming = useWorkspaceStore((s) => s.setRenaming)

  return (
    <li>
      <ItemMenu target={{ type: 'folder', id: node.item.id }} source="sidebar">
        <div>
          <Row
            depth={depth}
            hasChildren={node.children.length > 0}
            expanded={expanded}
            onToggle={() => setExpanded(!expanded)}
            active={active}
            onClick={() => selectFolder(node.item.id)}
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
      {expanded && node.children.length > 0 && (
        <ul role="group">
          {node.children.map((child) => (
            <FolderRow key={child.item.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}
