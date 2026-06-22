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

```bash
curl -s -H "Authorization: token $FORGEJO_TOKEN" \
  "https://git.openape.ai/api/v1/repos/issues/search?assigned=true&state=open&type=issues"
```

### 2. Create a Worktree

```bash
git_worktree create --repo <repo-url> --task-id <task-id> --branch <branch-name>
```

### 3. Make Targeted Edits

- Read the repo's `CONTRIBUTING.md` and `.openape/coding.json`
- Make small, focused changes — never rewrite whole files
- Run verification: `verify --cwd ~/work/<task-id> --command "<test-command>"`

### 4. Push and Open a PR

```bash
curl -s -X POST -H "Authorization: token $FORGEJO_TOKEN" \
  -H 'Content-Type: application/json' \
  "https://git.openape.ai/api/v1/repos/<owner>/<repo>/pulls" \
  -d '{"head":"<branch>","base":"main","title":"...","body":"Closes #<n>"}'
```

Include the PR URL in your task notes before closing.

## Key Resources

| Resource | URL |
|----------|-----|
| Task Board | https://tasks.openape.ai |
| Code Repository | https://git.openape.ai/openape-ai/openape |
| Company Overview | https://troop.openape.ai |

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
