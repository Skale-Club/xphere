# Xphere's self-hosted Postgres: pgvector plus pg-safeupdate.
#
# Supabase preloads safeupdate for the PostgREST role, which rejects UPDATE and
# DELETE without a WHERE clause. pgvector's image does not ship it and Debian has
# no package, so it is built from source here. See docs/database/execution-plan.md.

FROM pgvector/pgvector:pg17 AS build
ARG SAFEUPDATE_REF=1.5
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential git ca-certificates postgresql-server-dev-17 \
 && git clone --depth 1 --branch "${SAFEUPDATE_REF}" https://github.com/eradman/pg-safeupdate.git /src \
 && make -C /src \
 && make -C /src install DESTDIR=/out

FROM pgvector/pgvector:pg17
COPY --from=build /out/usr/lib/postgresql/17/lib/safeupdate.so /usr/lib/postgresql/17/lib/safeupdate.so
LABEL org.opencontainers.image.description="Postgres 17 with pgvector and pg-safeupdate for Xphere"
