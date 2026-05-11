import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  _internalSkillsCacheReset,
  composeSkills,
  composeSystemPrompt,
  formatSkillsBlock,
  parseFrontmatter,
  readSoul,
  scanSkillsDir,
  skillsDir,
  soulPath,
} from '../src/skills'

describe('skills loader', () => {
  let home: string
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ape-agent-skills-'))
    _internalSkillsCacheReset()
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('soulPath / skillsDir compose under the given home', () => {
    expect(soulPath(home)).toBe(join(home, '.openape', 'agent', 'SOUL.md'))
    expect(skillsDir(home)).toBe(join(home, '.openape', 'agent', 'skills'))
  })

  it('readSoul returns null when the file is missing or empty', () => {
    expect(readSoul(home)).toBeNull()
    mkdirSync(join(home, '.openape', 'agent'), { recursive: true })
    writeFileSync(soulPath(home), '   \n  \n')
    expect(readSoul(home)).toBeNull()
  })

  it('readSoul returns trimmed content when present', () => {
    mkdirSync(join(home, '.openape', 'agent'), { recursive: true })
    writeFileSync(soulPath(home), '\n\nYou are Patrick\'s agent. Be brief.\n\n')
    expect(readSoul(home)).toBe('You are Patrick\'s agent. Be brief.')
  })

  describe('parseFrontmatter', () => {
    it('parses name + description from a YAML block', () => {
      const fm = parseFrontmatter('---\nname: foo\ndescription: a tool that foos\n---\nbody')
      expect(fm).toEqual({ name: 'foo', description: 'a tool that foos' })
    })

    it('parses legacy top-level requires_tools as inline array', () => {
      const fm = parseFrontmatter('---\nname: foo\ndescription: d\nrequires_tools: [a, b, c]\n---\nbody')
      expect(fm?.requiresTools).toEqual(['a', 'b', 'c'])
    })

    it('parses legacy top-level requires_tools as block array', () => {
      const fm = parseFrontmatter('---\nname: foo\ndescription: d\nrequires_tools:\n  - a\n  - b\n---')
      expect(fm?.requiresTools).toEqual(['a', 'b'])
    })

    it('reads openape-namespaced requires_tools from nested metadata', () => {
      const fm = parseFrontmatter('---\nname: foo\ndescription: d\nmetadata:\n  openape:\n    requires_tools: [time.now, http.get]\n---')
      expect(fm?.requiresTools).toEqual(['time.now', 'http.get'])
    })

    it('reads openclaw-namespaced requires.bins from nested metadata', () => {
      const fm = parseFrontmatter('---\nname: foo\ndescription: d\nmetadata:\n  openclaw:\n    requires:\n      bins: [o365-cli]\n---')
      expect(fm?.requiresBins).toEqual(['o365-cli'])
    })

    it('openape namespace wins over legacy top-level requires_tools', () => {
      const fm = parseFrontmatter('---\nname: foo\ndescription: d\nrequires_tools: [legacy]\nmetadata:\n  openape:\n    requires_tools: [winner]\n---')
      expect(fm?.requiresTools).toEqual(['winner'])
    })

    it('accepts both openclaw + openape blocks side-by-side (the cross-runtime case)', () => {
      const fm = parseFrontmatter(`---
name: foo
description: d
metadata:
  openclaw:
    emoji: 📊
    requires:
      bins: [o365-cli]
  openape:
    requires_tools: [mail.list]
---`)
      expect(fm?.requiresTools).toEqual(['mail.list'])
      expect(fm?.requiresBins).toEqual(['o365-cli'])
    })

    it('returns null when no frontmatter or required fields missing', () => {
      expect(parseFrontmatter('# just a markdown heading\nno fm')).toBeNull()
      expect(parseFrontmatter('---\nname: foo\n---\nbody')).toBeNull()
      expect(parseFrontmatter('---\ndescription: d\n---\nbody')).toBeNull()
    })

    it('strips surrounding quotes from values', () => {
      const fm = parseFrontmatter('---\nname: "foo"\ndescription: \'a quoted desc\'\n---')
      expect(fm).toEqual({ name: 'foo', description: 'a quoted desc' })
    })
  })

  describe('scanSkillsDir', () => {
    it('returns empty when the dir does not exist', () => {
      expect(scanSkillsDir('/nonexistent/path/here')).toEqual([])
    })

    it('reads each `<name>/SKILL.md` and parses frontmatter', () => {
      const dir = join(home, 'skills')
      mkdirSync(join(dir, 'alpha'), { recursive: true })
      mkdirSync(join(dir, 'beta'), { recursive: true })
      writeFileSync(join(dir, 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: A\n---\nbody A')
      writeFileSync(join(dir, 'beta', 'SKILL.md'), '---\nname: beta\ndescription: B\nrequires_tools: [http.get]\n---\nbody B')

      const skills = scanSkillsDir(dir)
      expect(skills).toHaveLength(2)
      const names = skills.map(s => s.name).sort()
      expect(names).toEqual(['alpha', 'beta'])
      const beta = skills.find(s => s.name === 'beta')!
      expect(beta.requiresTools).toEqual(['http.get'])
      expect(beta.filePath).toBe(join(dir, 'beta', 'SKILL.md'))
    })

    it('silently skips skills without valid frontmatter', () => {
      const dir = join(home, 'skills')
      mkdirSync(join(dir, 'good'), { recursive: true })
      mkdirSync(join(dir, 'broken'), { recursive: true })
      writeFileSync(join(dir, 'good', 'SKILL.md'), '---\nname: good\ndescription: G\n---')
      writeFileSync(join(dir, 'broken', 'SKILL.md'), '# no frontmatter')
      const skills = scanSkillsDir(dir)
      expect(skills.map(s => s.name)).toEqual(['good'])
    })
  })

  describe('formatSkillsBlock', () => {
    it('returns empty string when there are no skills', () => {
      expect(formatSkillsBlock([])).toBe('')
    })

    it('builds an <available_skills> XML block with name + description + location', () => {
      const out = formatSkillsBlock([
        { name: 'a', description: 'first', filePath: '/p/a/SKILL.md' },
        { name: 'b', description: 'second & special <chars>', filePath: '/p/b/SKILL.md' },
      ])
      expect(out).toContain('<available_skills>')
      expect(out).toContain('<name>a</name>')
      expect(out).toContain('<description>first</description>')
      expect(out).toContain('<location>/p/a/SKILL.md</location>')
      // XML-escapes special chars in description
      expect(out).toContain('second &amp; special &lt;chars&gt;')
    })
  })

  describe('composeSkills — eligibility + override', () => {
    it('drops skills whose required tools are not enabled', () => {
      mkdirSync(join(skillsDir(home), 'needs-mail'), { recursive: true })
      writeFileSync(
        join(skillsDir(home), 'needs-mail', 'SKILL.md'),
        '---\nname: needs-mail\ndescription: D\nrequires_tools: [mail.list]\n---',
      )
      mkdirSync(join(skillsDir(home), 'free'), { recursive: true })
      writeFileSync(
        join(skillsDir(home), 'free', 'SKILL.md'),
        '---\nname: free\ndescription: D\n---',
      )
      // Only time.now enabled — needs-mail must be filtered out.
      const skills = composeSkills(home, ['time.now'])
      const names = skills.map(s => s.name)
      expect(names).toContain('free')
      expect(names).not.toContain('needs-mail')
    })

    it('drops skills whose required binaries aren\'t on host PATH', () => {
      mkdirSync(join(skillsDir(home), 'needs-fictional-binary'), { recursive: true })
      writeFileSync(
        join(skillsDir(home), 'needs-fictional-binary', 'SKILL.md'),
        // A binary that obviously won't be on PATH — `which` will fail.
        '---\nname: needs-fictional-binary\ndescription: D\nmetadata:\n  openclaw:\n    requires:\n      bins: [openape-not-a-real-bin-zz9plural9z]\n---',
      )
      mkdirSync(join(skillsDir(home), 'has-shell'), { recursive: true })
      writeFileSync(
        join(skillsDir(home), 'has-shell', 'SKILL.md'),
        // `sh` is on every macOS / Linux box → eligibility passes.
        '---\nname: has-shell\ndescription: D\nmetadata:\n  openclaw:\n    requires:\n      bins: [sh]\n---',
      )
      const skills = composeSkills(home, [])
      const names = skills.map(s => s.name)
      expect(names).toContain('has-shell')
      expect(names).not.toContain('needs-fictional-binary')
    })

    it('agent-side skill shadows a default-skill of the same name', () => {
      // We can't easily delete bundled default-skills from a test, but we
      // can verify that a same-name agent skill overrides one of them. The
      // bundled `bash` skill says "DDISA grant cycle…"; write an override.
      mkdirSync(join(skillsDir(home), 'bash'), { recursive: true })
      writeFileSync(
        join(skillsDir(home), 'bash', 'SKILL.md'),
        '---\nname: bash\ndescription: agent-side override of bash skill\n---\nbody',
      )
      const skills = composeSkills(home, ['bash'])
      const bash = skills.find(s => s.name === 'bash')!
      expect(bash.description).toBe('agent-side override of bash skill')
      expect(bash.filePath).toBe(join(skillsDir(home), 'bash', 'SKILL.md'))
    })
  })

  describe('composeSystemPrompt', () => {
    it('returns the base prompt unchanged when no SOUL + no skills + no tools', () => {
      // No SOUL.md written; tools=[] filters out every default skill that
      // requires_tools.
      const out = composeSystemPrompt({ base: 'base prompt', home, enabledTools: [] })
      expect(out).toBe('base prompt')
    })

    it('prepends SOUL.md when present', () => {
      mkdirSync(join(home, '.openape', 'agent'), { recursive: true })
      writeFileSync(soulPath(home), 'I am the soul.')
      const out = composeSystemPrompt({ base: 'base', home, enabledTools: [] })
      expect(out.startsWith('I am the soul.')).toBe(true)
      expect(out.endsWith('base')).toBe(true)
    })

    it('includes the available_skills block when a skill is eligible', () => {
      mkdirSync(join(skillsDir(home), 'noreqs'), { recursive: true })
      writeFileSync(
        join(skillsDir(home), 'noreqs', 'SKILL.md'),
        '---\nname: noreqs\ndescription: a skill with no required tools\n---',
      )
      const out = composeSystemPrompt({ base: 'base', home, enabledTools: [] })
      expect(out).toContain('<available_skills>')
      expect(out).toContain('<name>noreqs</name>')
    })
  })
})
