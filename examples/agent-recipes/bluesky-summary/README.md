# bluesky-summary — Agent Recipe

A scheduled agent that digests your Bluesky home timeline twice a day.
This is the reference Agent Recipe — see
[the Agent Recipe docs](https://docs.openape.ai/ecosystem/agent-recipe).

## What it does

- `ape-agent.yaml` declares the intent, the `topic` param, two daily
  schedules, and two capabilities (`BLUESKY_HANDLE`,
  `BLUESKY_APP_PASSWORD`).
- `tools/fetch-feed.mjs` logs in via AT-Proto and prints recent posts
  as JSON. The agent's LLM turns that into the digest.
- The credentials are **sealed to the agent** by troop and only ever
  exist in plaintext inside the agent process — the recipe only names
  them.

## Deploy (one step)

```bash
apes agent deploy github.com/openape-ai/bluesky-summary@v0.1.0 \
  --param topic="AI agents" \
  --secret BLUESKY_HANDLE=you.bsky.social \
  --secret BLUESKY_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
```

(Omit `--secret` to be prompted; the values are sealed before they
leave your machine's troop session and never stored in plaintext.)

## Live end-to-end verification

The full live run needs a connected `openape-nest` host and a real
Bluesky app password. Sequence:

```bash
# 1. tag the recipe repo
git tag v0.1.0 && git push --tags

# 2. deploy (creates the agent, schedules, binds the sealed secret)
apes agent deploy github.com/openape-ai/bluesky-summary@v0.1.0 \
  --param topic="AI agents" --secret BLUESKY_HANDLE=you.bsky.social \
  --secret BLUESKY_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx

# 3. trigger a run now instead of waiting for cron
apes run --as bluesky-summary -- apes agents run --task-id recipe-0

#    → expect: a 5–10 bullet digest in the agent's output channel.

# 4. revoke the secret, run again
#    (troop UI or the secrets endpoint), then re-trigger step 3
#    → expect: "could not authenticate" — NEVER a plaintext leak,
#      NEVER invented content (clean fail).

# 5. edit user_addendum in troop ("focus on the negative posts")
#    → next run reflects it with NO re-deploy.
```

The recipe→plan→seal/open code path is verified automatically in
`apps/openape-troop/tests/recipe-e2e.test.ts` against this exact
manifest.
