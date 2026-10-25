/**
 * Runs async tasks one at a time, in the order they were queued. A failed task doesn't
 * stop the ones after it (its caller still gets the error).
 */
export function serialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let last: Promise<unknown> = Promise.resolve()
  return (task) => {
    const next = last.then(task)
    last = next.catch(() => {})
    return next
  }
}
