Start work on a GitHub issue for the openape-ai/openape monorepo.

## Input

Issue number: $ARGUMENTS

If no issue number is provided, ask the user for one.

## Steps

### 1. Fetch the issue

Run:
```bash
gh issue view $ARGUMENTS --repo openape-ai/openape --json number,title,body,labels
```

If the issue does not exist, report the error and stop.

### 2. Determine branch type

Based on the issue labels:
- Label `bug` → type = `fix`
- Label `enhancement` → type = `feat`
- Label `documentation` → type = `docs`
- No matching label → ask the user to choose: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `perf`

### 3. Generate branch name

Pattern: `<type>/issue-<nr>-<short-description>`

Take the first 3-4 significant words from the issue title, convert to kebab-case.
Examples:
- Issue #8 "apes adapter install: only processes first argument" → `fix/issue-8-adapter-install`
- Issue #11 "Capability grants: wildcard resource matching" → `feat/issue-11-wildcard-resource-matching`

### 4. Detect affected packages

Scan the issue title and body for these keywords and map to package paths:

| Keyword | Path |
|---------|------|
| `apes` | `packages/apes` |
| `grapes` | `packages/grapes` |
| `shapes` | `packages/shapes` |
| `core` | `packages/core` |
| `auth` | `packages/auth` |
| `grants` | `packages/grants` |
| `proxy` | `packages/proxy` |
| `browser` | `packages/browser` |
| `s3-driver` | `packages/s3-driver` |
| `nuxt-auth-idp` | `modules/nuxt-auth-idp` |
| `nuxt-auth-sp` | `modules/nuxt-auth-sp` |
| `service`, `cloud` | `apps/service` |
| `free-idp` | `apps/openape-free-idp` |
| `agent-mail` | `apps/openape-agent-mail` |
| `agent-proxy` | `apps/openape-agent-proxy` |

### 5. Show scope summary and ask for confirmation

Display:
```
## Issue #<nr>: <title>

**Type:** <type>
**Branch:** <type>/issue-<nr>-<short-description>
**Affected packages:** <list>

**Description:**
<issue body, truncated if very long>

Proceed? (y/n — or adjust branch name/type)
```

Wait for user confirmation before proceeding.

### 6. Create the branch

```bash
cd openape-monorepo
git fetch origin main
git checkout -b <branch-name> origin/main
```

If the branch already exists locally or remotely, report it and ask what to do.

### 7. Log activity

```bash
claude-log "Started issue #<nr>: <title>" "OpenAPE" "Delta Mind" "code"
```

### 8. Ready message

```
## Ready to work on #<nr>

Branch: <branch-name>
Affected: <package list>

Next steps:
1. Implement the fix/feature
2. Lint + typecheck must pass before commit (enforced by pre-commit hook)
3. Commit with conventional message: `fix(apes): <description>` or `feat(grants): <description>`
4. Push and create PR:
   git push -u origin <branch>
   gh pr create --title "<type>(scope): <description>" --body "Closes #<nr>"
```

### Important

- The monorepo is at `openape-monorepo/` relative to CWD
- Always use `git -C openape-monorepo` if not already in the monorepo directory
- Read the CONTRIBUTING.md for the full workflow
- Check DDISA protocol compliance for protocol-relevant packages (see CLAUDE.md)
