export async function run(context) {
  for (let page = 0; page < 20; page++) {
    const result = await context.mail.workflow.filter()
    if (!result.complete) continue
    await context.workflow.publish({ schema: result.output.schema, data: result.output })
    return { status: 'completed', summary: result.output.baseline ? 'Quiet mailbox baseline completed; no messages moved or sent.' : 'Frozen mail batch filtered and its archive report confirmed.', completedInputIds: context.input.eventIds, gapIds: [] }
  }
  return { status: 'blocked', summary: 'Mail enumeration or filtering checkpoint saved. Review progress and resume this workflow node.', completedInputIds: [], gapIds: [] }
}
