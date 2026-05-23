@AGENTS.md

# Project history (server only)

If the file `~/.claude/projects/-home-dv-trientes/memory/project_trientes_phase1.md` exists, read it — it documents phases 1-9 of the build (stack, deployed URLs, design language, worker cadences, server addresses, and known gotchas). On laptop checkouts the path won't exist; that's fine, skip silently.

# Deploy & push (server only)

This `/home/dv/trientes` checkout **IS the live production box** (trientes.org), not a clone. There is no separate deploy step over the wire — the site serves straight from this directory via PM2.

- **Deploy = local build + pm2 restart.** After changing code: `npm run build`, then `pm2 restart trientes-web`. For any change under `src/lib` that the worker imports, **also restart `trientes-worker`** — it runs via `tsx` and pins lib source at boot, so a web-only restart leaves the worker executing stale lib code (it will keep overwriting Redis caches with old-shaped data). `pm2 save` after.
- **Always push from here yourself.** The deploy key has write access; `git push origin main` works from this server. The laptop no longer pushes — never defer a push to it and never leave commits unpushed.

Full procedure, cadences, and the worker stale-lib gotcha: see the `project_trientes_deploy_from_server.md` memory.
