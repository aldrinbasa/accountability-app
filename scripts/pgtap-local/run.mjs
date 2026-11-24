// Local pgTAP runner (no Docker): applies every supabase/migrations file to a fresh in-process
// PGlite database on top of prelude.sql (stand-ins for the Supabase auth, storage and cron
// schemas), installs the vendored test helpers, then runs the pgTAP files and prints per-file pass
// counts. Exits 1 on any failed assertion, plan mismatch or SQL error. CI keeps `supabase test db`.
//
// Usage (from the repo root): npm run test:db:local [-- file.test.sql ...]
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const migrationsDir = path.join(root, 'supabase/migrations')
const testsDir = path.join(root, 'supabase/tests')
const HELPERS = '00000_setup_test_helpers.sql'
const VENDORED_END = '-- ===== end vendored ====='

// First use: install the runner's own pinned dependency (never the app's package.json).
if (!fs.existsSync(path.join(here, 'node_modules/@electric-sql/pglite'))) {
  console.log('pgtap-local: installing @electric-sql/pglite (first run)...')
  // One command string through the shell, so npm.cmd resolves on Windows too.
  const install = spawnSync('npm ci --no-audit --no-fund', {
    cwd: here,
    stdio: 'inherit',
    shell: true,
  })
  if (install.status !== 0) {
    console.error('pgtap-local: npm ci failed')
    process.exit(1)
  }
}

const { PGlite } = await import('@electric-sql/pglite')
const { pgtap } = await import('@electric-sql/pglite/pgtap')

const db = new PGlite({ extensions: { pgtap } })

/** Runs a SQL script; on an error prints it with the text near its position and returns null. */
async function run(label, sql) {
  try {
    return await db.exec(sql)
  } catch (error) {
    console.log(`FAIL ${label}: ${error.message}`)
    if (error.position) {
      const at = Number(error.position)
      const near = sql.slice(Math.max(0, at - 200), at + 100).replace(/\n/g, '\n   ')
      console.log(`   near: ${near}`)
    }
    return null
  }
}

// 1. Supabase stand-ins, then every migration in order (pg_cron is not available in PGlite; the
// prelude provides a cron.schedule stand-in instead).
if (!(await run('prelude.sql', fs.readFileSync(path.join(here, 'prelude.sql'), 'utf8')))) {
  process.exit(1)
}
for (const file of fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()) {
  const sql = fs
    .readFileSync(path.join(migrationsDir, file), 'utf8')
    .replace(/create extension if not exists pg_cron;/g, '')
  if (!(await run(file, sql))) process.exit(1)
}

// 2. pgTAP and the vendored basejump helpers (the part of the setup file before its own tests).
await db.exec('set search_path to "$user", public, extensions')
if (!(await run('create extension pgtap', 'create extension pgtap with schema extensions'))) {
  process.exit(1)
}
const helpers = fs.readFileSync(path.join(testsDir, HELPERS), 'utf8').split(VENDORED_END)
if (!(await run(`${HELPERS} (helpers)`, helpers[0]))) process.exit(1)

// 3. The test files: the ones named, else every *.test.sql.
const named = process.argv.slice(2)
const files =
  named.length > 0
    ? named
    : fs
        .readdirSync(testsDir)
        .filter((f) => f.endsWith('.test.sql'))
        .sort()

let failedFiles = 0
let passedTotal = 0
for (const name of files) {
  const file = path.isAbsolute(name) ? name : path.join(testsDir, path.basename(name))
  if (!fs.existsSync(file)) {
    console.log(`FAIL ${name}: no such file`)
    failedFiles += 1
    continue
  }
  let sql = fs.readFileSync(file, 'utf8')
  // The setup file's own checks follow its vendored part.
  if (path.basename(file) === HELPERS) sql = helpers[1] ?? ''
  // PGlite has one connection and no dblink: drop tick.test.sql's busy-lock block (a second
  // session holding the tick lock). CI still runs it.
  sql = sql.replace(/do \$\$\ndeclare\n {2}v_conn text;[\s\S]*?\nend;\n\$\$;/, '')

  const results = await run(name, sql)
  if (!results) {
    await db.exec('rollback').catch(() => {})
    failedFiles += 1
    continue
  }

  let planned = null
  let total = 0
  let fails = 0
  const notes = []
  for (const result of results) {
    for (const row of result.rows) {
      for (const value of Object.values(row)) {
        if (typeof value !== 'string') continue
        for (const line of value.split('\n')) {
          const plan = /^1\.\.(\d+)/.exec(line)
          if (plan) planned = Number(plan[1])
          else if (/^not ok/.test(line)) {
            fails += 1
            total += 1
            notes.push(line)
          } else if (/^ok /.test(line)) total += 1
          else if (/^#/.test(line) && (fails > 0 || /^# Looks like/.test(line))) notes.push(line)
        }
      }
    }
  }
  const planMismatch = planned !== null && planned !== total
  // A file with no plan line or no assertions ran nothing: a failure, not "ok 0/0".
  const ranNothing = planned === null || total === 0
  const failed =
    fails > 0 || planMismatch || ranNothing || notes.some((line) => /^# Looks like/.test(line))
  for (const line of notes) console.log(`${name}: ${line}`)
  if (planMismatch) console.log(`${name}: planned ${planned}, ran ${total}`)
  if (ranNothing) console.log(`${name}: no plan line or no assertions`)
  console.log(`${failed ? 'FAIL' : 'ok  '} ${name}: ${total - fails}/${total} passed`)
  if (failed) failedFiles += 1
  passedTotal += total - fails
}

console.log(
  failedFiles === 0
    ? `pgtap-local: all ${files.length} files passed (${passedTotal} assertions)`
    : `pgtap-local: ${failedFiles} of ${files.length} files failed`,
)
await db.close()
process.exit(failedFiles === 0 ? 0 : 1)
