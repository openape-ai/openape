# How to Contribute — A Guide for New Personas

Welcome to OpenApe Werkstatt! This guide helps new team members (personas) get started with contributing to the company.

## Your Role

Each persona has a specific mandate:

| Persona | Mandate |
|---------|---------|
| **scribe** | Documentation — keep READMEs, guides, and API docs accurate |
| **backend** | Code implementation — build features and fix bugs |
| **qa** | Verification — run tests, review PRs, ensure quality |
| **pm** | Task grooming — prioritize, assign, and track work |
| **cfo** | Budget monitoring — track spend and flag risks |
| **ceo** | Owner — make decisions on blockers and high-risk items |

Stay in your lane. For work outside your mandate, file a task for the right persona.

Development problems and implementation work belong to [native issues](https://repos.openape.ai/issues). Tasks below describe general work and reminders. A task may link an issue, but must not duplicate its discussion or resolution status. Approved implementation proposals remain in Plans.

## Finding Your Tasks

### 1. Check Your Identity

First, identify yourself:

```bash
apes whoami --json
```

This returns your agent email (e.g., `scribe-xxx@id.openape.ai`).

### 2. List Your Assigned Tasks

```bash
ape-tasks list --status open,doing --json
```

Look for tasks where `assignee_email` matches your email.

If you have no assigned tasks, scan unassigned `open` tasks in your teams and claim the best fit:

```bash
ape-tasks edit <task-id> --assignee <your-email>
```

## Working on a Task

### 1. Claim the Task

Mark the task as in progress:

```bash
ape-tasks status <task-id> doing
```

### 2. Read the Task Brief

The task contains:
- **title**: What needs to be done
- **notes**: Detailed description and acceptance criteria
- **context_url**: Related links (if any)

### 3. Do the Work

Use your available tools:
- `bash` — run shell commands
- `file_read`, `file_write`, `file_edit` — work with files
- `http_get` — fetch web resources
- `troop_company_read` — read org data from troop.openape.ai
- `git_worktree` — create isolated worktrees for code changes
- `verify` — run tests/build/lint in a worktree

### 4. Report Progress

Update the task notes with your progress:

```bash
printf '%s' "<what you're doing, blockers, decisions>" | ape-tasks edit <task-id> --notes-from-stdin
```

## Completing a Task

### 1. Report Results

Before closing, document what you accomplished:

```bash
printf '%s' "<result, decisions, links to PRs/files>" | ape-tasks edit <task-id> --notes-from-stdin
```

Include:
- What was accomplished
- Any decisions made
- Links to PRs, files, or related resources

### 2. Mark as Done

```bash
ape-tasks done <task-id>
```

## If You're Blocked

Never fake completion. If you're stuck:

1. Document the blocker in the task notes
2. Leave the task in `doing` status
3. Reassign to the Owner for a decision:

```bash
ape-tasks edit <task-id> --assignee <owner-email> --notes-from-stdin
```

Common blockers:
- Waiting for Owner review/merge of PRs
- HIGH-RISK operations (auth, secrets, migrations, deploy, payments, data deletion)
- Missing information or unclear requirements

## Working with Code

If your task requires code changes:

### 1. Find Related Issues

From your own monorepo checkout, activate the pinned Node version and use the authenticated native CLI:

```bash
. ./scripts/activate-node.sh
pnpm git:cli -- issue list --all-repos --state open --assignee me
pnpm git:cli -- issue show <number> --repo patrick/monorepo
```

Results use your live repository or individual reporter access. An assignment does not grant access. Ask the repository owner for the necessary permission when access is missing; do not switch to a mirror token.

### 2. Create a Worktree and Verify Changes

Read `AGENTS.md` in the selected checkout. Create an isolated branch from canonical main, preserve other worktrees, and follow its lint, typecheck, build and behavioral test gates. The collection's `openape-monorepo` directory may be a bare Git directory: create a working checkout before running package or CLI scripts there.

### 3. Push and Open a Native PR

```bash
git push -u origin feature/issue-<number>-<description>
pnpm git:cli -- pr create --repo patrick/monorepo --source feature/issue-<number>-<description> --title 'Describe the behavior change' --body-file /tmp/pr-body.md
pnpm git:cli -- issue link <number> --repo patrick/monorepo --pull-repo patrick/monorepo --pull-number <pr-number>
```

Write the full native issue URL and actual validation evidence in the PR body. Review the exact source/target SHAs and require the protected branch's external checks. Follow the current repository merge authorization; a linked PR does not close its issue. After verifying resolution, read the latest issue version and explicitly close it:

```bash
pnpm git:cli -- issue show <number> --repo patrick/monorepo
pnpm git:cli -- issue close <number> --repo patrick/monorepo --expected-version <current-version>
```

Keep umbrella issues open while approved work remains. Update a linked reminder only when that separate reminder is complete.

## Key Resources

| Resource | URL |
|----------|-----|
| Development issues | https://repos.openape.ai/issues |
| Product problem reporting | https://repos.openape.ai/report |
| General tasks and reminders | https://tasks.openape.ai |
| Code and pull requests | https://repos.openape.ai/patrick/monorepo |
| Implementation proposals | https://plans.openape.ai |
| Company overview | https://troop.openape.ai |

## Quick Reference

```bash
# Identify yourself
apes whoami --json

# List your tasks
ape-tasks list --status open,doing --json

# Claim a task
ape-tasks edit <id> --assignee <your-email>
ape-tasks status <id> doing

# Update task notes
printf '%s' "notes" | ape-tasks edit <id> --notes-from-stdin

# Complete a task
ape-tasks done <id>

# Reassign to Owner (if blocked)
ape-tasks edit <id> --assignee <owner-email> --notes-from-stdin
```

## Tips

- **One task at a time** — finish cleanly before taking another
- **Be brief and concrete** — numbers and links over prose
- **Stay stateless** — if you can't re-derive it from a task/report/commit, it didn't happen
- **Ask early** — if blocked, reassign to the Owner immediately

## Need Help?

If you're unsure about your mandate or how to proceed:
1. Read your persona's mandate in this document
2. Check existing tasks for examples
3. Reassign to the Owner with a clear question

Welcome aboard!
