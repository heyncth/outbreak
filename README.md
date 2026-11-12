# OUTBREAK — GPS Zombie Survival PWA

Specs: `docs/01`–`docs/10`.

```bash
pnpm install
pnpm dev
pnpm test
pnpm typecheck
```

Env (required — Supabase):

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=   # server routes only, never NEXT_PUBLIC_
```

Optional: `NEXT_PUBLIC_SUPABASE_ANON_KEY` as fallback for the publishable key.

Dev sim (runtime, default off): open `/?devsim=1` to enable, `/?devsim=0` to disable.
