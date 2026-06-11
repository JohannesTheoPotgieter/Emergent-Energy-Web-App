#!/usr/bin/env bash
#
# Self-contained proof that the daily backup actually restores to a working
# finance DB — no production credentials required.
#
# It stands up a throwaway PostgreSQL cluster, seeds a representative finance
# schema with deterministic numbers, then runs the REAL freeze tooling end to
# end:
#
#     scripts/backup-db.ts            → produce + validate a dump
#     scripts/verify-backup-restore.ts → restore into a scratch DB and assert
#                                        the finance numbers match exactly
#
# Anyone can re-run this to re-prove the restore path:
#
#     npm run backup:selftest
#
# Exit code is 0 only if the full round-trip passes. The cluster is always torn
# down on exit. Postgres servers refuse to run as root, so the cluster runs as
# the unprivileged `postgres` OS user when the script is invoked as root.
set -euo pipefail

PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
if [ -z "${PGBIN}" ]; then
  # Fall back to PATH (e.g. Homebrew / Nix) when the Debian layout is absent.
  PGBIN="$(dirname "$(command -v initdb)")"
fi
PORT="${SELFTEST_PG_PORT:-55678}"
WORK="$(mktemp -d /tmp/ee-backup-selftest.XXXXXX)"
DATADIR="${WORK}/data"
SOURCE_DB="ee_selftest_src"
TARGET_DB="ee_selftest_restore"
RUN_AS=""
if [ "$(id -u)" = "0" ] && id postgres >/dev/null 2>&1; then
  RUN_AS="postgres"
  chown -R postgres:postgres "${WORK}"
fi

log() { echo "[selftest] $*"; }

as_pg() {
  if [ -n "${RUN_AS}" ]; then su "${RUN_AS}" -c "$*"; else bash -c "$*"; fi
}

cleanup() {
  as_pg "'${PGBIN}/pg_ctl' -D '${DATADIR}' -m immediate -w stop" >/dev/null 2>&1 || true
  rm -rf "${WORK}" || true
}
trap cleanup EXIT

log "Postgres binaries: ${PGBIN}"
log "Scratch dir: ${WORK} (port ${PORT})"

# 1. Init + start a throwaway cluster (trust auth, loopback only).
as_pg "'${PGBIN}/initdb' -D '${DATADIR}' -U postgres --auth-local=trust --auth-host=trust" >"${WORK}/initdb.log" 2>&1
as_pg "'${PGBIN}/pg_ctl' -D '${DATADIR}' -o \"-p ${PORT} -c listen_addresses='127.0.0.1' -c unix_socket_directories='${WORK}'\" -l '${WORK}/pg.log' -w start"

PSQL="psql -v ON_ERROR_STOP=1 --no-psqlrc -h 127.0.0.1 -p ${PORT} -U postgres"

# 2. Create source + restore-target databases.
${PSQL} -d postgres -c "CREATE DATABASE ${SOURCE_DB};"
${PSQL} -d postgres -c "CREATE DATABASE ${TARGET_DB};"

# 3. Seed a representative finance schema with deterministic numbers.
#    Revenue Σ amount_ex_vat = 100.00 + 250.50 + 1000.00 = 1350.50
#    Cost    Σ amount_ex_vat =  40.00 + 300.25            =  340.25
${PSQL} -d "${SOURCE_DB}" <<'SQL'
CREATE TABLE project_info (id serial PRIMARY KEY, name text NOT NULL);
CREATE TABLE users (id serial PRIMARY KEY, email text NOT NULL);
CREATE TABLE normalized_revenue_lines (
  id serial PRIMARY KEY,
  project_id integer NOT NULL REFERENCES project_info(id),
  amount_ex_vat numeric(15,2),
  effective_to timestamp
);
CREATE TABLE normalized_cost_lines (
  id serial PRIMARY KEY,
  project_id integer NOT NULL REFERENCES project_info(id),
  amount_ex_vat numeric(15,2),
  effective_to timestamp
);
CREATE TABLE cashflow_points (id serial PRIMARY KEY, effective_to timestamp);
CREATE TABLE finance_revenue_monthly (id serial PRIMARY KEY, effective_to timestamp);
CREATE TABLE finance_cos_monthly (id serial PRIMARY KEY, effective_to timestamp);
CREATE TABLE finance_integrity_runs (id serial PRIMARY KEY, status text);

INSERT INTO project_info (name) VALUES ('Mondi'), ('Sappi');
INSERT INTO users (email) VALUES ('owner@example.com');
INSERT INTO normalized_revenue_lines (project_id, amount_ex_vat) VALUES (1, 100.00), (1, 250.50), (2, 1000.00);
INSERT INTO normalized_cost_lines (project_id, amount_ex_vat) VALUES (1, 40.00), (2, 300.25);
INSERT INTO cashflow_points DEFAULT VALUES;
INSERT INTO finance_revenue_monthly DEFAULT VALUES;
INSERT INTO finance_cos_monthly DEFAULT VALUES;
INSERT INTO finance_integrity_runs (status) VALUES ('pass');
SQL

log "Source seeded (revenue Σ 1350.50, cost Σ 340.25)."

# 4. Run the REAL backup tool against the source DB.
BACKUP_DIR="${WORK}/backups"
export BACKUP_DIR
export BACKUP_SOURCE_DATABASE_URL="postgres://postgres@127.0.0.1:${PORT}/${SOURCE_DB}"
log "Running scripts/backup-db.ts …"
npx --no-install tsx scripts/backup-db.ts

# 5. Run the REAL restore-verify tool: restore into the scratch target and
#    assert the finance fingerprint equals the source exactly.
export RESTORE_TARGET_DATABASE_URL="postgres://postgres@127.0.0.1:${PORT}/${TARGET_DB}"
log "Running scripts/verify-backup-restore.ts …"
npx --no-install tsx scripts/verify-backup-restore.ts

log "ROUND-TRIP PASSED — backup produced, restored, and finance numbers matched."
