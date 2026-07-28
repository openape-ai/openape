export function extractWrappedCommand(args: string[]): string[] {
  const delimiter = args.indexOf('--')
  return delimiter >= 0 ? args.slice(delimiter + 1) : []
}

export function extractOption(args: string[], name: string): string | undefined {
  const delimiter = args.indexOf('--')
  const optionArgs = delimiter >= 0 ? args.slice(0, delimiter) : args
  const index = optionArgs.indexOf(`--${name}`)
  if (index >= 0 && index + 1 < optionArgs.length)
    return optionArgs[index + 1]
  return undefined
}
