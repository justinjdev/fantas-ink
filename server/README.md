# Fantasy Standings Server

## Environment variables (set in Vercel project settings)

- `YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET` — from your Yahoo Developer app
- `YAHOO_REDIRECT_URI` — must match the redirect URI registered on the Yahoo app. Yahoo rejects the literal string `oob`; use a real-looking HTTPS URL instead (see step 1 below — it never needs to actually resolve to anything).
- `YAHOO_INITIAL_REFRESH_TOKEN` — bootstrap value from `setup-yahoo-auth.ts`; only used if Blob storage has no rotated token yet
- `YAHOO_LEAGUE_KEY`, `YAHOO_MY_TEAM_KEY` — from `setup-yahoo-auth.ts` output
- `CRON_SECRET` — random string; Vercel sends it automatically as `Authorization: Bearer <value>` when invoking cron-triggered functions
- `SHARED_TOKEN` — random string the ESP32 sends as `?token=` when calling `/api/standings`
- `BLOB_STORE_ID`, `VERCEL_OIDC_TOKEN` — auto-provided once a Blob store is connected to the project (Storage tab → your store → Connect Project); `@vercel/blob` uses OIDC auth automatically when both are present, no manual token needed
- `TOKEN_ENCRYPTION_KEY` — base64-encoded 32-byte AES-256 key encrypting the stored refresh token at rest in Blob (generate with `openssl rand -base64 32`); required both in Vercel's env and locally when running the setup script, since the script seeds the encrypted blob directly

## One-time setup

1. Register an app at https://developer.yahoo.com/apps/ as a **Confidential** client (this app keeps `YAHOO_CLIENT_SECRET` server-side only, never exposed to a browser). Redirect URI must be a real-looking HTTPS URL (Yahoo rejects `oob`) — it never needs to resolve to anything real, since the OAuth code is copied manually from the browser's address bar after redirect.
2. Separately, apply for Fantasy Sports API access at https://sports.yahoo.com/developer/access/ for the Client ID from step 1 — as of mid-2026 this is a manual review, no longer a checkbox at registration time. Read-only, single-league, personal-use requests are stated to be granted by default, but there's no published SLA.
3. Generate `TOKEN_ENCRYPTION_KEY` with `openssl rand -base64 32` and set it both in Vercel's env vars and locally (`export TOKEN_ENCRYPTION_KEY=...`) before running the setup script.
4. Connect the Blob store to the project (Storage tab → your store → Connect Project) before doing anything else — this is what makes `BLOB_STORE_ID`/`VERCEL_OIDC_TOKEN` available at all.
5. `vercel env pull` for `YAHOO_CLIENT_ID`/`YAHOO_CLIENT_SECRET`/`YAHOO_REDIRECT_URI` plus the Blob vars from step 4 — the setup script writes to Blob storage, so it needs these even for this one-time local run.
6. `cd server && node --env-file=.env.local --import tsx scripts/setup-yahoo-auth.ts` — follow the prompts, copy the printed `YAHOO_LEAGUE_KEY`/`YAHOO_MY_TEAM_KEY`/`YAHOO_INITIAL_REFRESH_TOKEN` into Vercel's env vars. (Use this exact form, not `npx tsx --env-file=...` — `tsx`'s own CLI doesn't honor `--env-file`, it silently ignores it.) The Blob-seeding step will fail locally with `BlobOidcEnvironmentNotAllowedError` — that's expected (Vercel only allows OIDC Blob access from real deployments), and the script continues past it. `api/cron.ts` seeds Blob itself on its first real run using `YAHOO_INITIAL_REFRESH_TOKEN`. The leagues/teams listing at the end requires step 2's access approval to have landed; if it hasn't, you'll still get `YAHOO_INITIAL_REFRESH_TOKEN` printed and can come back for `YAHOO_LEAGUE_KEY`/`YAHOO_MY_TEAM_KEY` once approved.
7. In the Vercel project's settings, set **Root Directory** to `server` — otherwise Vercel won't find the `api/` directory to deploy.
8. `vercel deploy --prod`

## Manual verification

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<your-deployment>.vercel.app/api/cron
curl "https://<your-deployment>.vercel.app/api/standings?token=$SHARED_TOKEN"
```

The second call should return real standings for your league. If the shape looks wrong (empty `rows`, thrown error in cron logs), inspect the raw Yahoo response — `lib/transform.ts`'s `findByKey`/`numberedEntries` helpers search by key name rather than fixed position specifically so this is the one place likely to need adjusting against the live API's exact nesting.
