// Ajv 2020-12 support — schemas use $schema: https://json-schema.org/draft/2020-12/schema
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const schemasDir = join(__dirname, '..', 'schemas')

function loadSchema(filename: string): Record<string, unknown> {
  const raw = readFileSync(join(schemasDir, filename), 'utf-8')
  return JSON.parse(raw) as Record<string, unknown>
}

// Load all schemas so $ref resolution works across them
const schemaFiles = [
  'authz-jwt-claims.json',
  'client-metadata.json',
  'ddisa-record.json',
  'delegation.json',
  'error.json',
  'grant-request.json',
  'grant.json',
  'openid-configuration-extensions.json',
  'sp-scope-catalog.json',
]

const ajv = new Ajv2020({
  strict: false,
  allErrors: true,
})
addFormats(ajv)

// Pre-load all schemas so cross-schema $refs resolve
const schemaMap: Record<string, Record<string, unknown>> = {}
for (const file of schemaFiles) {
  const schema = loadSchema(file)
  schemaMap[file] = schema
  ajv.addSchema(schema)
}

export function getValidator(schemaFilename: string) {
  const schema = schemaMap[schemaFilename]
  if (!schema) {
    throw new Error(`Schema not pre-loaded: ${schemaFilename}`)
  }
  const schemaId = schema.$id as string
  const validate = ajv.getSchema(schemaId)
  if (!validate) {
    throw new Error(`Validator not found for schema id: ${schemaId}`)
  }
  return {
    validate(data: unknown): { valid: boolean, errors: string } {
      const valid = validate(data) as boolean
      const errors = valid ? '' : JSON.stringify(validate.errors, null, 2)
      return { valid, errors }
    },
  }
}
