#!/bin/sh

if [ -n "$CLOUDFLARE_TUNNEL_TOKEN" ]; then
  # ── NAMED TUNNEL MODE (permanent URL) ──────────────────────────────────────
  echo "==> Named tunnel mode: permanent URL"

  # Write the permanent URL to shared volume so the dashboard can display it
  if [ -n "$TUNNEL_HOSTNAME" ]; then
    echo "https://$TUNNEL_HOSTNAME" > /shared/tunnel_url.txt
    echo "==> Permanent tunnel URL: https://$TUNNEL_HOSTNAME"
  fi

  exec cloudflared tunnel --no-autoupdate run --token "$CLOUDFLARE_TUNNEL_TOKEN"

else
  # ── QUICK TUNNEL MODE (temporary URL, zero config) ─────────────────────────
  echo "==> Quick tunnel mode: temporary URL (set CLOUDFLARE_TUNNEL_TOKEN for permanent URL)"

  cloudflared tunnel --no-autoupdate --url http://nginx:80 2>&1 | tee /tmp/tunnel.log &
  TUNNEL_PID=$!

  # Wait for the URL to appear in logs
  for i in $(seq 1 30); do
    TUNNEL_URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' /tmp/tunnel.log | head -1)
    if [ -n "$TUNNEL_URL" ]; then
      echo "$TUNNEL_URL" > /shared/tunnel_url.txt
      echo "==> Tunnel URL written: $TUNNEL_URL"
      break
    fi
    sleep 1
  done

  wait $TUNNEL_PID
fi
