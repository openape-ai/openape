# Tiny dependency-free OpenAI-compatible mock LLM (see server.mjs for why).
# Build from the monorepo root.
FROM node:22-bookworm-slim
WORKDIR /app
COPY compose/mock-llm/server.mjs ./
EXPOSE 4000
CMD ["node", "server.mjs"]
