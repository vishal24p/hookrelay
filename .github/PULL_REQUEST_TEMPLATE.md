## Summary

- 

## Checks

- [ ] `docker compose -f docker-compose.yml config`
- [ ] `make health` after the stack is running
- [ ] No production-shaped Dockerfile or Compose file uses `:latest` or `--reload`

## Runtime Notes

- Dashboard defaults to `http://localhost:8080`.
- Forward host-machine apps with `host.docker.internal`, not `localhost`.
