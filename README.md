# HookRelay

> Catch webhooks. Inspect them. Forward to your local app. Replay on demand.

HookRelay is a self-hosted developer tool that acts as a **middleman between external services and your local application**. It receives webhooks from Stripe, Razorpay, GitHub, or any HTTP service, displays them in a real-time dashboard, and forwards them directly to your running app — with zero config.

---

## What It Does

```
Razorpay → https://your-tunnel.trycloudflare.com/api/hooks/razorpay
                        ↓  (captured + displayed)
                   HookRelay Dashboard
                        ↓  (forwarded instantly)
          http://localhost:3000/api/webhooks/razorpay
                        ↓  (response recorded)
                   ✅ 200 OK  or  ❌ 500 Error
```

---

## Features

- 🌐 **Auto Tunnel** — Cloudflare tunnel starts automatically. No account, no config.
- 📡 **Real-time Dashboard** — WebSocket-powered live feed of incoming webhooks
- 🔀 **Forwarding** — Per-session configurable URL to forward payloads to your app
- ↻ **Replay** — Re-send any stored event to your app with one click
- ↓ **Download JSON** — Export any payload for use in unit tests
- 🟢 **Status Badges** — Green/Yellow/Red showing your app's response code
- 🗂️ **Sessions** — Isolated channels per service (stripe, razorpay, github, etc.)

---

## Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI + SQLAlchemy + asyncpg |
| Realtime | Redis pub/sub + WebSockets |
| Database | PostgreSQL 15 |
| Frontend | React + Vite |
| Proxy | Nginx |
| Tunnel | Cloudflare cloudflared |
| Runtime | Docker Compose |

---

## Quick Start

```bash
git clone https://github.com/YOUR_USERNAME/hookrelay.git
cd hookrelay
docker compose up --build
```

Open **http://localhost** — the dashboard is live.

Your public tunnel URL appears automatically in the blue banner at the top.

---

## How to Use

### 1. Create a session
Type a name in the session input (e.g. `razorpay`) and press Enter.

### 2. Copy the public URL
```
https://xxxx.trycloudflare.com/api/hooks/razorpay
```
Paste this into Razorpay / Stripe / GitHub as your webhook endpoint.

### 3. Set a forwarding URL
In the **FWD →** input, type your app's local endpoint:
```
http://host.docker.internal:3000/api/webhooks/razorpay
```
Click **Save**.

### 4. Trigger a payment
Every webhook is now:
- Captured and displayed in real time
- Forwarded to your app
- Response status recorded (200 ✅ / 500 ❌)

### 5. Replay
Click **↻ Replay** on any event to re-send it without triggering a real payment.

---

## Project Structure

```
hookrelay/
├── backend/
│   ├── app/
│   │   ├── main.py        # FastAPI app, endpoints, WebSocket, forwarding
│   │   ├── models.py      # SQLAlchemy models (WebhookEvent, SessionConfig)
│   │   └── schemas.py     # Pydantic schemas
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   └── App.jsx        # Full React UI
│   ├── index.html
│   └── Dockerfile
├── nginx/
│   └── nginx.conf
├── tunnel/
│   ├── Dockerfile         # Alpine + cloudflared binary
│   └── start.sh           # Captures tunnel URL to shared volume
└── docker-compose.yml
```

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/hooks/{session_id}` | Receive a webhook |
| `GET` | `/api/hooks/{session_id}` | List all events for a session |
| `DELETE` | `/api/hooks/{session_id}` | Clear all events for a session |
| `GET` | `/api/sessions` | List all active sessions |
| `GET/PUT` | `/api/sessions/{id}/config` | Get/set forwarding URL |
| `POST` | `/api/hooks/{id}/{event_id}/replay` | Replay a stored event |
| `GET` | `/api/tunnel-url` | Get current Cloudflare tunnel URL |
| `WS` | `/ws/{session_id}` | Real-time WebSocket stream |

---

## Notes

- The Cloudflare tunnel URL changes on every restart (free quick-tunnel). Update your webhook URL in the external service after each restart.
- `host.docker.internal` is the address your local machine's ports are reachable at from inside Docker containers.
- All data is stored locally in PostgreSQL — nothing leaves your machine.
