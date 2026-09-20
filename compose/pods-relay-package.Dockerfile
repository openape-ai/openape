FROM node:24.15.0-bookworm-slim
ARG PORT=3028
WORKDIR /app
COPY . ./.output
ENV NITRO_PORT=${PORT}
ENV HOST=0.0.0.0
ENV PORT=${PORT}
EXPOSE ${PORT}
CMD ["node", ".output/server/index.mjs"]
