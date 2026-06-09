# Tiny dnsmasq for the local test stack (self-contained — no third-party image).
# Build from the monorepo root: docker build -f compose/dns.Dockerfile -t openape-dns .
FROM alpine:3.20
RUN apk add --no-cache dnsmasq
COPY compose/dnsmasq.conf /etc/dnsmasq.conf
# -k: keep in foreground (PID 1); -C: config file.
ENTRYPOINT ["dnsmasq", "-k", "-C", "/etc/dnsmasq.conf"]
