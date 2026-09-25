export const chatModels = [
  { id: 'gpt-6-astra', name: 'GPT-6 Astra' },
  { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
  { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
  { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna' },
  { id: 'gpt-5.5', name: 'GPT-5.5' },
] as const
export type ChatModel = typeof chatModels[number]['id']
export function parseChatModel(value: unknown): ChatModel {
  if (!chatModels.some(model => model.id === value)) throw new Error('Choose an available chat model')
  return value as ChatModel
}
