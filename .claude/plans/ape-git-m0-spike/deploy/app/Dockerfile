FROM node:22-alpine
RUN apk add --no-cache git git-daemon \
  && git config --global --add safe.directory '*'
WORKDIR /app
COPY package.json server.mjs ./
RUN npm install --omit=dev
EXPOSE 3300
CMD ["node", "server.mjs"]
