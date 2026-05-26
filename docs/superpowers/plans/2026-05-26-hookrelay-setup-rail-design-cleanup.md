# HookRelay Setup Rail Design Cleanup Plan

## Summary

Fix the first visible design problem after the Razorpay fixture work: the setup rail no longer fits the workflow. Four setup steps are rendered in a three-column grid, the fixture action is visually demoted, and nested cards make the local debugging flow slower to scan.

This plan is only for the setup rail and the small styling changes needed to support it. It is not a full redesign.

## Goal

Make the Razorpay developer workflow easier to read and faster to use:

- Copy public webhook URL.
- Choose Razorpay mode and secret.
- Set local forward target.
- Send a Razorpay fixture.
- See captured events and diagnostics below.

## Assumptions

- HookRelay is a local developer machine tool, not a marketing product.
- The current dark UI can stay for now.
- The backend fixture, replay, duplicate, and forwarding logic stays unchanged.
- No new frontend dependencies are needed.
- No provider framework or new feature is added in this design pass.

## Files To Change

- `frontend/src/components/SetupRail.jsx`
  - Rebalance the four setup steps.
  - Make the fixture action visually primary enough for the Razorpay workflow.
  - Reduce nested card structure where possible.

- `frontend/src/App.jsx`
  - Update setup rail grid CSS.
  - Reduce setup card radius and nested surface weight.
  - Improve small diagnostic typography and contrast where this plan touches shared classes.

- `frontend/src/ui.js`
  - Keep fixture option data unchanged unless labels need tiny clarity edits.

## Out Of Scope

- Backend changes.
- New fixtures.
- New icons or icon library.
- Full design system.
- Rewriting the event inspector.
- Changing the event schema.
- Replacing the app shell or sidebar.

## Implementation Plan

### 1. Fix The Four-Step Layout

- Change `.setup-grid` so four steps render as a balanced layout.
- Preferred layout: 2x2 on wide screens.
- Keep one-column layout below the existing responsive breakpoint.

Success criteria:

- Step 4 no longer appears alone on a second row.
- The setup rail reads as one complete workflow.
- No horizontal overflow on desktop.

### 2. Make Send Fixture Feel Like A Primary Workflow Step

- Keep the fixture selector in step 4.
- Make the send button and selected fixture easier to scan.
- Keep the current behavior: `sendTestWebhook(selectedFixtureKey)`.

Success criteria:

- A developer can immediately see how to send a Razorpay fixture.
- The fixture action does not look less important than copy/save controls.
- No behavior changes to fixture sending.

### 3. Flatten Setup Card Internals

- Reduce nested card feeling inside setup cards.
- Keep labels and values, but make inner blocks lighter.
- Preserve copy buttons, secret input, forward input, and fixture select.

Success criteria:

- Setup cards contain fewer heavy bordered surfaces.
- URL, secret, forward target, and fixture controls remain clearly grouped.
- No form control loses its visible label.

### 4. Tighten Styling Tokens Used By Setup And Diagnostics

- Reduce `setup-card` and `surface-card` radius from the current 20px.
- Reduce inner `setup-value` radius.
- Improve metadata label readability where shared classes are touched.
- Keep status colors meaningful: success, warning, error, info.

Success criteria:

- The UI reads more like a developer debugger than a dashboard.
- Important metadata labels are easier to read.
- The event list and inspector still look consistent.

## Verification

Run these checks after implementation:

- `npm exec vite -- build --outDir ../.vite-build-tmp --emptyOutDir`
- `python -m unittest discover -s backend/tests -p "test_*.py"`
- `git diff --check`

Manual checks:

- Razorpay mode selected.
- Fixture selector visible in step 4.
- `Send Fixture` still sends the selected fixture.
- Event feed updates after sending a fixture.
- Inspector still shows signature, duplicate, fixture, and forward diagnostics.

## Karpathy Constraints

- Keep the change surgical.
- Do not add new frontend dependencies.
- Do not touch backend logic.
- Do not redesign the whole app.
- Every changed line must support the setup rail cleanup or typography/readability fixes listed here.

## Done When

- The plan is implemented without broad redesign.
- Tests and build pass.
- The setup rail presents four balanced steps.
- Razorpay fixture sending is visually easy to find and still works.
