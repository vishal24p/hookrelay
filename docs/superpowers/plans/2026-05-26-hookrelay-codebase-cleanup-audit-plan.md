# HookRelay Codebase Cleanup Audit And Plan

## Summary

The codebase is now useful, but it needs cleanup before more features.

The most important finding is not style. It is product correctness: the local app works, but the public tunnel webhook path fails with `502 Bad Gateway` because `public_ingress` cannot resolve the backend service name.

Fix that first. Then clean the code in small steps.

## What The App Does Today

HookRelay currently does this:

- Creates a local browser UI at `http://127.0.0.1/`.
- Shows the developer a public Cloudflare tunnel URL.
- Lets the developer configure an endpoint session.
- Supports Razorpay mode.
- Stores Razorpay webhook secret locally.
- Generates Razorpay-shaped fixture payloads.
- Captures webhook events.
- Verifies Razorpay signatures.
- Extracts Razorpay event/payment/order/refund/subscription metadata.
- Detects duplicate Razorpay deliveries by event id.
- Forwards captured events to a local app.
- Replays captured events to the configured forward target.
- Shows captured events in the frontend through history and WebSocket updates.

## Current Architecture Assessment

### Keep

- Keep the local OSS developer-machine model.
- Keep Docker Compose as the default runtime.
- Keep the two-ingress design:
  - `local_ingress` for browser and local API.
  - `public_ingress` for provider webhook traffic only.
- Keep Postgres for event/session persistence.
- Keep Redis pub/sub for WebSocket updates.
- Keep small Razorpay helper modules and their unit tests.
- Keep event capture as raw body plus raw headers. That is needed for replay and signature diagnostics.

### Change

- Fix public ingress DNS resolution.
- Add API-level tests for routes, not only helper functions.
- Split `main.py` after the public path works.
- Split `App.jsx` CSS/layout/state before implementing the new UI.
- Replace setup-first UI with event-first UI after cleanup.

### Remove Or Avoid

- Avoid a generic provider framework right now.
- Avoid adding more setup panels.
- Avoid adding more provider-specific logic directly into `main.py`.
- Avoid building around GitHub or any unrelated webhook provider.
- Avoid committing generated screenshots, CodeGraph index files, browser profiles, or local logs.

## Cleanup Priorities

## P0: Fix Public Webhook Delivery

Problem:

- The UI shows a public URL.
- Local API works.
- Cloudflare tunnel is connected.
- But posting to the public URL returns `502 Bad Gateway`.

Evidence:

```text
public_ingress nginx: no resolver defined to resolve api
```

Technical explanation:

- `nginx/public.conf` uses a regex location:

```nginx
location ~ ^/api/hooks/([^/]+)$
```

- It then uses `$1` inside `proxy_pass`.
- nginx treats this as runtime resolution.
- Docker service name `api` requires Docker DNS resolver `127.0.0.11`.
- Without an explicit resolver, nginx cannot resolve `api` during the request.

Real-world example:

- The shop has the correct street address printed on the receipt, but the delivery person cannot resolve the building name into a real location. The address exists; the lookup step is broken.

What to change:

- Update `nginx/public.conf` to define Docker DNS resolver.
- Retest public POST through the Cloudflare tunnel URL.

Success criteria:

- `POST {tunnel_url}/api/hooks/{session}` returns `{"status":"received","id":...}`.
- Event appears in `GET /api/hooks/{session}`.
- Browser UI shows the public event.

## P1: Add Backend API Smoke Tests

Problem:

- Current tests prove helper functions.
- They do not prove route behavior.

Technical explanation:

- `receive_webhook`, `update_session_config`, `create_razorpay_fixture_request`, and `replay_event` are the important product paths.
- A helper test can pass while a route still fails because of dependency injection, database behavior, Redis publishing, or response shape.

Real-world example:

- Testing a car engine on a bench is useful, but the car still needs a road test. The API routes are the road test.

What to change:

- Add tests for:
  - session config create/update.
  - fixture generation with configured Razorpay secret.
  - event capture.
  - duplicate detection across two captured events.
  - replay requiring forward URL.
  - replay creating a `REPLAY` event when forward URL exists.

Success criteria:

- `python -m unittest discover -s backend/tests -p "test_*.py"` covers both helpers and API flow.

## P1: Split Backend Responsibilities Carefully

Problem:

- `backend/app/main.py` owns too many responsibilities.

It currently owns:

- FastAPI app setup.
- routers.
- schema serialization.
- session config CRUD.
- webhook capture.
- forwarding.
- replay.
- WebSocket handling.
- tunnel URL reading.
- Razorpay signature verification wrapper.

Technical explanation:

- Files that mix routes, business logic, database writes, serialization, and network delivery become risky to change.
- For example, changing replay logic can accidentally affect event serialization or tunnel routes because everything lives together.

Real-world example:

- If a restaurant keeps menu edits, kitchen recipes, order queue, and billing in one spreadsheet, every change risks breaking something unrelated.

What to change after P0:

- Move event serialization into a small serializer module.
- Move signature verification into a Razorpay diagnostics module.
- Move forwarding/replay orchestration into a delivery module only if route tests are already passing.
- Keep routers thin, but do not create a large abstraction layer.

What not to do:

- Do not create `providers/base.py`.
- Do not create a plugin system.
- Do not split every route into a separate file.

Success criteria:

- Every extracted function has current tests or route tests.
- Public webhook, fixture, replay, and frontend browser smoke still pass after each extraction.

## P1: Split Frontend CSS And Layout From `App.jsx`

Problem:

