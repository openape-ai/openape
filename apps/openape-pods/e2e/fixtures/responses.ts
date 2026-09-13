export function recordedResponse(item: unknown = { type: 'message', id: 'fixture-message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'SYNTHETIC_RESPONSE_COMPLETE', annotations: [] }] }): Response {
  const response = { id: 'fixture-response', object: 'response', status: 'in_progress', output: [] }
  const events = [{ type: 'response.created', response }, { type: 'response.output_item.added', output_index: 0, item }, { type: 'response.output_item.done', output_index: 0, item }, { type: 'response.completed', response: { ...response, status: 'completed', output: [item], usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } } }]
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } })
}
