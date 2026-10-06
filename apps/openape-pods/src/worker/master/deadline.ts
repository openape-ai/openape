export class MasterDeadline {
  private idle: ReturnType<typeof setTimeout> | undefined
  private readonly total: ReturnType<typeof setTimeout>
  constructor(private readonly expire: (error: Error) => void) {
    this.total = setTimeout(() => this.expire(new Error('Setup reached its time limit. Saved changes are retained. Use Continue setup to finish.')), 10 * 60 * 1000)
    this.progress()
  }

  progress(): void {
    clearTimeout(this.idle)
    this.idle = setTimeout(() => this.expire(new Error('The assistant stopped responding. Saved changes are retained. Use Continue setup to retry.')), 2 * 60 * 1000)
  }

  close(): void { clearTimeout(this.idle); clearTimeout(this.total) }
}
