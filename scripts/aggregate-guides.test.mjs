// eslint-disable-next-line test/no-import-node-test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { readHandbooks, sectionMarkdown } from '../apps/openape-pods/scripts/handbook-content.mjs'

test('guide regeneration preserves Pods, shared handbook content, images and web stories', () => {
  const root = mkdtempSync(join(tmpdir(), 'pods-guide-generator-'))
  try {
    for (const directory of ['apps/docs/scripts', 'apps/openape-pods/scripts', 'apps/openape-free-idp/docs', 'apps/openape-free-idp/public/docs/screenshots']) mkdirSync(join(root, directory), { recursive: true })
    for (const file of ['apps/docs/scripts/aggregate-guides.mjs', 'apps/openape-pods/scripts/handbook-content.mjs']) cpSync(resolve(file), join(root, file))
    cpSync(resolve('apps/openape-pods/docs'), join(root, 'apps/openape-pods/docs'), { recursive: true })
    writeFileSync(join(root, 'apps/openape-free-idp/docs/stories.json'), JSON.stringify({ stories: [{ order: 1, title: 'Sign in', intro: 'Use your account.', steps: [{ title: 'Choose account', caption: 'Review the account.', shot: 'account.png' }] }] }))
    writeFileSync(join(root, 'apps/openape-free-idp/public/docs/screenshots/account.png'), 'synthetic image')
    const generate = () => execFileSync(process.execPath, [join(root, 'apps/docs/scripts/aggregate-guides.mjs')], { stdio: 'pipe' })
    generate()
    const page = join(root, 'apps/docs/content/5.apps/11.pods.md')
    const first = readFileSync(page, 'utf8')
    const { en } = readHandbooks(join(root, 'apps/openape-pods/docs'))
    for (const section of en.sections) {
      for (const block of sectionMarkdown(section, '/guides/pods')) assert.ok(first.includes(block), `Missing ${section.id} content`)
      if (section.image) assert.ok(existsSync(join(root, 'apps/docs/public/guides/pods', section.image)))
    }
    assert.match(readFileSync(join(root, 'apps/docs/content/5.apps/01.index.md'), 'utf8'), /to="\/apps\/pods"/)
    assert.match(readFileSync(join(root, 'apps/docs/content/5.apps/02.idp.md'), 'utf8'), /Choose account/)
    assert.ok(existsSync(join(root, 'apps/docs/public/guides/idp/account.png')))
    writeFileSync(page, 'stale output')
    generate()
    assert.equal(readFileSync(page, 'utf8'), first)
    rmSync(join(root, 'apps/openape-pods/docs/images', en.sections.find(section => section.image).image))
    assert.throws(generate)
    assert.equal(readFileSync(page, 'utf8'), first, 'Invalid input must fail before deleting the generated guide')
  }
  finally { rmSync(root, { recursive: true, force: true }) }
})

test('handbook validation rejects language drift and unsafe image paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'pods-handbook-validation-'))
  try {
    const book = { title: 'Handbook', subtitle: 'Fixture', sections: [{ id: 'start', title: 'Start', paragraphs: ['Hello'], steps: [] }] }
    const save = (locale, value) => writeFileSync(join(root, locale === 'en' ? 'handbook.json' : 'handbook.de.json'), JSON.stringify(value))
    save('en', book); save('de', book)
    assert.equal(readHandbooks(root).en.sections.length, 1)
    save('de', { ...book, sections: [{ ...book.sections[0], id: 'changed' }] })
    assert.throws(() => readHandbooks(root), /chapter parity/)
    save('de', book)
    save('en', { ...book, sections: [{ ...book.sections[0], image: '../private.png' }] })
    assert.throws(() => readHandbooks(root), /Invalid handbook image/)
  }
  finally { rmSync(root, { recursive: true, force: true }) }
})
