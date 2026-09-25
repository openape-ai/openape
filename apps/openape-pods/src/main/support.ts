import { release } from 'node:os'

export function assertPilotRuntime(platform = process.platform, architecture = process.arch, kernel = release()): void {
  if (platform !== 'darwin' || architecture !== 'arm64' || kernel !== '25.6.0') throw new Error('This pilot executes only on verified macOS Darwin 25.6.0 / Apple silicon. Other OS or CPU combinations require the complete packaged boundary acceptance before execution is enabled.')
}
