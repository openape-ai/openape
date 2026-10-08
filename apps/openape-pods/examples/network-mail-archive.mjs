export const contract = { takes: ['mail.approved'], gives: [], summary: 'Archives approved mail' }

export async function run(context) {
  if (!context.network) return { status: 'completed', summary: 'The archive port moves mail only inside the reviewed mail network; nothing was moved.', completedInputIds: context.input.eventIds, gapIds: [] }
  const values = { ...context.variables, ...Object.fromEntries(Object.entries(context.config).map(([name, field]) => [name, field.value])) }
  const outcomes = await context.network.archive({ application: 'o365-cli', mailbox: values.mailbox })
  const count = outcome => outcomes.filter(item => item.outcome === outcome).length
  const skipped = outcomes.filter(item => item.outcome === 'skipped').map(item => item.reason)
  return { status: 'completed', summary: `Archived ${count('archived')} approved mails, left ${count('skipped')} in place${skipped.length ? ` (${[...new Set(skipped)].join('; ')})` : ''}, ${count('unknown')} unknown.`, completedInputIds: context.input.eventIds, gapIds: [] }
}
