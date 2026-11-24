# Local pgTAP runner

Runs the pgTAP files in `supabase/tests` without Docker, against an in-process
[PGlite](https://pglite.dev) database (`@electric-sql/pglite` 0.3.14 with its `pgtap` extension).
Use it to catch SQL errors and failing assertions before a push. CI still runs the real
`supabase test db` in the `db-test` job; this runner does not replace it.

```bash
npm run test:db:local                                   # every supabase/tests/*.test.sql
npm run test:db:local -- votes.test.sql overturns.test.sql   # only the files named
```

- First run installs the runner's own dependency (`npm ci` in this folder, about 20 MB). It is a
  separate package with its own `package.json` and lockfile, so the app's `npm ci`, the app bundle
  and the layer map never see it. `node_modules` here is git-ignored.
- Each run starts from an empty database: `prelude.sql` (stand-ins for Supabase's roles and its
  `auth`, `storage` and `cron` schemas), then every migration in `supabase/migrations` in order,
  then pgTAP and the vendored helpers from `00000_setup_test_helpers.sql`.
- Prints `ok` or `FAIL` with the pass count per file. Exits 1 on a failed assertion, a plan that
  does not match the assertions run, a SQL error or a missing file.

Differences from CI: PGlite is one connection without `dblink` or `pg_cron`, so the migrations'
`create extension if not exists pg_cron;` is skipped and `tick.test.sql`'s busy-lock block (a
second session holding the tick lock) is dropped. Anything Supabase-specific beyond `prelude.sql`
can still differ, so a green local run is a pre-push check, not a substitute for CI.
