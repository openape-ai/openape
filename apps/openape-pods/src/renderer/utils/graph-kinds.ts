import type { GraphNodeKind } from '../../contracts/graphs'

export const kindLabels = { code: 'Code, exact rules', decision: 'Decision (Jev)', effect: 'Effect to the outside', gate: 'Approval by you' } as const satisfies Record<GraphNodeKind, string>
