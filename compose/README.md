# OpenApe deployment and local integration configuration

`chatty.yml` describes deployed services. Troop, CRM and Chat remain explicitly
listed with their existing image tags, mounts and routes, but their source now
lives in [the legacy repository](https://repos.openape.ai/patrick/legacy).
Removing source does not authorize stopping these services or deleting data.
The normal `deploy:image` targets no longer build these three legacy applications.

`local-stack.yml` and `Caddyfile` cover active local applications. Legacy
Troop/CRM/Chat/Nest builds and their exclusive story/lifecycle harnesses have
moved out of the active stack. `demo/run.sh` continues to capture active guides.

Nest's former `docker-compose.yml`, `nest-prod.run.sh`, migration runbooks and
agent lifecycle harness are preserved in the legacy repository. They describe
historical infrastructure and require a deliberate operational review before use.
See [legacy extraction and recovery](../docs/operations/legacy-apps.md).
