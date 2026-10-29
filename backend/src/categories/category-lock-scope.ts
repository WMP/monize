/** Lock selected subtrees and their ancestry in one sorted batch. Siblings are not descendants of a selected ancestor added only as a lock witness. */
export function categoryLockScope(
  graph: readonly { id: string; parentId: string | null }[],
  selected: readonly string[],
): string[] {
  const descendants = new Set(selected);
  for (let changed = true; changed;) {
    changed = false;
    for (const row of graph) {
      if (
        row.parentId &&
        descendants.has(row.parentId) &&
        !descendants.has(row.id)
      ) {
        descendants.add(row.id);
        changed = true;
      }
    }
  }
  const parents = new Map(graph.map((row) => [row.id, row.parentId]));
  const locks = new Set(descendants);
  for (const id of descendants) {
    const seen = new Set<string>();
    let parent = parents.get(id);
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      locks.add(parent);
      parent = parents.get(parent);
    }
  }
  return [...locks].sort();
}
