import { useEffect, useState } from 'react'
import type { BackupSettings, BackupStatus } from '@shared/types'
import { formatBytes } from '@shared/files'

export function BackupDialog() {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [settings, setSettings] = useState<BackupSettings | null>(null)
  const [message, setMessage] = useState('')

  const load = () => {
    void window.api.invoke('backup:status').then(setStatus)
    void window.api.invoke('backup:settings').then(setSettings)
  }

  useEffect(() => {
    const onOpen = () => {
      setOpen(true)
      load()
    }
    document.addEventListener('cw-backup', onOpen)
    return () => document.removeEventListener('cw-backup', onOpen)
  }, [])

  if (!open || !status || !settings) return null
  const act = async (work: () => Promise<void>) => {
    setMessage('')
    try {
      await work()
      load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Backup and recovery"
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/20"
    >
      <div className="max-h-[85%] w-[40rem] overflow-auto rounded-xl border border-line bg-surface p-5 shadow-lg">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-medium">Backup and recovery</h2>
          <button
            className="text-sm text-muted"
            onClick={() => setOpen(false)}
            aria-label="Close backup"
          >
            Close
          </button>
        </div>
        <p className="mt-2 text-sm text-muted">
          Last success:{' '}
          {status.lastSuccessAt ? new Date(status.lastSuccessAt).toLocaleString() : 'None yet'}
          {' · '}
          {formatBytes(status.bytes)} stored
          {status.sameVolume ? ' · Same drive as the project' : ''}
          {status.usingFallback
            ? ' · Using the local vault because the chosen folder was unavailable'
            : ''}
        </p>
        <p className="mt-1 truncate text-xs text-muted" title={status.location}>
          {status.location}
        </p>
        {status.lastError && <p className="mt-2 text-sm text-red-700">{status.lastError}</p>}
        {message && <p className="mt-2 text-sm text-red-700">{message}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="rounded-lg border border-line px-3 py-1.5 text-sm"
            onClick={() => void act(async () => void (await window.api.invoke('backup:create')))}
          >
            Back up now
          </button>
          <button
            className="rounded-lg border border-line px-3 py-1.5 text-sm"
            onClick={() =>
              void act(async () => {
                const destination = await window.api.invoke('dialog:pickSaveZip')
                if (destination) await window.api.invoke('project:exportZip', destination)
              })
            }
          >
            Export ZIP
          </button>
          <button
            className="rounded-lg border border-line px-3 py-1.5 text-sm"
            onClick={() =>
              void act(async () => {
                const folder = await window.api.invoke('dialog:pickDirectory')
                if (!folder) return
                setSettings(await window.api.invoke('backup:saveSettings', { customRoot: folder }))
              })
            }
          >
            Choose folder
          </button>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.fallbackToDefault}
            onChange={(event) =>
              void window.api
                .invoke('backup:saveSettings', { fallbackToDefault: event.target.checked })
                .then(setSettings)
            }
          />
          If that folder is unavailable, keep a local copy
        </label>
        <div className="mt-3 grid grid-cols-4 gap-2 text-sm">
          {(
            [
              ['hourly', 'Hourly'],
              ['daily', 'Daily'],
              ['weekly', 'Weekly'],
              ['monthly', 'Monthly']
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                aria-label={`${label} retention`}
                type="number"
                min={0}
                value={settings.retention[key]}
                onChange={(event) =>
                  void window.api
                    .invoke('backup:saveSettings', {
                      retention: { ...settings.retention, [key]: Number(event.target.value) }
                    })
                    .then(setSettings)
                }
                className="mt-1 w-full rounded border border-line px-2 py-1"
              />
            </label>
          ))}
        </div>
        <ul className="mt-4 space-y-2">
          {status.points.map((point) => (
            <li key={point.id} className="flex items-center justify-between gap-2 text-sm">
              <span>
                {new Date(point.createdAt).toLocaleString()} · {point.kind}
                {point.protected ? ' · protected' : ''} · {point.assets.length} files
              </span>
              <span className="flex gap-2">
                <button
                  className="text-muted"
                  onClick={() =>
                    void act(async () => {
                      const result = await window.api.invoke('backup:verify', point.id)
                      setMessage(result.ok ? 'Verified.' : result.errors.join(' '))
                    })
                  }
                >
                  Verify
                </button>
                <button
                  className="text-muted"
                  onClick={() =>
                    void act(async () => {
                      const parent = await window.api.invoke('dialog:pickDirectory')
                      if (!parent) return
                      const restored = await window.api.invoke(
                        'backup:restore',
                        point.id,
                        parent,
                        `${point.projectName} restored`
                      )
                      setMessage(`Restored to ${restored.path}`)
                    })
                  }
                >
                  Restore as new project
                </button>
                <button
                  className="text-muted"
                  onClick={() => void act(() => window.api.invoke('backup:delete', point.id))}
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
