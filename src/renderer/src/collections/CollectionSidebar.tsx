import { useEffect, useState } from 'react'
import type { CollectionOrderMode } from '@shared/collectionOrder'
import { orderCollectionItems } from '@shared/collectionOrder'
import type {
  CollectionOutline,
  CollectionOutlineFolder,
  CollectionOutlineItem,
  CollectionTemplateInfo
} from '@shared/collections'
import { EditableTitle } from '../components/EditableTitle'
import { ChevronRight, FolderIcon, Plus } from '../components/icons'
import { descendantIds } from '../lib/tree'
import { reportError, showNotice } from '../store/projectStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { NewCollectionDialog, TemplateEditor } from './NewCollectionDialog'

const FOLDER_MIME = 'application/x-cw-collection-folder'
const COLLECTION_MIME = 'application/x-cw-collection'

let dragging: { kind: 'folder' | 'collection'; id: string; folderId: string | null } | null = null

const asOrdered = {
  folder: (folder: CollectionOutlineFolder) => ({
    ...folder,
    label: folder.name
  }),
  collection: (collection: CollectionOutlineItem) => ({
    ...collection,
    label: collection.title
  })
}

export function CollectionSidebar() {
  const epoch = useWorkspaceStore((s) => s.sidebarEpoch)
  const openPlanner = useWorkspaceStore((s) => s.openPlanner)
  const plannerId = useWorkspaceStore((s) =>
    s.surface === 'planner' ? s.plannerCollectionId : null
  )
  const [outline, setOutline] = useState<CollectionOutline>({ folders: [], collections: [] })
  const [templates, setTemplates] = useState<CollectionTemplateInfo[]>([])
  const [order, setOrder] = useState<CollectionOrderMode>('manual')
  const [dialog, setDialog] = useState<{
    folderId: string | null
    templateId: string | null
  } | null>(null)
  const [editing, setEditing] = useState<CollectionTemplateInfo | null>(null)
  const [renaming, setRenaming] = useState<{ kind: 'folder' | 'collection'; id: string } | null>(
    null
  )
  const [menu, setMenu] = useState<string | null>(null)

  useEffect(() => {
    let cancel = false
    void Promise.all([
      window.api.invoke('collections:outline'),
      window.api.invoke('collections:templates')
    ])
      .then(([nextOutline, nextTemplates]) => {
        if (cancel) return
        setOutline(nextOutline)
        setTemplates(nextTemplates)
      })
      .catch((error) => reportError(error))
    return () => {
      cancel = true
    }
  }, [epoch])

  const folders = orderCollectionItems(outline.folders.map(asOrdered.folder), order)
  const collections = orderCollectionItems(outline.collections.map(asOrdered.collection), order)
  const roots = folders.filter((folder) => folder.parentId == null)
  const rootCollections = collections.filter((collection) => collection.folderId == null)

  const createFolder = async (parentId: string | null) => {
    try {
      const created = await window.api.invoke(
        'collections:createFolder',
        parentId,
        'Untitled folder'
      )
      setRenaming({ kind: 'folder', id: created.id })
    } catch (error) {
      reportError(error)
    }
  }

  return (
    <section className="mb-4">
      <header className="px-4 pb-1">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">Collections</h2>
          <span className="flex gap-1">
            <button
              type="button"
              title="New collection folder"
              aria-label="New collection folder"
              className="rounded p-0.5 text-muted hover:bg-canvas hover:text-ink"
              onClick={() => void createFolder(null)}
            >
              <FolderIcon width={14} height={14} />
            </button>
            <button
              type="button"
              title="New collection"
              aria-label="New collection"
              className="rounded p-0.5 text-muted hover:bg-canvas hover:text-ink"
              onClick={() => setDialog({ folderId: null, templateId: null })}
            >
              <Plus />
            </button>
          </span>
        </div>
        <label className="mt-1 block">
          <select
            value={order}
            onChange={(event) => setOrder(event.target.value as CollectionOrderMode)}
            aria-label="Sort collections"
            className="w-full rounded border border-line bg-canvas px-2 py-1 text-xs"
          >
            <option value="manual">Manual order</option>
            <option value="name">Name</option>
            <option value="created">Date created</option>
            <option value="modified">Last modified</option>
          </select>
        </label>
      </header>
      <ul role="tree">
        <RootDrop order={order} />
        {roots.map((folder) => (
          <FolderBranch
            key={folder.id}
            folder={folder}
            folders={folders}
            collections={collections}
            depth={0}
            order={order}
            activeId={plannerId}
            renaming={renaming}
            menu={menu}
            onOpen={openPlanner}
            onRename={setRenaming}
            onMenu={setMenu}
            onCreateFolder={(parentId) => void createFolder(parentId)}
            onCreateCollection={(folderId) => setDialog({ folderId, templateId: null })}
          />
        ))}
        {rootCollections.map((collection) => (
          <CollectionRow
            key={collection.id}
            collection={collection}
            depth={0}
            order={order}
            active={plannerId === collection.id}
            renaming={renaming?.kind === 'collection' && renaming.id === collection.id}
            menuOpen={menu === collection.id}
            onOpen={() => openPlanner(collection.id, null)}
            onRename={() => setRenaming({ kind: 'collection', id: collection.id })}
            onRenamed={() => setRenaming(null)}
            onMenu={() => setMenu(menu === collection.id ? null : collection.id)}
          />
        ))}
        {roots.length === 0 && rootCollections.length === 0 && (
          <p className="px-4 py-1 text-xs text-muted">
            Collections live here. A canvas card is only one way to open one.
          </p>
        )}
      </ul>
      {templates.length > 0 && (
        <div className="mt-2 px-4">
          <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Templates</h3>
          <p className="py-1 text-xs text-muted">
            A starting point for a new collection. Editing one does not change collections you
            already made.
          </p>
          <ul>
            {templates.map((template) => (
              <li key={template.id} className="flex items-center gap-1 py-0.5">
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left text-xs hover:text-accent"
                  onClick={() => setDialog({ folderId: null, templateId: template.id })}
                >
                  {template.name}
                </button>
                <button
                  type="button"
                  className="text-xs text-muted hover:text-ink"
                  aria-label={`Edit ${template.name} template`}
                  onClick={() => setEditing(template)}
                >
                  Edit
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {dialog && (
        <NewCollectionDialog
          folderId={dialog.folderId}
          templateId={dialog.templateId}
          folders={outline.folders}
          templates={templates}
          onClose={() => setDialog(null)}
        />
      )}
      {editing && <TemplateEditor template={editing} onClose={() => setEditing(null)} />}
    </section>
  )
}

function RootDrop({ order }: { order: CollectionOrderMode }) {
  const [over, setOver] = useState(false)
  return (
    <li
      onDragOver={(event) => {
        if (!dragging) return
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        setOver(false)
        const current = dragging
        dragging = null
        if (!current) return
        event.preventDefault()
        const run =
          current.kind === 'folder'
            ? window.api.invoke('collections:moveFolder', current.id, null)
            : window.api.invoke('collections:move', current.id, null)
        void run.catch((error) => reportError(error))
      }}
      className={`mx-3 mb-1 rounded text-xs text-muted ${over ? 'bg-accent/10 text-accent' : ''}`}
    >
      {order === 'manual' ? 'Drop here for the top level' : 'Drop here to leave a folder'}
    </li>
  )
}

function FolderBranch({
  folder,
  folders,
  collections,
  depth,
  order,
  activeId,
  renaming,
  menu,
  onOpen,
  onRename,
  onMenu,
  onCreateFolder,
  onCreateCollection
}: {
  folder: CollectionOutlineFolder & { label: string }
  folders: (CollectionOutlineFolder & { label: string })[]
  collections: (CollectionOutlineItem & { label: string })[]
  depth: number
  order: CollectionOrderMode
  activeId: string | null
  renaming: { kind: 'folder' | 'collection'; id: string } | null
  menu: string | null
  onOpen: (id: string, pageId?: string | null) => void
  onRename: (target: { kind: 'folder' | 'collection'; id: string } | null) => void
  onMenu: (id: string | null) => void
  onCreateFolder: (parentId: string) => void
  onCreateCollection: (folderId: string) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const [over, setOver] = useState(false)
  const children = folders.filter((item) => item.parentId === folder.id)
  const inside = collections.filter((item) => item.folderId === folder.id)
  const canDrop = () => {
    if (!dragging || dragging.id === folder.id) return false
    if (dragging.kind === 'folder') {
      return !descendantIds(folders, (item) => item.parentId, dragging.id).has(folder.id)
    }
    return true
  }
  return (
    <li>
      <div
        role="treeitem"
        aria-expanded={expanded}
        style={{ paddingLeft: 8 + depth * 14 }}
        className={`flex items-center gap-1 py-1 pr-2 ${over ? 'bg-accent/15 text-accent' : 'hover:bg-canvas'}`}
        draggable={order === 'manual' && renaming?.id !== folder.id}
        onDragStart={(event) => {
          dragging = { kind: 'folder', id: folder.id, folderId: folder.parentId }
          event.dataTransfer.setData(FOLDER_MIME, folder.id)
          event.dataTransfer.effectAllowed = 'move'
        }}
        onDragEnd={() => {
          dragging = null
        }}
        onDragOver={(event) => {
          if (!canDrop()) return
          event.preventDefault()
          event.stopPropagation()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          setOver(false)
          const current = dragging
          dragging = null
          if (!current || !canDrop()) return
          event.preventDefault()
          event.stopPropagation()
          const run =
            current.kind === 'folder'
              ? window.api.invoke('collections:moveFolder', current.id, folder.id)
              : window.api.invoke('collections:move', current.id, folder.id)
          void run.catch((error) => reportError(error))
        }}
      >
        <button
          type="button"
          aria-label={expanded ? 'Collapse' : 'Expand'}
          className="rounded p-0.5 text-muted"
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronRight width={12} height={12} className={expanded ? 'rotate-90' : ''} />
        </button>
        <FolderIcon width={14} height={14} />
        {renaming?.kind === 'folder' && renaming.id === folder.id ? (
          <EditableTitle
            value={folder.name}
            ariaLabel="Collection folder name"
            onCommit={(value) => {
              void window.api
                .invoke('collections:renameFolder', folder.id, value)
                .catch((error) => reportError(error))
              onRename(null)
            }}
            onCancel={() => onRename(null)}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate">{folder.name}</span>
        )}
        <button
          type="button"
          aria-label={`Actions for ${folder.name}`}
          className="px-1 text-xs text-muted"
          onClick={() => onMenu(menu === folder.id ? null : folder.id)}
        >
          ···
        </button>
      </div>
      {menu === folder.id && (
        <div className="ml-8 flex flex-col py-1 text-xs" role="menu">
          <button
            type="button"
            className="px-2 py-1 text-left hover:bg-canvas"
            onClick={() => onRename({ kind: 'folder', id: folder.id })}
          >
            Rename
          </button>
          <button
            type="button"
            className="px-2 py-1 text-left hover:bg-canvas"
            onClick={() => onCreateFolder(folder.id)}
          >
            New folder inside
          </button>
          <button
            type="button"
            className="px-2 py-1 text-left hover:bg-canvas"
            onClick={() => onCreateCollection(folder.id)}
          >
            New collection here
          </button>
        </div>
      )}
      {expanded && (
        <ul role="group">
          {children.map((child) => (
            <FolderBranch
              key={child.id}
              folder={child}
              folders={folders}
              collections={collections}
              depth={depth + 1}
              order={order}
              activeId={activeId}
              renaming={renaming}
              menu={menu}
              onOpen={onOpen}
              onRename={onRename}
              onMenu={onMenu}
              onCreateFolder={onCreateFolder}
              onCreateCollection={onCreateCollection}
            />
          ))}
          {inside.map((collection) => (
            <CollectionRow
              key={collection.id}
              collection={collection}
              depth={depth + 1}
              order={order}
              active={activeId === collection.id}
              renaming={renaming?.kind === 'collection' && renaming.id === collection.id}
              menuOpen={menu === collection.id}
              onOpen={() => onOpen(collection.id, null)}
              onRename={() => onRename({ kind: 'collection', id: collection.id })}
              onRenamed={() => onRename(null)}
              onMenu={() => onMenu(menu === collection.id ? null : collection.id)}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function CollectionRow({
  collection,
  depth,
  order,
  active,
  renaming,
  menuOpen,
  onOpen,
  onRename,
  onRenamed,
  onMenu
}: {
  collection: CollectionOutlineItem
  depth: number
  order: CollectionOrderMode
  active: boolean
  renaming: boolean
  menuOpen: boolean
  onOpen: () => void
  onRename: () => void
  onRenamed: () => void
  onMenu: () => void
}) {
  const [over, setOver] = useState(false)
  return (
    <li>
      <div
        role="treeitem"
        aria-selected={active}
        style={{ paddingLeft: 28 + depth * 14 }}
        className={`flex items-center gap-1 py-1 pr-2 ${
          over ? 'bg-accent/15' : active ? 'bg-accent/10 text-accent' : 'hover:bg-canvas'
        }`}
        draggable={order === 'manual' && !renaming}
        onDragStart={(event) => {
          dragging = { kind: 'collection', id: collection.id, folderId: collection.folderId }
          event.dataTransfer.setData(COLLECTION_MIME, collection.id)
          event.dataTransfer.effectAllowed = 'move'
        }}
        onDragEnd={() => {
          dragging = null
        }}
        onDragOver={(event) => {
          if (
            order !== 'manual' ||
            dragging?.kind !== 'collection' ||
            dragging.id === collection.id
          ) {
            return
          }
          event.preventDefault()
          event.stopPropagation()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          setOver(false)
          const current = dragging
          dragging = null
          if (
            order !== 'manual' ||
            current?.kind !== 'collection' ||
            current.id === collection.id
          ) {
            return
          }
          event.preventDefault()
          event.stopPropagation()
          void (async () => {
            if (current.folderId !== collection.folderId) {
              await window.api.invoke('collections:move', current.id, collection.folderId)
            }
            await window.api.invoke('collections:reorder', 'collection', current.id, collection.id)
          })().catch((error) => reportError(error))
        }}
        onClick={onOpen}
      >
        <span className="min-w-0 flex-1 truncate">
          {renaming ? (
            <EditableTitle
              value={collection.title}
              ariaLabel="Collection name"
              onCommit={(value) => {
                void window.api
                  .invoke('collections:rename', collection.id, value)
                  .catch((error) => reportError(error))
                onRenamed()
              }}
              onCancel={onRenamed}
            />
          ) : (
            collection.title
          )}
        </span>
        <span className="text-xs text-muted">{collection.pageCount}</span>
        <button
          type="button"
          aria-label={`Actions for ${collection.title}`}
          className="px-1 text-xs text-muted"
          onClick={(event) => {
            event.stopPropagation()
            onMenu()
          }}
        >
          ···
        </button>
      </div>
      {menuOpen && (
        <div className="ml-8 flex flex-col py-1 text-xs" role="menu">
          <button type="button" className="px-2 py-1 text-left hover:bg-canvas" onClick={onRename}>
            Rename
          </button>
          <button
            type="button"
            className="px-2 py-1 text-left hover:bg-canvas"
            onClick={() => {
              const boardId = useWorkspaceStore.getState().board?.id
              if (!boardId) return
              void window.api
                .invoke('collections:placeCard', boardId, collection.id)
                .then(() => showNotice('Added a card on this board.'))
                .catch((error) => reportError(error))
            }}
          >
            Add card on this board
          </button>
          <button
            type="button"
            className="px-2 py-1 text-left hover:bg-canvas"
            onClick={() => {
              const name = window.prompt('Template name', `${collection.title} template`)
              if (!name?.trim()) return
              void window.api
                .invoke('collections:saveTemplate', name.trim(), collection.id)
                .then(() => showNotice('Saved a template. Existing collections were not changed.'))
                .catch((error) => reportError(error))
            }}
          >
            Save as template
          </button>
          <button
            type="button"
            className="px-2 py-1 text-left text-red-700 hover:bg-canvas"
            onClick={() => {
              if (!window.confirm(`Trash “${collection.title}”? You can restore it later.`)) return
              void window.api
                .invoke('collections:trash', collection.id)
                .catch((error) => reportError(error))
            }}
          >
            Trash collection
          </button>
        </div>
      )}
    </li>
  )
}
