export function ownsTask(task: { owner: string } | undefined, agent: string): boolean {
  return Boolean(task?.owner === agent)
}
