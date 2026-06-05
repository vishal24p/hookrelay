#!/bin/sh
set -eu

URL_FILE="${TUNNEL_URL_FILE:-/shared/tunnel_url.txt}"
STATUS_FILE="${TUNNEL_STATUS_FILE:-/shared/tunnel_status.json}"
LOG_FILE="${TUNNEL_LOG_FILE:-/tmp/tunnel.log}"
QUICK_TUNNEL_TIMEOUT_SECONDS="${QUICK_TUNNEL_TIMEOUT_SECONDS:-120}"

write_status() {
  status="$1"
  message="$2"
  url="${3:-}"
  printf '{"status":"%s","message":"%s","url":"%s"}\n' "$status" "$message" "$url" > "$STATUS_FILE"
}

mkdir -p "$(dirname "$URL_FILE")" "$(dirname "$STATUS_FILE")"
rm -f "$URL_FILE"
write_status "starting" "Starting tunnel."

if [ -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]; then
  if [ -z "${TUNNEL_HOSTNAME:-}" ]; then
    write_status "error" "CLOUDFLARE_TUNNEL_TOKEN is set but TUNNEL_HOSTNAME is empty. Set both or neither."
    echo "==> ERROR: CLOUDFLARE_TUNNEL_TOKEN is set but TUNNEL_HOSTNAME is empty. Set both or neither." >&2
    exit 1
  fi

  # Named tunnel mode: permanent URL.
  echo "==> Named tunnel mode: permanent URL"

  # Write the permanent URL to shared volume so the dashboard can display it
  echo "https://$TUNNEL_HOSTNAME" > "$URL_FILE"
  write_status "ready" "Named tunnel configured." "https://$TUNNEL_HOSTNAME"
  echo "==> Permanent tunnel URL: https://$TUNNEL_HOSTNAME"

  exec cloudflared tunnel --no-autoupdate run --token "$CLOUDFLARE_TUNNEL_TOKEN"

else
  # Quick tunnel mode: temporary URL, zero config.
  if [ -n "${TUNNEL_HOSTNAME:-}" ]; then
    write_status "starting" "TUNNEL_HOSTNAME is set without CLOUDFLARE_TUNNEL_TOKEN. Falling back to quick-tunnel mode."
    echo "==> WARNING: TUNNEL_HOSTNAME is set without CLOUDFLARE_TUNNEL_TOKEN. Falling back to quick-tunnel mode." >&2
  fi
  echo "==> Quick tunnel mode: temporary URL (set CLOUDFLARE_TUNNEL_TOKEN for permanent URL)"

  cloudflared tunnel --no-autoupdate --url http://public_ingress:80 2>&1 | tee "$LOG_FILE" &
  TUNNEL_PID=$!

  # Wait for the URL to appear in logs
  for i in $(seq 1 "$QUICK_TUNNEL_TIMEOUT_SECONDS"); do
    TUNNEL_URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG_FILE" | head -1 || true)
    if [ -n "$TUNNEL_URL" ]; then
      echo "$TUNNEL_URL" > "$URL_FILE"
      write_status "ready" "Quick tunnel URL acquired." "$TUNNEL_URL"
      echo "==> Tunnel URL written: $TUNNEL_URL"
      break
    fi
    if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
      write_status "error" "cloudflared exited before publishing a tunnel URL."
      echo "==> cloudflared exited before publishing a tunnel URL" >&2
      exit 1
    fi
    sleep 1
  done

  if [ ! -s "$URL_FILE" ]; then
    write_status "error" "Timed out waiting for Cloudflare quick tunnel URL."
    echo "==> Timed out after ${QUICK_TUNNEL_TIMEOUT_SECONDS}s waiting for tunnel URL" >&2
    kill "$TUNNEL_PID" 2>/dev/null || true
    wait "$TUNNEL_PID" 2>/dev/null || true
    exit 1
  fi

  wait "$TUNNEL_PID"
fi
