#!/bin/bash
# Daily backup of Xphere's production Postgres to the private R2 bucket.
# Usage: backup.sh setup | run | verify | keep <file> <key>
#   setup   copy the app's R2 credentials from Coolify into $SEC/r2.env (root only)
#   run     pg_dump -Fc, upload to db-backups/YYYY-MM-DD.dump, keep 14 days
#   verify  restore the newest backup into a throwaway container and compare counts
#   keep    upload one file to the given key (used for the cutover dump)
# Prints statuses only, never secrets.
set -u
WORK=/root/xphere-db-build
SEC=$WORK/prod
DB=mpvfrbenkwtvziunmelx7ars
APP=fwjo7xriuqibl01v96vah7fz
KEEP_DAYS=14
cd "$WORK" || exit 1

aws() { # runs the AWS CLI against R2 with the stored credentials
  docker run --rm -i --env-file "$SEC/r2.env" -v "$WORK:/w" amazon/aws-cli:2.22.35 \
    --endpoint-url "https://$(grep '^R2_ACCOUNT_ID=' "$SEC/r2.env" | cut -d= -f2).r2.cloudflarestorage.com" --region auto "$@"
}
bucket() { grep '^R2_PRIVATE_BUCKET=' "$SEC/r2.env" | cut -d= -f2; }

case "${1:-}" in
setup)
  TOKEN=$(cat "$SEC/coolify.token")
  curl -s -H "Authorization: Bearer $TOKEN" "https://coolify.skale.club/api/v1/applications/$APP/envs" \
    | jq -r '.[] | select((.is_preview|not) and (.key|test("^R2_(ACCOUNT_ID|ACCESS_KEY_ID|SECRET_ACCESS_KEY|PRIVATE_BUCKET)$"))) | "\(.key)=\((.real_value // .value) | sub("^[\"'"'"']";"") | sub("[\"'"'"']$";""))"' \
    | sed -e 's/^R2_ACCESS_KEY_ID=/AWS_ACCESS_KEY_ID=/' -e 's/^R2_SECRET_ACCESS_KEY=/AWS_SECRET_ACCESS_KEY=/' > "$SEC/r2.env.tmp"
  # keep R2_ACCOUNT_ID and R2_PRIVATE_BUCKET too, for the endpoint and bucket name
  (umask 077; mv "$SEC/r2.env.tmp" "$SEC/r2.env")
  echo "r2.env keys: $(cut -d= -f1 "$SEC/r2.env" | sort | tr '\n' ' ')"
  aws s3 ls "s3://$(bucket)/" >/dev/null && echo "r2 access ok" || echo "r2 access FAILED"
  ;;
keep)
  aws s3 cp "/w/$2" "s3://$(bucket)/$3" --only-show-errors && echo "uploaded $3 ($(stat -c %s "$2") bytes, sha256 $(sha256sum "$2" | cut -c1-16))"
  ;;
run)
  day=$(date -u +%F); f=backup-$day.dump
  docker exec $DB pg_dump -U postgres -d postgres --schema=public --schema=supabase_migrations -Fc -f /tmp/$f \
    && docker cp $DB:/tmp/$f "$WORK/$f" && docker exec $DB rm -f /tmp/$f || { echo "pg_dump FAILED"; exit 1; }
  aws s3 cp "/w/$f" "s3://$(bucket)/db-backups/$day.dump" --only-show-errors || { echo "upload FAILED"; exit 1; }
  echo "backup $day: $(stat -c %s "$f") bytes, sha256 $(sha256sum "$f" | cut -c1-16)"
  rm -f "$WORK/$f"
  cutoff=$(date -u -d "-$KEEP_DAYS days" +%F)
  aws s3 ls "s3://$(bucket)/db-backups/" | awk '{print $4}' | while read -r k; do
    [ -n "$k" ] && [ "${k%.dump}" \< "$cutoff" ] && aws s3 rm "s3://$(bucket)/db-backups/$k" --only-show-errors && echo "pruned $k"
  done
  ;;
verify)
  k=$(aws s3 ls "s3://$(bucket)/db-backups/" | awk '{print $4}' | sort | tail -1)
  [ -n "$k" ] || { echo "no backup found"; exit 1; }
  aws s3 cp "s3://$(bucket)/db-backups/$k" /w/verify.dump --only-show-errors
  docker rm -f xphere-backup-verify >/dev/null 2>&1
  docker run -d --name xphere-backup-verify --memory 768m -e POSTGRES_PASSWORD=verify xphere-postgres:17 >/dev/null
  for i in $(seq 1 30); do docker exec xphere-backup-verify pg_isready -U postgres -q && break; sleep 1; done
  docker exec -i xphere-backup-verify psql -U postgres -d postgres -q < bootstrap.sql >/dev/null 2>&1
  docker cp verify.dump xphere-backup-verify:/tmp/v.dump
  docker exec xphere-backup-verify pg_restore -U postgres -d postgres --no-owner /tmp/v.dump 2> verify.err
  echo "restore of $k: error lines $(grep 'error:' verify.err | grep -vc 'schema "public" already exists')"
  docker exec -i xphere-backup-verify psql -U postgres -d postgres -X -q -f - < compare.sql | grep '^rows|' > verify-target.txt
  docker exec -i $DB psql -U postgres -d postgres -X -q -f - < compare.sql | grep '^rows|' > verify-live.txt
  echo "tables: live $(wc -l < verify-live.txt), restored $(wc -l < verify-target.txt), differing lines: $(diff verify-live.txt verify-target.txt | grep -c '^[<>]')"
  docker rm -f xphere-backup-verify >/dev/null; rm -f verify.dump verify.err verify-target.txt verify-live.txt
  ;;
*) echo "usage: $0 setup|run|verify|keep <file> <key>"; exit 2 ;;
esac
