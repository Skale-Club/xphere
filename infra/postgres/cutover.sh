#!/bin/bash
# Database cutover on the Coolify host. Run as: cutover.sh go | rollback
# Reads the Coolify API token from $WORK/prod/coolify.token and the Supabase
# session-pooler URL from $WORK/source.url. Prints statuses only, never secrets.
#
# go: stop skale-cron and the app, dump Supabase, restore into the new database,
#     compare row counts, set the app env, start the app, wait for health, start
#     skale-cron. Any failure before the env switch restarts the app on Supabase.
set -u
WORK=/root/xphere-db-build
SEC=$WORK/prod
DB=mpvfrbenkwtvziunmelx7ars
APP=fwjo7xriuqibl01v96vah7fz
CRON=xvfw6wtcywgn06czk7bo2xb9
API=https://coolify.skale.club/api/v1
cd "$WORK" || exit 1
TOKEN=$(cat "$SEC/coolify.token")
H=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

say() { echo "[$(date -u +%H:%M:%S)] $*"; }
app_action() { curl -s -o /dev/null -w "%{http_code}" -X POST "${H[@]}" "$API/applications/$1/$2"; }
wait_app_down() { for i in $(seq 1 60); do docker ps --format '{{.Names}}' | grep -q "^$1" || return 0; sleep 2; done; return 1; }
wait_health() { for i in $(seq 1 90); do [ "$(curl -s -o /dev/null -w '%{http_code}' -m 5 https://xphere.app/api/health)" = 200 ] && return 0; sleep 4; done; return 1; }

# Upsert one production env var on the app (value read from stdin, never echoed).
set_env() { # $1 key; value on stdin
  local key=$1 value; value=$(cat)
  local body; body=$(jq -nc --arg k "$key" --arg v "$value" '{key:$k, value:$v, is_preview:false, is_literal:true}')
  local code; code=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "${H[@]}" -d "$body" "$API/applications/$APP/envs")
  [ "$code" = 201 ] || [ "$code" = 200 ] || code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${H[@]}" -d "$body" "$API/applications/$APP/envs")
  say "env $key -> $code"
}
del_env() { # $1 key
  local uuid; uuid=$(curl -s "${H[@]}" "$API/applications/$APP/envs" | jq -r --arg k "$1" '.[] | select(.key==$k and (.is_preview|not)) | .uuid' | head -1)
  [ -n "$uuid" ] && say "unset $1 -> $(curl -s -o /dev/null -w '%{http_code}' -X DELETE "${H[@]}" "$API/applications/$APP/envs/$uuid")"
}
current_env() { curl -s "${H[@]}" "$API/applications/$APP/envs" | jq -r --arg k "$1" '.[] | select(.key==$k and (.is_preview|not)) | (.real_value // .value)' | head -1 | sed -E "s/^['\"]|['\"]$//g"; }

abort() { say "ABORT: $*"; say "app start (still on Supabase): $(app_action $APP start)"; wait_health && say "app healthy on Supabase"; say "cron start: $(app_action $CRON start)"; exit 1; }

case "${1:-}" in
go)
  [ -s source.url ] || { say "missing source.url"; exit 1; }
  say "cron stop: $(app_action $CRON stop)"
  say "app stop: $(app_action $APP stop)"
  wait_app_down "$APP" || abort "app did not stop"
  say "app stopped; writes frozen"

  rm -f final.dump
  docker run --rm --network host -v "$WORK:/w" postgres:17-alpine \
    sh -c 'pg_dump "$(cat /w/source.url)" --schema=public --schema=supabase_migrations --no-owner -Fc -f /w/final.dump' \
    || abort "pg_dump failed"
  say "dump $(stat -c %s final.dump) bytes, sha256 $(sha256sum final.dump | cut -c1-16)"

  docker cp final.dump $DB:/tmp/final.dump
  docker exec $DB pg_restore -U postgres -d postgres --no-owner /tmp/final.dump 2> final-restore.err
  bad=$(grep 'error:' final-restore.err | grep -vc 'schema "public" already exists')
  [ "$bad" = 0 ] || { grep 'error:' final-restore.err | head -5 | cut -c1-160; abort "restore errors: $bad"; }
  say "restore ok"

  docker run --rm --network host -v "$WORK:/w" postgres:17-alpine sh -c 'psql "$(cat /w/source.url)" -X -q -f /w/compare.sql' > final-source.txt 2>&1
  docker exec -i $DB psql -U postgres -d postgres -X -q -f - < compare.sql > final-target.txt 2>&1
  if ! diff -q final-source.txt final-target.txt >/dev/null; then diff final-source.txt final-target.txt | head -10 | cut -c1-160; abort "source and target differ"; fi
  say "compare: identical ($(grep -c '^rows|' final-target.txt) tables)"

  # Switch the app to the new database.
  cat "$SEC/jwt.secret" | set_env DB_JWT_SECRET
  printf '%s' 'http://xphere-postgrest:3000' | set_env SUPABASE_REST_URL
  printf '%s' 'process-imports,process-embeddings,push-sender' | set_env EDGE_FUNCTIONS_IN_APP
  buckets=$(current_env STORAGE_R2_BUCKETS)
  echo "$buckets" > "$SEC/storage_r2_buckets.before"
  printf '%s' "$buckets,contact-imports,global-knowledge,knowledge-docs" | set_env STORAGE_R2_BUCKETS

  say "app start: $(app_action $APP start)"
  if wait_health; then say "app healthy on the new database"; else say "app NOT healthy: run rollback"; exit 1; fi
  say "cron start: $(app_action $CRON start)"
  ;;
rollback)
  say "cron stop: $(app_action $CRON stop)"
  del_env DB_JWT_SECRET; del_env SUPABASE_REST_URL; del_env EDGE_FUNCTIONS_IN_APP
  [ -s "$SEC/storage_r2_buckets.before" ] && cat "$SEC/storage_r2_buckets.before" | set_env STORAGE_R2_BUCKETS
  say "app restart: $(app_action $APP restart)"
  wait_health && say "app healthy on Supabase"
  say "cron start: $(app_action $CRON start)"
  say "NOTE: writes made on the new database since the cutover are NOT in Supabase"
  ;;
*) echo "usage: $0 go|rollback"; exit 2 ;;
esac
