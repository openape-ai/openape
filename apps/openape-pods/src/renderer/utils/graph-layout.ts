import type { GraphEdge } from '../../contracts/graphs'

export interface LayoutNode { id: string, layer: number, row: number, x: number, y: number }
export interface LayoutEdge extends GraphEdge { points: [number, number][] }
export interface GraphLayout { nodes: LayoutNode[], edges: LayoutEdge[], width: number, height: number }
export const nodeSize = { width: 176, height: 64, gapX: 48, gapY: 24, margin: 16 } as const

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

/** Orders every layer by the mean row of its predecessors, so connected nodes sit near each other. */
function ordered(layers: string[][], edges: GraphEdge[]): string[][] {
  const row = new Map<string, number>()
  return layers.map((layer) => {
    const mean = (id: string) => {
      const before = edges.filter(edge => edge.to === id && row.has(edge.from)).map(edge => row.get(edge.from)!)
      return before.length ? before.reduce((sum, value) => sum + value, 0) / before.length : Number.MAX_SAFE_INTEGER
    }
    const sorted = layer.map((id, index) => ({ id, index, mean: mean(id) })).sort((a, b) => a.mean - b.mean || a.index - b.index).map(item => item.id)
    sorted.forEach((id, index) => row.set(id, index))
    return sorted
  })
}

/**
 * Places nodes in columns from left to right and connects them with segments that run only
 * horizontally and vertically. The turn of every edge lies in the gap between two columns.
 */
export function layoutGraph(ids: string[], edges: GraphEdge[]): GraphLayout {
  const { width, height, gapX, gapY, margin } = nodeSize
  const layers = ordered(graphLayers(ids, edges), edges)
  const nodes = layers.flatMap((layer, column) => layer.map((id, row) => ({ id, layer: column, row, x: margin + column * (width + gapX), y: margin + row * (height + gapY) })))
  const position = new Map(nodes.map(node => [node.id, node]))
  const drawn = edges.filter(edge => position.has(edge.from) && position.has(edge.to)).map((edge, index) => {
    const from = position.get(edge.from)!; const to = position.get(edge.to)!
    const start: [number, number] = [from.x + width, from.y + height / 2]; const end: [number, number] = [to.x, to.y + height / 2]
    // Edges that leave the same column turn at slightly different places, so they stay apart.
    const turn = to.layer > from.layer ? to.x - gapX / 2 + (index % 5 - 2) * 6 : from.x + width + gapX / 2
    const points: [number, number][] = to.layer > from.layer
      ? [start, [turn, start[1]], [turn, end[1]], end]
      : [start, [turn, start[1]], [turn, from.y - gapY / 2], [to.x - gapX / 2, from.y - gapY / 2], [to.x - gapX / 2, end[1]], end]
    return { ...edge, points }
  })
  const rows = Math.max(1, ...layers.map(layer => layer.length))
  return { nodes, edges: drawn, width: margin * 2 + layers.length * width + Math.max(0, layers.length - 1) * gapX, height: margin * 2 + rows * height + (rows - 1) * gapY }
}

export function edgePath(points: [number, number][]): string {
  return points.map(([x, y], index) => `${index ? 'L' : 'M'}${x} ${y}`).join(' ')
}
