#!/bin/bash
# Production preparation on the Coolify host: bootstrap the empty Coolify Postgres
# (container $DB) and run PostgREST next to it on the internal `coolify` network.
# Secrets are generated here into $SEC (root-only) and never printed.
set -u
DB=mpvfrbenkwtvziunmelx7ars
REST=xphere-postgrest
SEC=/root/xphere-db-build/prod
mkdir -p "$SEC" && chmod 700 "$SEC"
secret() { [ -s "$SEC/$1" ] || (umask 077; openssl rand -hex 32 > "$SEC/$1"); cat "$SEC/$1"; }

case "${1:-}" in
bootstrap)
  docker exec $DB pg_isready -U postgres -q || { echo "db not ready"; exit 1; }
  docker exec -i $DB psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < /root/xphere-db-build/bootstrap.sql 2>&1 | grep -vE "NOTICE|WARNING|HINT" ; echo "bootstrap exit=${PIPESTATUS[0]}"
  docker exec -i $DB psql -U postgres -d postgres -q -c "alter role authenticator password '$(secret authenticator.pass)'" && echo "authenticator password set"
  # safeupdate needs to be loadable; the role setting preloads it per session.
  docker exec $DB psql -U authenticator -h 127.0.0.1 -d postgres -At -c "select 'authenticator login ok'" 2>&1 | tail -1
  ;;
rest)
  secret jwt.secret >/dev/null
  docker rm -f $REST >/dev/null 2>&1
  docker run -d --name $REST --restart unless-stopped --network coolify --memory 256m \
    --label coolify.managed=false \
    -e PGRST_DB_URI="postgres://authenticator:$(secret authenticator.pass)@$DB:5432/postgres" \
    -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_DB_MAX_ROWS=1000 \
    -e PGRST_DB_EXTRA_SEARCH_PATH=public,extensions -e PGRST_JWT_SECRET="$(secret jwt.secret)" \
    -e PGRST_DB_POOL=20 -e PGRST_SERVER_PORT=3000 postgrest/postgrest:v14.5 >/dev/null
  sleep 5; docker logs $REST 2>&1 | tail -3 | cut -c1-160
  ;;
*) echo "usage: $0 bootstrap|rest"; exit 2 ;;
esac
