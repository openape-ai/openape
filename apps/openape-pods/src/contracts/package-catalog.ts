import { parsePackages } from './dependencies'

export interface PackageSearch { query: string }
export interface PackageOption { name: string, version: string, description: string }
export function parsePackageSearch(value: unknown): PackageSearch {
  if (!value || typeof value !== 'object' || Object.keys(value).join() !== 'query' || !('query' in value) || typeof value.query !== 'string' || !value.query.trim() || value.query.length > 300 || [...value.query].some(character => character.charCodeAt(0) < 32)) throw new Error('Enter a package name, search term or npm package URL')
  return { query: value.query.trim() }
}
export function parsePackageOptions(value: unknown): PackageOption[] {
  if (!Array.isArray(value) || value.length > 12) throw new Error('Invalid npm catalog response')
  return value.map((item) => {
    if (!item || typeof item !== 'object' || typeof item.name !== 'string' || typeof item.description !== 'string' || item.description.length > 500) throw new Error('Invalid npm catalog response')
    parsePackages({ dependencies: { [item.name]: item.version } })
    return { name: item.name, version: item.version as string, description: item.description }
  })
}
