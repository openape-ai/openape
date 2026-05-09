---
'@openape/apes': patch
'@openape/chat-bridge': patch
---

Fix two issues that surfaced on first cron-task DM:

1. **Tool names rejected by ChatGPT API**: catalog tool names like `time.now` failed the Responses API's `^[a-zA-Z0-9_-]+$` pattern via LiteLLM. Wire-encode dots to underscores when sending tools to the LLM (`time.now` → `time_now`); decode the model's tool_call back to the local catalog name.

2. **Task DMs landing in main thread instead of dedicated thread**: cron-runner now explicitly POSTs `/api/rooms/<id>/threads` with the task's name on first run, then reuses the returned threadId for every subsequent run of that task.
