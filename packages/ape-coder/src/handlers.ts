// story: coder-cli — red-phase contract (#585).
//
// The command behaviors as pure, injectable functions: each takes an API client
// (so tests pass a fake) and returns the machine-readable result, or maps the
// API's error to a user-facing CliError. This is the layer the citty commands
// call and the layer the criteria are pinned against — it carries NO authority
// of its own (criteria 3 + 4): it forwards the caller's request and surfaces
// whatever the permission-enforcing server answers.
//
// Every function throws until the green phase implements it — nothing here
// fulfils an acceptance criterion yet.

import type { CoderApi, Project, Story, StoryPatch } from './coder-api'

/** A read result is always structured data so scripts/agents can build on it (criterion 6). */
export interface CliContext {
  api: Pick<CoderApi, 'listProjects' | 'listStories' | 'getStory' | 'updateStory'>
}

/**
 * `ape-coder projects list` — returns exactly the projects the API gives the
 * signed-in user, i.e. the same set the app shows (criterion 2). On a missing
 * session the API layer already maps to a "run `apes login`" CliError (criterion
 * 1 + 5); this handler forwards it.
 */
export function listProjects(ctx: CliContext): Promise<Project[]> {
  return ctx.api.listProjects()
}

/** `ape-coder stories list <project>` — the project's stories, machine-readable (criterion 6). */
export function listStories(ctx: CliContext, projectId: string): Promise<Story[]> {
  return ctx.api.listStories(projectId)
}

/**
 * `ape-coder stories set-title …` (and the other edits) — forwards the write to
 * the API. A permission denial (member without grant, or an agent token trying
 * an admin action) comes back from the server and is surfaced verbatim; the CLI
 * has no bypass path (criteria 3 + 4).
 */
export function editStory(ctx: CliContext, projectId: string, storyId: string, patch: StoryPatch): Promise<Story> {
  return ctx.api.updateStory(projectId, storyId, patch)
}
