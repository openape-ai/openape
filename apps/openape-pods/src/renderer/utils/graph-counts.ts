import type { GraphEdge, GraphEdgeCount } from '../../contracts/graphs'

export interface CountedEdge extends GraphEdge { count: number }
/** The number of items that travelled along each drawn edge in the last run. An edge without items counts 0. */
export function edgeCounts(edges: GraphEdge[], counts: GraphEdgeCount[]): CountedEdge[] {
  return edges.map(edge => ({ ...edge, count: counts.filter(item => item.from === edge.from && item.to === edge.to && item.channel === edge.channel).reduce((sum, item) => sum + item.count, 0) }))
}
/** What one node received and handed on in the last run, and what still waits in front of it. */
export function nodeCounts(id: string, edges: CountedEdge[], waiting: Record<string, number>): { received: number, given: number, waiting: number } {
  const sum = (items: CountedEdge[]) => items.reduce((total, edge) => total + edge.count, 0)
  return { received: sum(edges.filter(edge => edge.to === id)), given: sum(edges.filter(edge => edge.from === id)), waiting: waiting[id] ?? 0 }
}
