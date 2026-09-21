FROM node:24.15.0-bookworm-slim
ARG PORT=3028
WORKDIR /app
COPY --chown=999:988 . ./.output
ENV NITRO_PORT=${PORT}
ENV HOST=0.0.0.0
ENV PORT=${PORT}
EXPOSE ${PORT}
USER 999:988
CMD ["node", ".output/server/index.mjs"]
