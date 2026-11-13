import { useState } from 'react'
import type { CollectionOutlineFolder, CollectionTemplateInfo } from '@shared/collections'
import { buildTree, flattenTree } from '../lib/tree'
import { reportError } from '../store/projectStore'
import { useWorkspaceStore } from '../store/workspaceStore'

const field = 'w-full rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm'

/** Name, folder, template, direction, and a starting page count. Opens the planner. */
export function NewCollectionDialog({
  folderId,
  templateId,
  folders,
  templates,
  onClose
}: {
  folderId: string | null
  templateId: string | null
  folders: CollectionOutlineFolder[]
  templates: CollectionTemplateInfo[]
  onClose: () => void
}) {
  const starting = templates.find((item) => item.id === templateId) ?? templates[0]
  const [title, setTitle] = useState('')
  const [folder, setFolder] = useState<string | null>(folderId)
  const [template, setTemplate] = useState(starting?.id ?? '')
  const [direction, setDirection] = useState<'ltr' | 'rtl'>(starting?.data.direction ?? 'ltr')
  const [count, setCount] = useState(0)
  const [saving, setSaving] = useState(false)
  const folderOptions = flattenTree(buildTree(folders, (item) => item.parentId))

  const create = async () => {
    setSaving(true)
    try {
      const created = await window.api.invoke('collections:create', {
        title,
        folderId: folder,
        templateId: template || null,
        direction,
        placeholderCount: count
      })
      onClose()
      useWorkspaceStore.getState().openPlanner(created.id, created.pageIds[0] ?? null)
    } catch (error) {
      reportError(error)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30">
      <form
        role="dialog"
        aria-labelledby="new-collection-title"
        className="w-[28rem] max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface p-5 shadow-xl"
        onSubmit={(event) => {
          event.preventDefault()
          void create()
        }}
      >
        <h2 id="new-collection-title" className="text-base font-medium">
          New collection
        </h2>
        <p className="mt-1 text-sm text-muted">
          A template only sets the starting point. Later edits to it leave this collection alone.
        </p>
        <label className="mt-4 block text-sm">
          Name
          <input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className={`${field} mt-1`}
            aria-label="Collection name"
          />
        </label>
        <label className="mt-3 block text-sm">
          Folder
          <select
            value={folder ?? ''}
            onChange={(event) => setFolder(event.target.value || null)}
            className={`${field} mt-1`}
            aria-label="Collection folder"
          >
            <option value="">Collections</option>
            {folderOptions.map((option) => (
              <option key={option.item.id} value={option.item.id}>
                {`${'· '.repeat(option.depth)}${option.item.name}`}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-3 block text-sm">
          Template
          <select
            value={template}
            onChange={(event) => {
              const next = event.target.value
              setTemplate(next)
              const chosen = templates.find((item) => item.id === next)
              if (chosen) setDirection(chosen.data.direction)
            }}
            className={`${field} mt-1`}
            aria-label="Collection template"
          >
            {templates.map((item) => (
              <option key={item.id} value={item.id}>
                {item.builtin ? item.name : `${item.name} (saved)`}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-3 block text-sm">
          Reading direction
          <select
            value={direction}
            onChange={(event) => setDirection(event.target.value === 'rtl' ? 'rtl' : 'ltr')}
            className={`${field} mt-1`}
            aria-label="Reading direction"
          >
            <option value="ltr">Left to right</option>
            <option value="rtl">Right to left</option>
          </select>
        </label>
        <label className="mt-3 block text-sm">
          Starting pages
          <input
            type="number"
            min={0}
            max={100}
            value={count}
            onChange={(event) =>
              setCount(Math.min(100, Math.max(0, Number(event.target.value) || 0)))
            }
            className={`${field} mt-1`}
            aria-label="Starting page count"
          />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-line px-3 py-1.5 text-sm"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !template}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            Create and open
          </button>
        </div>
      </form>
    </div>
  )
}

/** Edits a template's starting settings. Existing collections keep the copy they already have. */
export function TemplateEditor({
  template,
  onClose
}: {
  template: CollectionTemplateInfo
  onClose: () => void
}) {
  const [name, setName] = useState(template.name)
  const [direction, setDirection] = useState(template.data.direction)
  const [side, setSide] = useState(template.data.firstPageSide)
  const [stages, setStages] = useState(template.data.stages.map((stage) => stage.name).join('\n'))

  const save = async () => {
    try {
      const data = {
        direction,
        firstPageSide: side,
        stages: stages
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((stageName) => ({ name: stageName }))
      }
      if (data.stages.length === 0) data.stages.push({ name: 'Work' })
      await window.api.invoke('collections:updateTemplate', template.id, data)
      if (!template.builtin && name.trim() && name.trim() !== template.name) {
        await window.api.invoke('collections:renameTemplate', template.id, name.trim())
      }
      onClose()
    } catch (error) {
      reportError(error)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30">
      <form
        role="dialog"
        aria-labelledby="edit-template-title"
        className="w-[28rem] max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface p-5 shadow-xl"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <h2 id="edit-template-title" className="text-base font-medium">
          Edit template
        </h2>
        <p className="mt-1 text-sm text-muted">
          Collections already created from this template keep their own stages.
        </p>
        <label className="mt-4 block text-sm">
          Name
          <input
            value={name}
            disabled={template.builtin}
            onChange={(event) => setName(event.target.value)}
            className={`${field} mt-1 disabled:opacity-60`}
            aria-label="Template name"
          />
        </label>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="text-sm">
            Direction
            <select
              value={direction}
              onChange={(event) => setDirection(event.target.value === 'rtl' ? 'rtl' : 'ltr')}
              className={`${field} mt-1`}
            >
              <option value="ltr">Left to right</option>
              <option value="rtl">Right to left</option>
            </select>
          </label>
          <label className="text-sm">
            Opening side
            <select
              value={side}
              onChange={(event) => setSide(event.target.value === 'left' ? 'left' : 'right')}
              className={`${field} mt-1`}
            >
              <option value="right">First page on the right</option>
              <option value="left">First page on the left</option>
            </select>
          </label>
        </div>
        <label className="mt-3 block text-sm">
          Stages, one per line
          <textarea
            value={stages}
            onChange={(event) => setStages(event.target.value)}
            rows={5}
            className={`${field} mt-1`}
            aria-label="Template stages"
          />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-line px-3 py-1.5 text-sm"
            onClick={onClose}
          >
            Cancel
          </button>
          <button type="submit" className="rounded-lg bg-accent px-3 py-1.5 text-sm text-white">
            Save template
          </button>
        </div>
      </form>
    </div>
  )
}
