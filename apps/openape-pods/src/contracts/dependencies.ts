export interface PackageManifest { dependencies: Record<string, string> }
export function parsePackages(value: unknown): PackageManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => key !== 'dependencies')) throw new Error('package.json only supports dependencies')
  const dependencies = (value as PackageManifest).dependencies ?? {}
  if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies) || Object.keys(dependencies).length > 32) throw new Error('Choose at most 32 script dependencies')
  const entries = Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b))
  for (const [name, version] of entries) {
    if (name.length > 214 || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name) || ['node_modules', '__proto__', 'constructor', 'prototype'].includes(name) || typeof version !== 'string' || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9a-z.-]+)?$/i.test(version) || version.length > 100) throw new Error('Use npm package names with exact versions; ranges and external sources are not supported')
  }
  return { dependencies: Object.fromEntries(entries) }
}
export const emptyPackages = (): PackageManifest => ({ dependencies: {} })
