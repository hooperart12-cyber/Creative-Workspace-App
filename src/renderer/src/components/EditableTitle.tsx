import { useEffect, useRef } from 'react'

interface Props {
  value: string
  onCommit: (value: string) => void
  onCancel: () => void
  className?: string
  ariaLabel: string
}

/** Inline rename field: Enter or blur saves, Escape cancels. */
export function EditableTitle({ value, onCommit, onCancel, className, ariaLabel }: Props) {
  const cancelled = useRef(false)
  const input = useRef<HTMLInputElement>(null)

  // Focus after the current task: when rename is chosen from a context menu, the closing menu
  // would otherwise take focus back from this field.
  useEffect(() => {
    const timer = setTimeout(() => {
      input.current?.focus()
      input.current?.select()
    })
    return () => clearTimeout(timer)
  }, [])

  return (
    <input
      ref={input}
      defaultValue={value}
      aria-label={ariaLabel}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          cancelled.current = true
          e.currentTarget.blur()
        }
      }}
      onBlur={(e) => {
        if (cancelled.current) onCancel()
        else onCommit(e.currentTarget.value)
        cancelled.current = false
      }}
      className={`w-full rounded border border-accent bg-surface px-1 outline-none ${className ?? ''}`}
    />
  )
}
