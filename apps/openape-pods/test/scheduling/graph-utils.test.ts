// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { GraphEdge } from '../../src/renderer/utils/graph-layout'
import { graphLayers } from '../../src/renderer/utils/graph-layout'

const edge = (from: string, to: string, channel = 'delta-mind/mail/messages'): GraphEdge => ({ from, to, channel })
const mail = [edge('sync', 'classification'), edge('classification', 'invoices', 'delta-mind/mail/classifications'), edge('classification', 'newsletters', 'delta-mind/mail/classifications'), edge('sync', 'overview'), edge('classification', 'overview', 'delta-mind/mail/classifications')]
const ids = ['sync', 'classification', 'invoices', 'newsletters', 'overview']

describe('graph layers', () => {
  it('puts every node into the layer after its longest path', () => {
    expect(graphLayers(ids, mail)).toEqual([['sync'], ['classification'], ['invoices', 'newsletters', 'overview']])
  })
  it('keeps unconnected nodes in the first layer and survives a cycle', () => {
    expect(graphLayers(['a', 'b', 'c'], [])).toEqual([['a', 'b', 'c']])
    const layers = graphLayers(['a', 'b'], [edge('a', 'b'), edge('b', 'a')])
    expect(layers.flat().sort()).toEqual(['a', 'b'])
  })
})
