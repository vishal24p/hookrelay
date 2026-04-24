#!/bin/sh
# Wait for cloudflared to print the tunnel URL, then write it to a shared file.
# This script runs as the tunnel container's entrypoint wrapper.

# Start cloudflared in the background
cloudflared tunnel --no-autoupdate --url http://nginx:80 2>&1 | tee /tmp/tunnel.log &
PID=$!

# Wait for the URL to appear in the output
while true; do
  URL=$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' /tmp/tunnel.log 2>/dev/null | head -1)
  if [ -n "$URL" ]; then
    echo "$URL" > /shared/tunnel-url.txt
    echo "Tunnel URL written: $URL"
    break
  fi
  sleep 1
done

# Keep running
wait $PID
