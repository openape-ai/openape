/** A directed edge between two nodes, labelled with what flows along it. */
export interface GraphEdge { from: string, to: string, channel: string }

/** The layer of a node is the longest path that leads to it. A cycle keeps its nodes in the last layer reached. */
export function graphLayers(ids: string[], edges: GraphEdge[]): string[][] {
  const layer = new Map(ids.map(id => [id, 0]))
  for (let pass = 0; pass < ids.length; pass++) {
    let moved = false
    for (const edge of edges) {
      if (!layer.has(edge.from) || !layer.has(edge.to) || edge.from === edge.to) continue
      const next = layer.get(edge.from)! + 1
      if (next > layer.get(edge.to)! && next < ids.length) { layer.set(edge.to, next); moved = true }
    }
    if (!moved) break
  }
  const layers: string[][] = []
  for (const id of ids) (layers[layer.get(id)!] ??= []).push(id)
  return layers.filter(Boolean)
}
