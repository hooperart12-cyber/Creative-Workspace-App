const tails = new Map<string, Promise<void>>()

/** Runs `fn` after any earlier work for `key`. Backup copies and file removal share a key. */
export function withProjectLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve()
  const run = previous.then(fn, fn)
  tails.set(
    key,
    run.then(
      () => undefined,
      () => undefined
    )
  )
  return run
}
