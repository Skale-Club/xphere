#!/bin/bash
# PostgREST gates against the REHEARSAL database only. Mints short-lived JWTs
# with the rehearsal secret, prints counts and statuses, never row contents.
set -u
WORK=/root/xphere-db-build
cd "$WORK" || exit 1
NET=xphere-rehearsal
DB=xphere-rehearsal-db
SECRET=$(cat jwt.secret)

b64() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
jwt() { # $1 role, $2 sub (optional)
  local now exp payload header sig
  now=$(date +%s); exp=$((now + 600))
  header=$(printf '{"alg":"HS256","typ":"JWT"}' | b64)
  if [ -n "${2:-}" ]; then payload=$(printf '{"role":"%s","sub":"%s","aud":"authenticated","iat":%s,"exp":%s}' "$1" "$2" "$now" "$exp" | b64)
  else payload=$(printf '{"role":"%s","iat":%s,"exp":%s}' "$1" "$now" "$exp" | b64); fi
  sig=$(printf '%s.%s' "$header" "$payload" | openssl dgst -sha256 -hmac "$SECRET" -binary | b64)
  printf '%s.%s.%s' "$header" "$payload" "$sig"
}
q() { docker exec $DB psql -U postgres -d postgres -X -At -c "$1"; }
# curl from inside the rehearsal network; prints "status|content-range"
rest() { # $1 token, $2 method, $3 path, $4 extra header (optional), $5 body (optional)
  docker run --rm --network $NET curlimages/curl:8.11.1 -s -o /dev/null -D - -X "$2" \
    -H "Authorization: Bearer $1" -H "Prefer: count=exact" ${4:+-H "$4"} \
    ${5:+-H "Content-Type: application/json" -d "$5"} "http://xphere-rehearsal-rest:3000$3" \
    | tr -d '\r' | awk 'NR==1{s=$2} tolower($1)=="content-range:"{r=$2} END{print s"|"r}'
}

SVC=$(jwt service_role)
ANON=$(jwt anon)

echo "== service_role sees everything"
echo "contacts: rest=$(rest "$SVC" HEAD '/contacts?select=id') db=$(q 'select count(*) from public.contacts')"

echo "== anon sees no tenant data"
echo "contacts: $(rest "$ANON" HEAD '/contacts?select=id')"
echo "organizations: $(rest "$ANON" HEAD '/organizations?select=id')"

# A user who belongs to exactly one org that has contacts, and another org with contacts.
read -r USER ORG <<<"$(q "select m.user_id, m.org_id from public.org_members m
  where m.user_id in (select user_id from public.org_members group by user_id having count(*) = 1)
  and exists (select 1 from public.contacts c where c.org_id = m.org_id) limit 1" | tr '|' ' ')"
OTHER=$(q "select org_id from public.contacts where org_id <> '$ORG' group by org_id order by count(*) desc limit 1")
USERJWT=$(jwt authenticated "$USER")
echo "== member of one org (user ${USER:0:8}, org ${ORG:0:8}; other org ${OTHER:0:8})"
echo "own org contacts: rest=$(rest "$USERJWT" HEAD '/contacts?select=id' "x-xphere-org: $ORG") db=$(q "select count(*) from public.contacts where org_id = '$ORG'")"
echo "asking for the other org via header: $(rest "$USERJWT" HEAD '/contacts?select=id' "x-xphere-org: $OTHER")"
echo "filtering the other org explicitly: $(rest "$USERJWT" HEAD "/contacts?select=id&org_id=eq.$OTHER" "x-xphere-org: $OTHER")"

echo "== rpc"
echo "match_documents as service_role: $(rest "$SVC" POST '/rpc/match_documents' '' "{\"query_embedding\": $(q "select embedding::text from public.documents where embedding is not null order by id limit 1"), \"filter\": {}, \"match_count\": 5}")"
echo "get_current_org_id as member: $(docker run --rm --network $NET curlimages/curl:8.11.1 -s -X POST -H "Authorization: Bearer $USERJWT" -H "x-xphere-org: $ORG" -H 'Content-Type: application/json' -d '{}' http://xphere-rehearsal-rest:3000/rpc/get_current_org_id | cut -c1-12)… expected ${ORG:0:8}"

echo "== safeupdate blocks an unfiltered delete (rehearsal copy only)"
BEFORE=$(q 'select count(*) from public.tags')
echo "delete all tags: $(rest "$SVC" DELETE '/tags') rows before=$BEFORE after=$(q 'select count(*) from public.tags')"
