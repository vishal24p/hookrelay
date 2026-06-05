FROM cloudflare/cloudflared:2026.5.2 AS cloudflared
FROM alpine:3.22.4

COPY --from=cloudflared /usr/local/bin/cloudflared /usr/local/bin/cloudflared
COPY start.sh /scripts/start.sh
RUN apk add --no-cache ca-certificates && chmod +x /scripts/start.sh

CMD ["/bin/sh", "/scripts/start.sh"]
