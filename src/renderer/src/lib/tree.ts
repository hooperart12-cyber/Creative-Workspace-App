export interface TreeNode<T> {
  item: T
  children: TreeNode<T>[]
}

/** Builds a forest from a flat list using each item's parent id. Orphans become roots. */
export function buildTree<T extends { id: string }>(
  items: T[],
  parentOf: (item: T) => string | null
): TreeNode<T>[] {
  const nodes = new Map(items.map((item) => [item.id, { item, children: [] as TreeNode<T>[] }]))
  const roots: TreeNode<T>[] = []
  for (const node of nodes.values()) {
    const parentId = parentOf(node.item)
    const parent = parentId ? nodes.get(parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

/** Ids of every item below `id` (not including `id`). */
export function descendantIds<T extends { id: string }>(
  items: T[],
  parentOf: (item: T) => string | null,
  id: string
): Set<string> {
  const result = new Set<string>()
  let frontier = [id]
  while (frontier.length) {
    const next = items.filter((i) => frontier.includes(parentOf(i) ?? '')).map((i) => i.id)
    next.forEach((n) => result.add(n))
    frontier = next
  }
  return result
}

/** Depth-first flattening with depth, for indented pickers. */
export function flattenTree<T>(roots: TreeNode<T>[], depth = 0): { item: T; depth: number }[] {
  return roots.flatMap((node) => [
    { item: node.item, depth },
    ...flattenTree(node.children, depth + 1)
  ])
}
