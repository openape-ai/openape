// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { GraphEdge } from '../../src/contracts/graphs'
import { edgePath, graphLayers, layoutGraph, nodeSize } from '../../src/renderer/utils/graph-layout'

const edge = (from: string, to: string, channel = 'mail.open'): GraphEdge => ({ from, to, channel })
const mail = [edge('intake', 'triage'), edge('triage', 'gate:batch', 'mail.newsletter'), edge('triage', 'categorise', 'mail.useful'), edge('gate:batch', 'archive', 'mail.approved'), edge('gate:batch', 'categorise', 'mail.kept'), edge('categorise', 'memory', 'mail.category')]
const ids = ['intake', 'triage', 'categorise', 'gate:batch', 'archive', 'memory']

describe('graph layout', () => {
  it('puts every node into the layer after its longest path', () => {
    expect(graphLayers(ids, mail)).toEqual([['intake'], ['triage'], ['gate:batch'], ['categorise', 'archive'], ['memory']])
  })
  it('keeps unconnected nodes in the first layer and survives a cycle', () => {
    expect(graphLayers(['a', 'b', 'c'], [])).toEqual([['a', 'b', 'c']])
    const layers = graphLayers(['a', 'b'], [edge('a', 'b'), edge('b', 'a')])
    expect(layers.flat().sort()).toEqual(['a', 'b'])
  })
  it('orders a layer by the rows of its predecessors', () => {
    const layout = layoutGraph(['top', 'bottom', 'below', 'above'], [edge('bottom', 'below'), edge('top', 'above')])
    expect(layout.nodes.filter(node => node.layer === 1).sort((a, b) => a.row - b.row).map(node => node.id)).toEqual(['above', 'below'])
  })
  it('never lets two nodes overlap', () => {
    const { nodes } = layoutGraph(ids, mail)
    for (const a of nodes) {
      for (const b of nodes.filter(other => other !== a)) expect(Math.abs(a.x - b.x) >= nodeSize.width || Math.abs(a.y - b.y) >= nodeSize.height, `${a.id} and ${b.id}`).toBe(true)
    }
  })
  it('draws every edge with horizontal and vertical segments from the right side of its source to the left side of its target', () => {
    const layout = layoutGraph(ids, mail)
    expect(layout.edges).toHaveLength(mail.length)
    for (const drawn of layout.edges) {
      const from = layout.nodes.find(node => node.id === drawn.from)!; const to = layout.nodes.find(node => node.id === drawn.to)!
      expect(drawn.points[0]).toEqual([from.x + nodeSize.width, from.y + nodeSize.height / 2])
      expect(drawn.points.at(-1)).toEqual([to.x, to.y + nodeSize.height / 2])
      for (let index = 1; index < drawn.points.length; index++) expect(drawn.points[index]![0] === drawn.points[index - 1]![0] || drawn.points[index]![1] === drawn.points[index - 1]![1], `${drawn.from} to ${drawn.to}`).toBe(true)
    }
  })
  it('reports the size of the drawing and ignores an edge to a node that is not drawn', () => {
    const layout = layoutGraph(['a', 'b'], [edge('a', 'b'), edge('a', 'missing')])
    expect(layout.edges).toHaveLength(1)
    expect(layout.width).toBe(nodeSize.margin * 2 + nodeSize.width * 2 + nodeSize.gapX)
    expect(layout.height).toBe(nodeSize.margin * 2 + nodeSize.height)
    expect(edgePath([[0, 1], [2, 1], [2, 5]])).toBe('M0 1 L2 1 L2 5')
  })
})
