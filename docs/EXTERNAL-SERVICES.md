# Connecting External Services to HookRelay

> **Stripe, GitHub, Shopify, Razorpay, and any webhook sender — connected in under 2 minutes.**
> No account. No domain. No cloud. Data stays on your machine.

---

## How This Works

HookRelay runs entirely on your local machine. When you start it with `docker compose up`, it automatically creates a **free Cloudflare tunnel** that gives your local inspector a public HTTPS URL — no setup needed.

```
Razorpay → https://random-words.trycloudflare.com/api/hooks/razorpay
                          ↓
                    (tunnel forwards)
                          ↓
              your machine → nginx → FastAPI
                          ↓
              stored in Postgres → forwarded to your app
```

---

## Quick Start

```bash
# Start everything (tunnel is automatic)
docker compose up --build

# Your public URL appears in the tunnel logs:
docker compose logs tunnel
# → https://random-words.trycloudflare.com

# Or just open http://localhost — the URL is shown in the dashboard
```

That's it. No `.env` file, no config, no account.

---

## Connecting Services

### Razorpay

1. Go to [Razorpay Dashboard](https://dashboard.razorpay.com) → **Settings** → **Webhooks** → **Add New Webhook**
2. Set the webhook URL:
   ```
   https://your-tunnel-url.trycloudflare.com/api/hooks/razorpay
   ```
3. Select events: `payment.captured`, `payment.failed`, `order.paid`
4. Click **Save**

In the HookRelay dashboard, set the forwarding URL:
```
http://host.docker.internal:3000/api/razorpay/payment
```

---

### Stripe

1. Go to [Stripe Dashboard](https://dashboard.stripe.com) → **Developers** → **Webhooks** → **Add endpoint**
2. Set the endpoint URL:
   ```
   https://your-tunnel-url.trycloudflare.com/api/hooks/stripe
   ```
3. Select events (e.g., `payment_intent.succeeded`, `charge.failed`)
4. Click **Add endpoint**

---

### GitHub

1. Go to your repo → **Settings** → **Webhooks** → **Add webhook**
2. Configure:
   ```
   Payload URL:   https://your-tunnel-url.trycloudflare.com/api/hooks/github
   Content type:  application/json
   Secret:        (leave blank for dev inspection)
   ```
3. Choose events and click **Add webhook**

---

### Shopify

1. **Shopify Admin** → **Settings** → **Notifications** → **Webhooks** → **Create webhook**
2. Configure:
   ```
   Event:   orders/create
   Format:  JSON
   URL:     https://your-tunnel-url.trycloudflare.com/api/hooks/shopify
   ```

---

### Any Other Service

Use this pattern:
```
https://your-tunnel-url.trycloudflare.com/api/hooks/{session-name}
```

| Service | Example URL |
|---|---|
| Stripe | `/api/hooks/stripe` |
| GitHub | `/api/hooks/github` |
| Razorpay | `/api/hooks/razorpay` |
| Shopify | `/api/hooks/shopify` |
| SendGrid | `/api/hooks/sendgrid` |
| Twilio | `/api/hooks/twilio-sms` |

---

## Forwarding to Your App

HookRelay doesn't just capture webhooks — it forwards them to your real application.

1. Open `http://localhost` in your browser
2. Type a session name (e.g., `razorpay`) and press Enter
3. In the **FWD →** input, type your app's endpoint:
   ```
   http://host.docker.internal:3000/api/webhooks/razorpay
   ```
4. Click **Save**

Now every webhook that arrives at this session is:
- Stored in Postgres
- Displayed in the dashboard
- Forwarded to your app
- Response recorded (200 ✅ / 500 ❌)

### Why `host.docker.internal`?

HookRelay runs inside Docker. `localhost` inside Docker means the container itself. `host.docker.internal` reaches your actual machine where your app is running.

---

## Replay

Click **↻ Replay** on any event card to re-send the exact same payload to your forwarding URL. This lets you:

- Debug your handler without triggering real payments
- Test error cases repeatedly
- Develop offline once you've captured one real payload

---

## Download

Click **↓ JSON** on any event card to download the raw payload as a `.json` file. Use this for:

- Writing unit tests with real data
- Sharing payloads with teammates
- Archiving webhook samples

---

## Troubleshooting

### Tunnel URL not showing in dashboard

The tunnel takes 5-10 seconds to start. Check the logs:
```bash
docker compose logs tunnel
```

If the tunnel keeps restarting, check your internet connection — `cloudflared` needs outbound access.

### Forwarding returns "Connection refused"

Your app isn't running on the expected port. Verify:
```bash
# On your machine (not inside Docker)
curl http://localhost:3000/api/webhooks/razorpay
```

### Events not appearing

Check that the webhook reached HookRelay:
```bash
curl http://localhost/api/hooks/razorpay
```

If empty, check the external service's delivery log (Stripe, GitHub, and Razorpay all show delivery attempts in their dashboards).

---

## What HookRelay Does and Doesn't Do

| ✅ Does | ❌ Does not |
|---|---|
| Stores all webhooks in Postgres on your machine | Store data in the cloud |
| Forwards to your app in real time | Require an account or API key |
| Replays stored events on demand | Verify webhook signatures (your app does that) |
| Provides a free HTTPS tunnel | Cost anything |
| Works offline after initial capture | Need a permanent domain |

---

*HookRelay — Catch. Inspect. Forward. Replay.*
