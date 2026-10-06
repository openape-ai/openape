import { readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const [input, output] = process.argv.slice(2)
if (!input || !output || process.argv.length !== 4) throw new Error('Usage: node render-plan.mjs input.json output.html')
const data = JSON.parse(readFileSync(input, 'utf8'))
if (!data || typeof data.title !== 'string' || typeof data.description !== 'string') throw new Error('Input requires title and description strings')
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const template = readFileSync(fileURLToPath(new URL('./plan.html', import.meta.url)), 'utf8')
const html = template.replaceAll('Delivery proposal', escape(data.title)).replace('A complete local HTML document. Code, data, image, vector graphic and custom font are embedded.', escape(data.description))
writeFileSync(output, html, { flag: 'wx' })
process.stdout.write(`${output}\n`)
