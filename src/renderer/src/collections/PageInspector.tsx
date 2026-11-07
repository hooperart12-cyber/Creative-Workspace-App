import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { assetUrl } from '@shared/assets'
import { cropFromFractions } from '@shared/artwork'
import {
  PAGE_ROLES,
  PAGE_STATUSES,
  type CollectionDetail,
  type CollectionPageView,
  type PagePatch,
  type PageRole,
  type PageStatus
} from '@shared/collections'
import type { Destination } from '@shared/destinations'
import { reportError, useProjectStore } from '../store/projectStore'

const field = 'w-full rounded border border-line bg-canvas px-2 py-1 text-sm'

export function PageInspector({
  detail,
  page,
  selectedCount,
  onChanged
}: {
  detail: CollectionDetail
  page: CollectionPageView
  selectedCount: number
  onChanged: () => void
}) {
  const [title, setTitle] = useState(page.title)
  const [label, setLabel] = useState(page.label)
  const [notes, setNotes] = useState(page.notes)
  const [comments, setComments] = useState<{ id: string; body: string }[]>([])
  const [links, setLinks] = useState<{ id: string; destination: Destination | null }[]>([])
  const [comment, setComment] = useState('')
  const [linkTarget, setLinkTarget] = useState('')

  useEffect(() => {
    let cancel = false
    void Promise.all([
      window.api.invoke('collections:comments', page.id),
      window.api.invoke('collections:links', page.id)
    ])
      .then(([nextComments, nextLinks]) => {
        if (cancel) return
        setComments(nextComments)
        setLinks(nextLinks)
      })
      .catch((error) => reportError(error))
    return () => {
      cancel = true
    }
  }, [page.id, page.revision])

  const save = async (patch: PagePatch) => {
    const base: PagePatch = {}
    if (patch.title !== undefined) base.title = page.title
    if (patch.label !== undefined) base.label = page.label
    if (patch.notes !== undefined) base.notes = page.notes
    if (patch.overallStatus !== undefined) base.overallStatus = page.overallStatus as PageStatus
    if (patch.role !== undefined) base.role = page.role
    if (patch.unnumbered !== undefined) base.unnumbered = page.unnumbered
    try {
      await window.api.invoke('collections:updatePage', page.id, page.revision, patch, base)
      onChanged()
    } catch (error) {
      reportError(error)
    }
  }

  const blur = (key: 'title' | 'label' | 'notes', value: string, current: string) => () => {
    if (value !== current) void save({ [key]: value })
  }

  const states = detail.stageStates.filter((state) => state.pageId === page.id)
  const neighbor = (() => {
    const index = detail.pages.findIndex((item) => item.id === page.id)
    return detail.pages[index + 1] ?? null
  })()

  return (
    <aside className="flex h-full w-full flex-col gap-3 overflow-y-auto border-l border-line bg-surface p-3 text-sm">
      <div>
        <h2 className="font-medium">Page properties</h2>
        {selectedCount > 1 && (
          <p className="mt-1 text-xs text-muted">
            {selectedCount} pages selected. Changes here apply only to this page.
          </p>
        )}
      </div>
      <label className="text-xs text-muted">
        Page id
        <input
          readOnly
          value={page.id}
          className={`${field} mt-1 font-mono text-xs`}
          aria-label="Page id"
        />
      </label>
      <p className="text-xs text-muted">
        Number <span className="text-ink">{page.number ?? 'Unnumbered'}</span>
      </p>
      <label>
        Title
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={blur('title', title, page.title)}
          className={`${field} mt-1`}
          aria-label="Page title"
        />
      </label>
      <label>
        Label
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          onBlur={blur('label', label, page.label)}
          className={`${field} mt-1`}
          aria-label="Page label"
        />
      </label>
      <label>
        Role
        <select
          value={page.role ?? 'story'}
          onChange={(event) => void save({ role: event.target.value as PageRole })}
          className={`${field} mt-1`}
          aria-label="Page role"
        >
          {PAGE_ROLES.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={page.unnumbered === true}
          onChange={(event) => void save({ unnumbered: event.target.checked ? true : null })}
        />
        Skip numbering
      </label>
      <label>
        Notes
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          onBlur={blur('notes', notes, page.notes)}
          rows={4}
          className={`${field} mt-1`}
          aria-label="Page notes"
        />
      </label>
      <label>
        Overall status
        <select
          value={page.overallStatus}
          onChange={(event) => void save({ overallStatus: event.target.value as PageStatus })}
          className={`${field} mt-1`}
          aria-label="Overall status"
        >
          {PAGE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status.replace('_', ' ')}
            </option>
          ))}
        </select>
      </label>
      {detail.stages.map((stage) => {
        const state = states.find((item) => item.stageId === stage.id)
        return (
          <label key={stage.id}>
            {stage.name}
            <select
              value={state?.state ?? 'not_started'}
              onChange={(event) => {
                void window.api
                  .invoke(
                    'collections:setStage',
                    page.id,
                    stage.id,
                    event.target.value as PageStatus,
                    state?.note ?? ''
                  )
                  .then(onChanged)
                  .catch((error) => reportError(error))
              }}
              className={`${field} mt-1`}
              aria-label={`${stage.name} status`}
            >
              {PAGE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status.replace('_', ' ')}
                </option>
              ))}
            </select>
          </label>
        )
      })}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted">Spread</span>
        {page.spreadId ? (
          <button
            type="button"
            className="rounded border border-line px-2 py-1 text-left"
            onClick={() => {
              void window.api
                .invoke('collections:unlockSpread', page.id)
                .then(onChanged)
                .catch((error) => reportError(error))
            }}
          >
            Unlock spread
          </button>
        ) : (
          <button
            type="button"
            disabled={!neighbor || neighbor.span === 2 || page.span === 2}
            className="rounded border border-line px-2 py-1 text-left disabled:opacity-40"
            onClick={() => {
              if (!neighbor) return
              void window.api
                .invoke('collections:lockSpread', page.id, neighbor.id)
                .then(onChanged)
                .catch((error) => reportError(error))
            }}
          >
            Lock with the next page
          </button>
        )}
        <button
          type="button"
          disabled={!!page.spreadId}
          className="rounded border border-line px-2 py-1 text-left disabled:opacity-40"
          onClick={() => {
            void window.api
              .invoke('collections:setSpan', page.id, page.span === 2 ? 1 : 2)
              .then(onChanged)
              .catch((error) => reportError(error))
          }}
        >
          {page.span === 2 ? 'Use one reading position' : 'Wide page, two positions'}
        </button>
      </div>
      <div>
        <ArtworkVersions
          pageId={page.id}
          revision={page.revision}
          displayedVersionId={page.displayedVersionId}
          onChanged={onChanged}
        />
        <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Comments</h3>
        <ul className="mt-1 space-y-1">
          {comments.map((item) => (
            <li key={item.id} className="rounded bg-canvas px-2 py-1 text-xs">
              {item.body}
            </li>
          ))}
          {comments.length === 0 && <li className="text-xs text-muted">No comments</li>}
        </ul>
        <form
          className="mt-2 flex gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            const body = comment.trim()
            if (!body) return
            void window.api
              .invoke('collections:addComment', page.id, body)
              .then(() => {
                setComment('')
                onChanged()
              })
              .catch((error) => reportError(error))
          }}
        >
          <input
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            aria-label="New page comment"
            className={field}
          />
          <button type="submit" className="rounded border border-line px-2 text-xs">
            Add
          </button>
        </form>
      </div>
      <div>
        <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Links</h3>
        <ul className="mt-1 space-y-1 text-xs">
          {links.map((link) => (
            <li key={link.id}>{link.destination?.title || link.destination?.kind || 'Link'}</li>
          ))}
          {links.length === 0 && <li className="text-muted">No links</li>}
        </ul>
        <form
          className="mt-2 flex gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            if (!linkTarget) return
            void window.api
              .invoke('collections:addLink', page.id, {
                kind: 'page',
                collectionId: detail.id,
                pageId: linkTarget,
                title: detail.pages.find((item) => item.id === linkTarget)?.title || 'Page'
              })
              .then(() => {
                setLinkTarget('')
                onChanged()
              })
              .catch((error) => reportError(error))
          }}
        >
          <select
            value={linkTarget}
            onChange={(event) => setLinkTarget(event.target.value)}
            aria-label="Link to page"
            className={field}
          >
            <option value="">Link to a page</option>
            {detail.pages
              .filter((item) => item.id !== page.id)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.number ?? item.role ?? 'Page'} {item.title}
                </option>
              ))}
          </select>
          <button type="submit" className="rounded border border-line px-2 text-xs">
            Add
          </button>
        </form>
      </div>
    </aside>
  )
}

