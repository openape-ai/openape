// The app's only table is the sp-tasks queue; re-export it so Drizzle's `useDb`
// schema includes it. No app-specific tables — answers are ephemeral, the queue
// is the store.
export { agentTasks } from '@openape/sp-tasks/schema'
