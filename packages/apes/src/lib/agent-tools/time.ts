import type { ToolDefinition } from './index'

export const timeTools: ToolDefinition[] = [
  {
    name: 'time.now',
    description: 'Returns the current UTC date and time as ISO 8601 plus epoch seconds. No inputs.',
    parameters: { type: 'object', properties: {}, required: [] },
    execute: async () => {
      const now = new Date()
      return {
        iso: now.toISOString(),
        epoch_seconds: Math.floor(now.getTime() / 1000),
        timezone_offset_minutes: -now.getTimezoneOffset(),
      }
    },
  },
]