function ArtworkVersions({
  pageId,
  revision,
  displayedVersionId,
  onChanged
}: {
  pageId: string
  revision: number
  displayedVersionId: string | null
  onChanged: () => void
}) {
  const [versions, setVersions] = useState<
    {
      id: string
      name: string
      fileName: string
      sha256: string | null
      width: number | null
      height: number | null
      missing: boolean
      crop: { x: number; y: number; w: number; h: number } | null
    }[]
  >([])
  const [loaded, setLoaded] = useState(0)
  useEffect(() => {
    let cancel = false
    void window.api.invoke('collections:versions', pageId).then((rows) => {
      if (!cancel) setVersions(rows)
    })
    return () => {
      cancel = true
    }
  }, [pageId, displayedVersionId, loaded])
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Artwork</h3>
      <button
        type="button"
        className="rounded border border-line px-2 py-1 text-left text-xs"
        onClick={() => {
          void window.api
            .invoke('dialog:pickFiles')
            .then(async (paths) => {
              const file = paths[0]
              if (!file) return
              await window.api.invoke('collections:addVersion', pageId, file)
              setLoaded((value) => value + 1)
              onChanged()
            })
            .catch((error) => reportError(error))
        }}
      >
        Add a version
      </button>
      {versions.length === 0 && <p className="text-xs text-muted">No artwork yet.</p>}
      {versions.map((version) => (
        <div key={version.id} className="rounded border border-line p-2 text-xs">
          <p>{version.name || version.fileName || 'Version'}</p>
          <p className="text-muted">
            {version.missing
              ? 'Missing file'
              : version.id === displayedVersionId
                ? 'Displayed'
                : 'Not displayed'}
          </p>
          {version.id !== displayedVersionId && (
            <button
              type="button"
              className="mt-1 rounded border border-line px-2 py-1"
              onClick={() => {
                void window.api
                  .invoke('collections:setDisplayed', pageId, version.id, revision)
                  .then(onChanged)
                  .catch((error) => reportError(error))
              }}
            >
              Set as displayed
            </button>
          )}
          <button
            type="button"
            className="mt-1 rounded border border-line px-2 py-1"
            onClick={() => {
              void window.api
                .invoke('dialog:pickFiles')
                .then(async (paths) => {
                  const file = paths[0]
                  if (!file) return
                  await window.api.invoke('collections:relinkFile', version.id, file)
                  onChanged()
                })
                .catch((error) => reportError(error))
            }}
          >
            Relink this version
          </button>
          <CropFields
            key={`${version.id}:${version.crop?.x ?? 'none'}`}
            crop={version.crop}
            sha256={version.sha256}
            width={version.width}
            height={version.height}
            onSave={(crop) => {
              void window.api
                .invoke('collections:setCrop', version.id, crop)
                .then(onChanged)
                .catch((error) => reportError(error))
            }}
          />
        </div>
      ))}
    </div>
  )
}

