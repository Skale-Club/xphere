#!/bin/bash
# Rehearsal of the database move, on the Coolify host. Disposable: everything it
# creates is named xphere-rehearsal* and lives on its own Docker network with no
# published port. Reads Supabase only (pg_dump). Never touches production config.
#
# Inputs (files in $WORK, mode 600, deleted at the end):
#   source.url   Supabase session-pooler URL (port 5432), read only by pg_dump
# Usage: rehearse.sh up | dump | restore | rest | down
set -u
WORK=/root/xphere-db-build
NET=xphere-rehearsal
DB=xphere-rehearsal-db
REST=xphere-rehearsal-rest
IMG=xphere-postgres:17
cd "$WORK" || exit 1

secret() { [ -f "$1" ] || (umask 077; openssl rand -hex 32 > "$1"); cat "$1"; }

case "${1:-}" in
up)
  docker network inspect $NET >/dev/null 2>&1 || docker network create $NET >/dev/null
  docker rm -f $DB >/dev/null 2>&1
  docker volume rm xphere-rehearsal-data >/dev/null 2>&1
  docker run -d --name $DB --network $NET --memory 1g --cpus 1.5 \
    -e POSTGRES_PASSWORD="$(secret pg.pass)" -v xphere-rehearsal-data:/var/lib/postgresql/data \
    $IMG -c shared_buffers=256MB -c max_connections=60 -c shared_preload_libraries=pg_stat_statements >/dev/null
  for i in $(seq 1 30); do docker exec $DB pg_isready -U postgres -q && break; sleep 1; done
  docker exec -i $DB psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < bootstrap.sql && echo "bootstrap ok"
  docker exec -i $DB psql -U postgres -d postgres -q -c "alter role authenticator password '$(secret auth.pass)'" && echo "authenticator ok"
  ;;
dump)
  t0=$(date +%s)
  docker run --rm --network host -v "$WORK:/w" -e SRC_FILE=/w/source.url postgres:17-alpine \
    sh -c 'pg_dump "$(cat $SRC_FILE)" --schema=public --schema=supabase_migrations --no-owner -Fc -f /w/xphere.dump' \
    && echo "dump ok in $(( $(date +%s) - t0 ))s, $(stat -c %s xphere.dump) bytes, sha256 $(sha256sum xphere.dump | cut -c1-16)"
  ;;
restore)
  t0=$(date +%s)
  docker cp xphere.dump $DB:/tmp/xphere.dump
  docker exec $DB pg_restore -U postgres -d postgres --no-owner /tmp/xphere.dump 2> restore.err
  echo "restore exit=$? in $(( $(date +%s) - t0 ))s, error lines=$(grep -c 'error:' restore.err)"
  grep 'error:' restore.err | sed -E 's/^pg_restore: error: //' | cut -c1-160 | sort | uniq -c | sort -rn | head -15
  ;;
rest)
  docker rm -f $REST >/dev/null 2>&1
  docker run -d --name $REST --network $NET --memory 256m \
    -e PGRST_DB_URI="postgres://authenticator:$(secret auth.pass)@$DB:5432/postgres" \
    -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_DB_MAX_ROWS=1000 \
    -e PGRST_DB_EXTRA_SEARCH_PATH=public,extensions -e PGRST_JWT_SECRET="$(secret jwt.secret)" \
    -e PGRST_DB_POOL=10 postgrest/postgrest:v14.5 >/dev/null && sleep 4 && docker logs $REST 2>&1 | tail -4 | cut -c1-160
  ;;
down)
  docker rm -f $REST $DB >/dev/null 2>&1
  docker volume rm xphere-rehearsal-data >/dev/null 2>&1
  docker network rm $NET >/dev/null 2>&1
  rm -f source.url xphere.dump restore.err pg.pass auth.pass jwt.secret
  echo "rehearsal removed"
  ;;
*) echo "usage: $0 up|dump|restore|rest|down"; exit 2 ;;
esac
