import { describe, expect, it } from 'vitest'
import { parseAdapterToml } from '../../src/adapters/toml.js'

describe('parseAdapterToml', () => {
  it('parses a minimal adapter', () => {
    const content = `
schema = "openape-shapes/v1"

[cli]
id = "test"
executable = "test-cli"

[[operation]]
id = "list"
command = ["list"]
display = "List items"
action = "list"
risk = "low"
resource_chain = ["item:*"]
`
    const adapter = parseAdapterToml(content)
    expect(adapter.schema).toBe('openape-shapes/v1')
    expect(adapter.cli.id).toBe('test')
    expect(adapter.cli.executable).toBe('test-cli')
    expect(adapter.operations).toHaveLength(1)
    expect(adapter.operations[0]!.id).toBe('list')
    expect(adapter.operations[0]!.command).toEqual(['list'])
    expect(adapter.operations[0]!.risk).toBe('low')
  })

  it('parses positionals and required_options', () => {
    const content = `
schema = "openape-shapes/v1"

[cli]
id = "test"
executable = "test-cli"

[[operation]]
id = "show"
command = ["show"]
positionals = ["name"]
required_options = ["format"]
display = "Show {name}"
action = "read"
risk = "low"
resource_chain = ["item:name={name}"]
`
    const adapter = parseAdapterToml(content)
    const op = adapter.operations[0]!
    expect(op.positionals).toEqual(['name'])
    expect(op.required_options).toEqual(['format'])
  })

  it('parses exact_command flag', () => {
    const content = `
schema = "openape-shapes/v1"

[cli]
id = "test"
executable = "test-cli"

[[operation]]
id = "delete"
command = ["delete"]
positionals = ["name"]
display = "Delete {name}"
action = "delete"
risk = "high"
exact_command = true
resource_chain = ["item:name={name}"]
`
    const adapter = parseAdapterToml(content)
    expect(adapter.operations[0]!.exact_command).toBe(true)
  })

  it('parses optional cli fields', () => {
    const content = `
schema = "openape-shapes/v1"

[cli]
id = "test"
executable = "test-cli"
audience = "my-audience"
version = "2"

[[operation]]
id = "list"
command = ["list"]
display = "List"
action = "list"
risk = "low"
resource_chain = ["item:*"]
`
    const adapter = parseAdapterToml(content)
    expect(adapter.cli.audience).toBe('my-audience')
    expect(adapter.cli.version).toBe('2')
  })

  it('rejects missing schema', () => {
    const content = `
[cli]
id = "test"
executable = "test-cli"

[[operation]]
id = "list"
command = ["list"]
display = "List"
action = "list"
risk = "low"
resource_chain = ["item:*"]
`
    expect(() => parseAdapterToml(content)).toThrow('Unsupported adapter schema')
  })

  it('rejects wrong schema version', () => {
    const content = `schema = "openape-shapes/v99"\n[cli]\nid = "test"\nexecutable = "test"\n[[operation]]\nid = "x"\ncommand = ["x"]\ndisplay = "x"\naction = "x"\nrisk = "low"\nresource_chain = ["x:*"]`
    expect(() => parseAdapterToml(content)).toThrow('Unsupported adapter schema')
  })

  it('rejects missing cli section', () => {
    const content = `schema = "openape-shapes/v1"\n[[operation]]\nid = "x"\ncommand = ["x"]\ndisplay = "x"\naction = "x"\nrisk = "low"\nresource_chain = ["x:*"]`
    expect(() => parseAdapterToml(content)).toThrow('missing cli.id or cli.executable')
  })

  it('rejects no operations', () => {
    const content = `schema = "openape-shapes/v1"\n[cli]\nid = "test"\nexecutable = "test"`
    expect(() => parseAdapterToml(content)).toThrow('at least one [[operation]]')
  })

  it('skips comments and blank lines', () => {
    const content = `
# This is a comment
schema = "openape-shapes/v1"

# CLI section
[cli]
id = "test"
executable = "test-cli"

# Operations
[[operation]]
id = "list"
command = ["list"]
display = "List"
action = "list"
risk = "low"
resource_chain = ["item:*"]
`
    const adapter = parseAdapterToml(content)
    expect(adapter.cli.id).toBe('test')
  })

  it('parses multi-element arrays', () => {
    const content = `
schema = "openape-shapes/v1"

[cli]
id = "test"
executable = "test-cli"

[[operation]]
id = "create"
command = ["thing", "create"]
positionals = ["name", "type"]
display = "Create {name}"
action = "create"
risk = "high"
resource_chain = ["org:name=current", "thing:name={name}"]
`
    const adapter = parseAdapterToml(content)
    const op = adapter.operations[0]!
    expect(op.command).toEqual(['thing', 'create'])
    expect(op.positionals).toEqual(['name', 'type'])
    expect(op.resource_chain).toEqual(['org:name=current', 'thing:name={name}'])
  })
})
