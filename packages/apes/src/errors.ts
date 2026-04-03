export class CliError extends Error {
  constructor(message: string, public exitCode: number = 1) {
    super(message)
    this.name = 'CliError'
  }
}

export class CliExit extends Error {
  constructor(public exitCode: number = 0) {
    super('')
    this.name = 'CliExit'
  }
}
