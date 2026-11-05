#!/bin/bash
# Apply pending migrations to PRODUCTION (the Coolify Postgres on the Hetzner host).
#
# Since 2026-11-05 `npx supabase db push` reaches only the Supabase project, which
# is the development database. Production is the container below; this script is
# its equivalent of `db push`: it applies every file in supabase/migrations whose
# number is above the newest version recorded in production, one transaction per
# file, and records each in supabase_migrations.schema_migrations, so both
# databases keep the same history.
#
# Usage (from the repo root):  scripts/migrate-prod.sh          # list pending
#                              scripts/migrate-prod.sh --apply  # apply them
set -euo pipefail
HOST=root@coolify.skale.club
DB=mpvfrbenkwtvziunmelx7ars
psql_prod() { ssh -o BatchMode=yes "$HOST" "docker exec -i $DB psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 $*"; }

latest=$(echo "select max(version::bigint) from supabase_migrations.schema_migrations;" | psql_prod -At -f -)
echo "production is at migration $latest"

pending=()
for f in supabase/migrations/*.sql; do
  v=$(basename "$f" | cut -d_ -f1)
  [[ "$v" =~ ^[0-9]+$ ]] || continue
  (( 10#$v > latest )) && pending+=("$f")
done
IFS=$'\n' pending=($(printf '%s\n' "${pending[@]:-}" | grep . | sort -t/ -k3 -n)); unset IFS
[ ${#pending[@]} -eq 0 ] && { echo "nothing pending"; exit 0; }
printf 'pending: %s\n' "${pending[@]}"
[ "${1:-}" = "--apply" ] || { echo "dry run; pass --apply to apply"; exit 0; }

for f in "${pending[@]}"; do
  name=$(basename "$f" .sql); v=${name%%_*}; label=${name#*_}
  { echo "begin;"; cat "$f"; echo ";"
    echo "insert into supabase_migrations.schema_migrations(version, name) values ('$v', '$label');"
    echo "commit;"; } | psql_prod -q -f - && echo "applied $name" || { echo "FAILED $name (rolled back)"; exit 1; }
done
