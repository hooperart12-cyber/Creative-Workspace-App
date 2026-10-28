/** Moves `fromId` to the place of `toId`. The same list means nothing moved. */
export function reorderSlideIds(ids: string[], fromId: string, toId: string): string[] | null {
  const from = ids.indexOf(fromId)
  const to = ids.indexOf(toId)
  if (from < 0 || to < 0 || from === to) return null
  const next = [...ids]
  const [id] = next.splice(from, 1)
  next.splice(to, 0, id)
  return next
}
