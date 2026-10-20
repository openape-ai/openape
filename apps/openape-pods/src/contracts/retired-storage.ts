import { parse } from 'acorn'

interface Syntax { type: string, [key: string]: unknown }
const retired = new Set(['data', 'work', 'decisions'])
function removed() { throw new Error('Shared datastore APIs and work declarations are retired; migrate this script to files or an external service before importing or activating it') }
const node = (value: unknown): Syntax | undefined => value && typeof value === 'object' && 'type' in value ? value as Syntax : undefined
function name(value: unknown): string | undefined {
  const item = node(value)
  return item?.type === 'Identifier' ? String(item.name) : item?.type === 'Literal' && typeof item.value === 'string' ? item.value : undefined
}
function visit(value: unknown, action: (item: Syntax) => void): void {
  if (Array.isArray(value)) { for (const child of value) visit(child, action); return }
  const item = node(value)
  if (!item) return
  action(item)
  for (const child of Object.values(item)) {
    if (child && typeof child === 'object') visit(child, action)
  }
}

/** Reject known retired contracts without executing source. Comments and string contents are inert. */
export function assertCurrentScript(source: string, manifest?: { work?: unknown, polls?: unknown }): void {
  if (manifest?.work !== undefined || manifest?.polls !== undefined) removed()
  let tree: unknown
  try { tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }) }
  catch { return } // Syntax validation remains the runtime's responsibility.
  const contexts = new Set<string>()
  const parameters: unknown[] = []
  visit(tree, (item) => {
    if (item.type === 'ExportNamedDeclaration') {
      const declaration = node(item.declaration)
      if (declaration?.type === 'VariableDeclaration') {
        for (const entry of declaration.declarations as Syntax[]) {
          if (['work', 'polls'].includes(name(entry.id) ?? '')) removed()
        }
      }
      for (const specifier of (item.specifiers ?? []) as Syntax[]) {
        if (['work', 'polls'].includes(name(specifier.exported) ?? '')) removed()
      }
    }
    if (item.type === 'FunctionDeclaration' && name(item.id) === 'run') parameters.push((item.params as unknown[])[0])
    if (item.type === 'VariableDeclarator' && name(item.id) === 'run' && node(item.init)?.params) parameters.push((node(item.init)!.params as unknown[])[0])
  })
  const bind = (pattern: unknown) => {
    const item = node(pattern)
    if (item?.type === 'Identifier') contexts.add(String(item.name))
    if (item?.type === 'ObjectPattern') {
      for (const property of item.properties as Syntax[]) {
        if (retired.has(name(property.key) ?? '')) removed()
      }
    }
  }
  parameters.forEach(bind)
  // Follow local aliases and destructuring; no script evaluation or external observation is involved.
  let previous = -1
  while (previous !== contexts.size) {
    previous = contexts.size
    visit(tree, (item) => {
      if (item.type === 'VariableDeclarator' && contexts.has(name(item.init) ?? '')) bind(item.id)
      if (item.type === 'AssignmentExpression' && contexts.has(name(item.right) ?? '')) bind(item.left)
      if (item.type === 'MemberExpression' && contexts.has(name(item.object) ?? '') && retired.has(name(item.property) ?? '')) removed()
    })
  }
}
