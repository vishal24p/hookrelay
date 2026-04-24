FROM cloudflare/cloudflared:latest AS cloudflared
FROM alpine:latest

COPY --from=cloudflared /usr/local/bin/cloudflared /usr/local/bin/cloudflared
COPY start.sh /scripts/start.sh
RUN chmod +x /scripts/start.sh

CMD ["/bin/sh", "/scripts/start.sh"]
