# HookRelay

HookRelay is a self-hosted webhook inspector for local development. It receives Razorpay webhooks, stores the payloads locally, shows them in a React dashboard, forwards them to your local app, and lets you replay events while debugging.

The project is intentionally local-first. Webhook payloads are stored in your own PostgreSQL container, not in a hosted request-bin service.

## What It Does

- Receive Razorpay webhook payloads at a session-specific endpoint.
- Inspect headers, body, query parameters, delivery status, and forwarding errors.
- Forward each event to a local handler such as `http://host.docker.internal:3000/api/webhooks/razorpay`.
- Replay stored events without creating a new payment event.
- Generate Razorpay fixture payloads for local testing.
- Track Razorpay metadata such as event type, payment ID, order ID, refund ID, and subscription ID.

## Stack

- Backend: FastAPI, SQLAlchemy, PostgreSQL, Redis
- Frontend: React, Vite
- Local runtime: Docker Compose
- Tests: Python `unittest`, npm build and lint scripts

## Quick Start

```bash
git clone https://github.com/vishal24p/hookrelay.git
cd hookrelay
docker compose up --build
```

Open the dashboard at:

```text
http://localhost
```

If port `80` is already in use, change the Nginx mapping in `docker-compose.yml` from `80:80` to another host port, for example `8080:80`, then open `http://localhost:8080`.

## Local Webhook Flow

```text
Razorpay
  -> HookRelay public or local ingest URL
  -> FastAPI stores the event
  -> React dashboard updates over WebSocket
  -> FastAPI forwards the payload to your local app
```

Inside Docker, use `host.docker.internal` when forwarding to an app running on your host machine. `localhost` from inside the backend container points back to the container.

## Dashboard Use

1. Create or select an endpoint in the sidebar.
2. Set the provider to `razorpay`.
3. Add your Razorpay webhook secret if you want signature-aware local tests.
4. Set the forward URL to your local handler.
5. Send a Razorpay test webhook to the endpoint URL shown in the dashboard.
6. Inspect, replay, or download the stored event.

## API Examples

Receive a webhook locally:

```bash
curl -X POST http://localhost/api/hooks/razorpay-dev \
  -H "Content-Type: application/json" \
  -d '{"event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_test","order_id":"order_test"}}}}'
```

Configure forwarding for a session:

```bash
curl -X PUT http://localhost/api/sessions/razorpay-dev/config \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "razorpay",
    "forward_url": "http://host.docker.internal:3000/api/webhooks/razorpay"
  }'
```

Replay a stored event:

```bash
curl -X POST http://localhost/api/hooks/razorpay-dev/42/replay
```

## Development Checks

Backend tests:

```bash
python -m pip install -r backend/requirements.txt
python -m unittest discover -s backend/tests -p "test_*.py"
```

Frontend checks:

```bash
cd frontend
npm ci
npm run lint
npm run build
```

If `make` is available, use:

```bash
make check
```

## Environment

Copy `.env.example` to `.env` only when you need to override local settings:

```bash
cp .env.example .env
```

Keep real webhook secrets in `.env`; do not commit them.

## CI

GitHub Actions runs:

- backend tests with Python 3.11
- frontend build with Node 20
- frontend lint with Node 20
- license checks for the MIT license file
- Docker Compose config validation

## Privacy

HookRelay stores webhook payloads in the local PostgreSQL volume created by Docker Compose. Payloads may still cross any network tunnel you configure before reaching your machine. Use test-mode payment data and avoid sending production secrets to local development tools.

## Contributing

Please open focused issues using the GitHub issue forms:

- bug reports: `.github/ISSUE_TEMPLATE/bug.yml`
- feature requests: `.github/ISSUE_TEMPLATE/feature_request.yml`

Before opening a pull request, run:

```bash
make check
```

## License

MIT License. See [LICENSE](LICENSE).