function CropFields({
  crop,
  sha256,
  width,
  height,
  onSave
}: {
  crop: { x: number; y: number; w: number; h: number } | null
  sha256: string | null
  width: number | null
  height: number | null
  onSave: (crop: { x: number; y: number; w: number; h: number } | null) => void
}) {
  const projectId = useProjectStore((s) => s.project?.id ?? null)
  const drag = useRef<{ x: number; y: number } | null>(null)
  const boxRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [x, setX] = useState(String(crop?.x ?? ''))
  const [y, setY] = useState(String(crop?.y ?? ''))
  const [w, setW] = useState(String(crop?.w ?? ''))
  const [h, setH] = useState(String(crop?.h ?? ''))
  const save = () => {
    if (!x && !y && !w && !h) {
      if (crop) onSave(null)
      return
    }
    const next = { x: Number(x), y: Number(y), w: Number(w), h: Number(h) }
    if ([next.x, next.y, next.w, next.h].some((value) => !Number.isInteger(value))) return
    onSave(next)
  }
  const draw = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !width || !height) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width
    const y = (event.clientY - rect.top) / rect.height
    const left = Math.min(drag.current.x, x)
    const top = Math.min(drag.current.y, y)
    const next = {
      x: left,
      y: top,
      w: Math.abs(x - drag.current.x),
      h: Math.abs(y - drag.current.y)
    }
    boxRef.current = next
    setBox(next)
  }
  return (
    <div className="mt-2">
      {projectId && sha256 && width && height && (
        <div
          aria-label="Crop the artwork"
          className="relative mb-2 overflow-hidden rounded border border-line"
          style={{ height: 112 }}
          onPointerDown={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            drag.current = {
              x: (event.clientX - rect.left) / rect.width,
              y: (event.clientY - rect.top) / rect.height
            }
            try {
              event.currentTarget.setPointerCapture(event.pointerId)
            } catch {
              // A synthetic pointer cannot be captured. Later moves still update the box.
            }
          }}
          onPointerMove={draw}
          onPointerUp={(event) => {
            const drawn = boxRef.current
            if (!drawn || !drag.current || drawn.w < 0.01 || drawn.h < 0.01) {
              drag.current = null
              boxRef.current = null
              setBox(null)
              return
            }
            onSave(cropFromFractions({ width, height }, drawn))
            drag.current = null
            boxRef.current = null
            setBox(null)
            try {
              event.currentTarget.releasePointerCapture(event.pointerId)
            } catch {
              // The pointer was never captured.
            }
          }}
        >
          <img
            src={assetUrl(projectId, sha256, 256)}
            alt=""
            className="h-full w-full object-contain"
          />
          {box && (
            <span
              className="absolute border border-accent bg-accent/20"
              style={{
                left: `${box.x * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.w * 100}%`,
                height: `${box.h * 100}%`
              }}
            />
          )}
        </div>
      )}
      <div className="grid grid-cols-4 gap-1">
        {(
          [
            ['Crop x', x, setX],
            ['Crop y', y, setY],
            ['Crop width', w, setW],
            ['Crop height', h, setH]
          ] as const
        ).map(([label, value, setValue]) => (
          <input
            key={label}
            aria-label={label}
            value={value}
            inputMode="numeric"
            className="w-full rounded border border-line bg-canvas px-1 py-1"
            onChange={(event) => setValue(event.target.value)}
            onBlur={save}
          />
        ))}
      </div>
    </div>
  )
}
