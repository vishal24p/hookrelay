<div align="center">
  <img src="img/hookrelay-logo.png" alt="HookRelay Logo" width="120" />
  <h1>HookRelay</h1>
  <p>Catch webhooks. Inspect them. Forward to your local app. Replay on demand.<br><strong>All data stays on your machine.</strong></p>

  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
  [![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](docker-compose.yml)
  [![FastAPI](https://img.shields.io/badge/FastAPI-0.109-009688?logo=fastapi&logoColor=white)](backend/requirements.txt)
  [![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-336791?logo=postgresql&logoColor=white)](docker-compose.yml)
</div>

HookRelay is a self-hosted webhook proxy. It catches webhooks from services like Stripe or GitHub, shows them in a real-time dashboard, and forwards them to your local dev server. 

I built this because alternatives like Webhook.site or RequestBin store your payloads on their servers. That's a dealbreaker when you're working with real payment data, health records, or strict client NDAs. HookRelay runs entirely locally in Docker, so your data never leaves your machine.

---

## Why I built this

If you've ever built a payment integration, you know the workflow:
1. Razorpay or Stripe needs a public HTTPS URL to send webhooks to.
2. Your app is running locally on `localhost:3000` and can't receive them.
3. You run ngrok, which means sensitive payment payloads are now passing through a third-party server.
4. If you're using a free tunnel, your URL changes every time you restart it. You spend half your day updating the webhook endpoint in the Stripe dashboard.

HookRelay fixes this. It gives you a stable public URL, catches the events, and proxies them to your local app.

```text
Razorpay → https://hooks.yourdomain.com/api/hooks/razorpay
                        ↓  
                   HookRelay Dashboard (localhost)
                        ↓  
           http://localhost:3000/api/webhooks/razorpay
                        ↓  
                   200 OK  or  500 Error
```

---

## Features

- **Automatic public URLs:** It spins up a Cloudflare quick tunnel automatically on boot. No account required.
- **Permanent URLs:** If you have a Cloudflare account and a cheap domain, you can set a permanent webhook URL that survives restarts.
- **Instant dashboard:** A React frontend connected via WebSockets shows webhooks the second they arrive.
- **Auto-forwarding:** Tell it where your local app is running (e.g., `host.docker.internal:3000`), and it forwards payloads automatically.
- **Replay events:** Resend any webhook with one click. Good for debugging your handlers without triggering new test payments.
- **Download JSON:** Export payloads to build mock data for unit tests.

---

## Architecture

Here's how a webhook travels from the internet to your local code:

![HookRelay High-Level Architecture](img/hookrelay-architecture.PNG)

**The flow:**
1. An external service hits your public tunnel URL with a POST request.
2. The `cloudflared` container passes it to Nginx.
3. Nginx routes `/api/*` requests to FastAPI.
4. FastAPI saves the event to PostgreSQL and publishes it to Redis.
5. FastAPI pushes the event to your browser via WebSocket so the dashboard updates instantly.
6. FastAPI forwards the original payload to your local app via `host.docker.internal`.
7. Your app's response (like a 200 OK) is recorded back in the database.

And here is how the six Docker containers communicate internally:

![HookRelay Internal Container Flow](img/hookrelay-inside-docker.png)

### Tech stack

- **Backend:** FastAPI + SQLAlchemy
- **Database:** PostgreSQL 15
- **Message Broker:** Redis 7 
- **Frontend:** React + Vite
- **Proxy:** Nginx
- **Tunnel:** Cloudflare `cloudflared`

---

## Getting started

You need [Docker Desktop](https://www.docker.com/products/docker-desktop/) and Git installed. Docker handles all the actual dependencies (you don't need Python or Node installed locally).

1. Clone the repo and boot the containers:
```bash
git clone https://github.com/vishalp-dev24/hookrelay.git
cd hookrelay
docker compose up --build
```

2. Wait for the containers to start. The terminal will print out a temporary Cloudflare URL.
3. Open `http://localhost` in your browser to view the dashboard.

### How to use it

1. **Create a session:** Type a name like `stripe` in the sidebar and press Enter.
2. **Copy your URL:** Grab the public URL from the blue banner at the top of the dashboard. Paste this into the Stripe/Razorpay developer settings.
3. **Set your forward destination:** In the dashboard's "FWD" input, enter your local app's URL (e.g., `http://host.docker.internal:3000/api/webhooks`). We use `host.docker.internal` instead of `localhost` so the Docker container knows to route the traffic out to your host machine.
4. **Test it:** Fire a test webhook from your provider. It will show up in the dashboard and hit your local app. 

---

## Setting up a permanent URL

The default "quick tunnel" gives you a random URL like `https://random-words.trycloudflare.com` that changes every time Docker restarts. If you want a URL that stays the same permanently, you can use a Cloudflare named tunnel. It's free, but you need a domain name.

1. Set up a free Cloudflare account and add a domain name to it.
2. Go to the Zero Trust Dashboard → Networks → Tunnels → Create a tunnel. Name it `hookrelay` and copy the tunnel token.
3. Add a public hostname to the tunnel (e.g. `hooks.yourdomain.com`). Point the service to `http://nginx:80`.
4. Copy `.env.example` to `.env` in the project root.
5. Add your token and hostname to the `.env` file:
```env
CLOUDFLARE_TUNNEL_TOKEN=your_token_here
TUNNEL_HOSTNAME=hooks.yourdomain.com
```
6. Restart Docker (`docker compose down` then `docker compose up -d`).

The script inside the tunnel container checks for that `.env` file. If it finds the token, it boots the permanent tunnel. If not, it falls back to the random quick tunnel.

---

## API Reference

You can interact with HookRelay programmatically. All endpoints are under `/api/`.

```bash
# Receive a webhook manually
curl -X POST https://your-tunnel.trycloudflare.com/api/hooks/stripe \
  -H "Content-Type: application/json" \
  -d '{"event": "payment.captured", "amount": 5000}'

# Set a forwarding URL via API
curl -X PUT http://localhost/api/sessions/stripe/config \
  -H "Content-Type: application/json" \
  -d '{"forward_url": "http://host.docker.internal:3000/webhooks"}'

# Replay an existing event
curl -X POST http://localhost/api/hooks/stripe/42/replay
```

---

## Data Privacy

All your data stays on your machine. Webhook payloads and session configurations are saved to the local PostgreSQL volume. The dashboard state lives in your browser memory. 

The webhook payloads do transit through Cloudflare's network on their way to your machine. Their privacy policy states they do not log request content. If you want to avoid third-party networks entirely, you can replace the Cloudflare container with something like [frp](https://github.com/fatedier/frp) pointing to your own VPS.

---

## Troubleshooting

**"Forwarding says 'connection refused'"**
Your local app probably isn't running, or it's on a different port. Also make sure you are using `host.docker.internal` in your forwarding URL, not `localhost`. `localhost` inside the FastAPI container just points back to the container itself, not your host machine.

**"I can't see the tunnel URL in the dashboard"**
The Cloudflare container sometimes takes 15-30 seconds to fetch the URL on a cold boot. Wait a moment and refresh.

**"Port 80 is already in use"**
If you have IIS, Apache, or another Docker project using port 80, the Nginx container will fail to start. Edit `docker-compose.yml` and change the Nginx port mapping from `80:80` to `8080:80`. Then view the dashboard at `http://localhost:8080`.

## Contributing

```bash
git clone https://github.com/vishalp-dev24/hookrelay.git
cd hookrelay
docker compose up --build
```
The FastAPI backend auto-reloads when you change Python files. The React frontend hot-reloads via Vite. 

## License

MIT License. Copyright (c) 2026 HookRelay Contributors.
