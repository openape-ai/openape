export function shouldPersistDeferredTask(task: { owner: string } | undefined, agent: string): boolean {
  return Boolean(task?.owner === agent)
}
