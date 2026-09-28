export function screenshotPath(name: string): string {
  return `${import.meta.env.VITE_PODS_SCREENSHOT_DIR ?? '../../.artifacts'}/${name}`
}
