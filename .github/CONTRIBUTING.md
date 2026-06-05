# Contributing

Thanks for helping improve this project. Keep changes focused, include tests
when behavior changes, and prefer small pull requests that are easy to review.

## Development Setup

Install the backend and frontend dependencies used by the part of the project
you are changing.

## Backend Checks

Run the backend test suite before opening a pull request:

```bash
python -m pytest
```

## Frontend Checks

Install dependencies and run the frontend checks:

```bash
npm install
npm run lint --if-present
npm test --if-present
npm run build --if-present
```

If the project has a lockfile, `npm ci` is preferred for CI-style local
verification.

## Docker Development

Start the development stack:

```bash
docker compose up --build
```

Stop and remove the development stack:

```bash
docker compose down
```

## Pull Requests

Before requesting review:

* Keep the change scoped to one purpose.
* Update documentation when commands, behavior, or setup steps change.
* Run the relevant backend, frontend, and Docker checks listed above.
* Link related issues and explain any intentionally skipped checks.