- `frontend/src/App.jsx` contains app orchestration and a large CSS string.
- This makes redesign risky.

Technical explanation:

- UI redesign will require layout and styling changes.
- If styling lives beside API polling, config saves, copy actions, endpoint deletion, and dialog state, the diff becomes noisy and harder to review.

Real-world example:

- Repainting a control room should not require moving the electrical wiring. `App.jsx` currently mixes the paint and the wiring.

What to change:

- Move the CSS string to a dedicated stylesheet or style module.
- Keep behavior in `App.jsx`.
- Then change layout components in a separate step.

Success criteria:

- No behavioral diff.
- Frontend build passes.
- Browser screenshot looks the same before and after CSS extraction.

## P1: Replace Setup-First UI With Event-First UI

Problem:

- Current UI treats setup as the main object.
- A webhook debugger should treat events and delivery status as the main object.

Technical explanation:

- Developers open this tool to answer:
  - Did Razorpay reach my machine?
  - Was the signature valid?
  - Did my local handler return 2xx?
  - Will Razorpay retry?
  - Can I replay the same event?

The current UI puts public URL/provider/forward/fixture above the event result. That is useful on first run, but too heavy during daily debugging.

Real-world example:

- In an airport control room, the flight radar is central. The Wi-Fi setup panel is not central after the system is connected.

What to change:

- Use the selected design direction: event inbox + inspector.
- Make event list central.
- Make selected event diagnostics visible without forcing raw JSON first.
- Make setup compact and secondary.

Success criteria:

- On first load, developer sees what endpoint is active and how to send a test.
- After an event arrives, developer sees event status, signature, forward result, duplicate status, and replay action without scrolling.

## P2: Clarify Session And Endpoint Concepts

Problem:

- Frontend has local drafts, saved backend sessions, labels, and hash-based endpoint ids.
- This works, but the mental model is not clean.

Technical explanation:

- The backend treats `session_id` as the durable endpoint id.
- The frontend also stores local labels/history.
- Some endpoints are saved, some are local drafts, and the UI needs to explain that through behavior, not text.

Real-world example:

- A browser bookmark and a server account are not the same thing. The UI should not make the developer wonder which one they are editing.

What to change:

- Keep hash-based endpoint id for now.
- Reduce local draft states in the UI.
- Prefer backend sessions as the source of truth once any event/config exists.

Success criteria:

- A developer can tell whether an endpoint exists only locally or has server data.
- Deleting an endpoint behaves predictably.

## P2: Improve Tunnel URL Freshness

Problem:

- The backend reads the tunnel URL from `/shared/tunnel_url.txt`.
- The frontend polls `/api/tunnel-url`.
- This is simple and acceptable, but stale tunnel URL risk exists.

Technical explanation:

- Quick tunnels can change.
- If the file is stale, UI can show an old public URL.
- The E2E test already proved the URL can be present while provider delivery still fails.

Real-world example:

- A hotel sign can show a phone number, but that does not prove the phone line works.

What to change:

- After public ingress is fixed, add a lightweight public URL health indicator.
- Do not overbuild external tunnel management yet.

Success criteria:

- UI distinguishes:
  - tunnel URL unavailable.
  - tunnel URL present.
  - last public webhook received.

## P2: Document Local Runtime Modes

Problem:

- Backend defaults use Docker service names: `postgres`, `redis`.
- Running backend directly on the host fails unless local URLs are provided.

Technical explanation:

- Docker mode and host mode are different dependency graphs.
- A new contributor can lose time debugging database hostnames.

Real-world example:

- The same app has two addresses: one from inside the office network and one from outside. The docs must say which address applies.

What to change:

- Document Docker-first workflow.
- Document host-run requirements only if we want to support host-run officially.

Success criteria:

- New developer can start the app without guessing env vars.

## Replacement Map

| Current | Replace With | Why |
|---|---|---|
| `nginx/public.conf` without resolver | Public ingress with Docker DNS resolver | Fix provider-facing 502 |
| Helper-only backend tests | API route smoke tests plus helper tests | Catch real app failures |
| Large `main.py` service logic | Small serializer/diagnostics/delivery modules | Reduce accidental route breakage |
| `App.jsx` with behavior and CSS | Behavior in component code, styles separated | Make redesign safer |
| Setup-first UI | Event inbox plus inspector | Match actual webhook debugging workflow |
| Heavy local draft sidebar | Simpler endpoint list with server-backed state | Reduce endpoint confusion |

## Recommended Implementation Order

1. Public ingress fix.
2. Public webhook E2E retest.
3. Backend API smoke tests.
4. Backend low-risk extraction:
   - serialization.
   - Razorpay signature diagnostics.
5. Frontend CSS extraction.
6. Frontend event-first redesign.
7. Session/endpoint simplification.
8. Tunnel freshness indicator.

## First Cleanup Feature Plan

Start with public ingress.

Why:

- It is the only P1 product blocker found by E2E.
- It is small.
- It is verifiable.
- It directly affects the core promise: copy public URL into Razorpay and receive local events.

Implementation scope:

- `nginx/public.conf`
- Maybe one doc/test note if needed.

Verification:

- `docker compose up --build -d`
- `POST {tunnel_url}/api/hooks/{session}`
- `GET /api/hooks/{session}`
- browser smoke screenshot

Do not combine this with frontend redesign.

## Karpathy Constraints

- Keep the fix surgical.
- Do not refactor `main.py` in the same step as the ingress fix.
- Do not create provider abstractions.
- Do not change frontend layout until public provider delivery works.
- Every cleanup step must have a command or browser check that proves it worked.
