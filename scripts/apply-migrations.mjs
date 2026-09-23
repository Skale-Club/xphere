/**
 * Aplica as migrações SQL pendentes de supabase/migrations à base de dados.
 *
 * O registo é `supabase_migrations.schema_migrations` — A MESMA tabela que o
 * Supabase CLI e o dashboard escrevem. Não é um pormenor: um registo próprio
 * faria com que este script e o `supabase db push` se ignorassem, e cada um
 * reaplicasse o que o outro já tinha corrido.
 *
 * Simula por omissão. Nada é escrito sem `--apply`, porque a connection string
 * destes repos aponta para a base de dados que serve clientes reais e um
 * engano aqui não se desfaz com ctrl-Z.
 *
 * Uso:
 *   npm run db:migrate                          lista o que está pendente
 *   npm run db:migrate -- --apply               aplica, cada ficheiro numa transação
 *   npm run db:migrate -- --only=<f.sql> --apply  aplica só esse ficheiro
 *   npm run db:migrate -- --baseline=<versão> --apply
 *       marca como aplicado, SEM CORRER, tudo até essa versão. É o primeiro
 *       passo numa base de dados cuja história é anterior ao registo.
 *
 * Connection string, por ordem: MIGRATION_DATABASE_URL, POSTGRES_URL_NON_POOLING,
 * DATABASE_URL. A não-pooling vem primeiro de propósito: DDL através de um
 * pooler em modo transação perde estado de sessão entre statements.
 */
// Sem dotenv neste repo: em local, `node --env-file=.env.local scripts/apply-migrations.mjs`.

const MIGRATIONS_DIR = 'supabase/migrations'
const INVOCATION = 'node scripts/apply-migrations.mjs'
// ─── fim do carregamento de env; daqui para baixo é igual nos cinco repos ────

import pg from 'pg'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const LEDGER = 'supabase_migrations.schema_migrations'

const args = process.argv.slice(2)
const has = (flag) => args.includes(flag)
const valueOf = (flag) => {
  const hit = args.find((a) => a.startsWith(`${flag}=`))
  return hit ? hit.slice(flag.length + 1) : null
}

const apply = has('--apply')
const only = valueOf('--only')
const baselineTo = valueOf('--baseline')

function versionOf(file) {
  // `20260917100000_blog_rss.sql` → `20260917100000`; `058_x.sql` → `058`.
  // O mesmo recorte que o Supabase CLI faz, para que a linha que escrevemos
  // seja a linha que ele reconhece.
  return file.split('_')[0]
}

function nameOf(file) {
  return file.replace(/^[^_]+_/, '').replace(/\.sql$/, '')
}

function describeTarget(url) {
  // Nunca imprime a password. O ponto é confirmar A QUE base de dados isto vai
  // antes de escrever nela — a única pergunta que interessa aqui.
  try {
    const u = new URL(url)
    return `${u.hostname}:${u.port || 5432}${u.pathname} (user ${u.username})`
  } catch {
    return '(connection string ilegível)'
  }
}

async function main() {
  if (!existsSync(MIGRATIONS_DIR)) {
    throw new Error(`${MIGRATIONS_DIR} não existe — corre isto a partir da raiz do repo`)
  }

  // Não-pooling primeiro: DDL através de um pooler em modo transação perde o
  // estado de sessão entre statements e falha de formas difíceis de ler.
  const url =
    process.env.MIGRATION_DATABASE_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'Sem connection string. Define MIGRATION_DATABASE_URL, POSTGRES_URL_NON_POOLING ou DATABASE_URL.',
    )
  }

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  // O registo é chaveado pela versão, por isso dois ficheiros com o mesmo
  // prefixo não cabem lá os dois: o segundo cai no `on conflict do nothing` e
  // passa a constar como aplicado sem nunca ter corrido. Três destes repos têm
  // pares assim na história (branches a aterrar no mesmo dia), e é uma falha
  // que não deixa rasto nenhuma — daí ser detetada aqui e dita em voz alta.
  const byVersion = new Map()
  for (const f of files) {
    const v = versionOf(f)
    if (!byVersion.has(v)) byVersion.set(v, [])
    byVersion.get(v).push(f)
  }
  const collisions = [...byVersion.entries()].filter(([, group]) => group.length > 1)

  const client = new pg.Client({ connectionString: url })
  await client.connect()

  try {
    console.log(`alvo:      ${describeTarget(url)}`)
    console.log(`migrações: ${MIGRATIONS_DIR} (${files.length} ficheiros)`)

    const ledgerExists = (
      await client.query(
        `select to_regclass('${LEDGER}') is not null as present`,
      )
    ).rows[0].present

    let applied = new Set()
    if (ledgerExists) {
      const rows = await client.query(`select version from ${LEDGER}`)
      applied = new Set(rows.rows.map((r) => r.version))
    }
    console.log(`registo:   ${ledgerExists ? `${applied.size} aplicadas` : 'AUSENTE'}`)

    if (collisions.length > 0) {
      console.log(`\n⚠ ${collisions.length} versões com mais do que um ficheiro:`)
      for (const [version, group] of collisions) console.log(`  ${version}: ${group.join(', ')}`)
      console.log('  O registo só guarda uma linha por versão — ver a nota acima.')
    }

    let pending = files.filter((f) => !applied.has(versionOf(f)))
    if (only) {
      if (!files.includes(only)) throw new Error(`${only} não existe em ${MIGRATIONS_DIR}`)
      pending = pending.filter((f) => f === only)
      if (pending.length === 0) {
        console.log(`\n${only} já consta do registo — nada a fazer.`)
        return
      }
    }

    // ─── baseline ────────────────────────────────────────────────────────────
    // Para uma base de dados cuja história é anterior ao registo: marca como
    // aplicadas, SEM AS CORRER, todas as migrações até <versão>. É o que evita
    // que a primeira passagem tente reproduzir anos de história em produção.
    if (baselineTo) {
      const toMark = files.filter(
        (f) => versionOf(f) <= baselineTo && !applied.has(versionOf(f)),
      )
      console.log(`\nbaseline até ${baselineTo}: ${toMark.length} ficheiros a registar sem correr`)
      for (const f of toMark) console.log(`  · ${f}`)
      if (!apply) {
        console.log('\n(simulação — junta --apply para escrever o registo)')
        return
      }
      await ensureLedger(client)
      let written = 0
      for (const f of toMark) {
        const res = await client.query(
          `insert into ${LEDGER} (version, statements, name) values ($1, $2, $3)
           on conflict (version) do nothing`,
          [versionOf(f), [], nameOf(f)],
        )
        written += res.rowCount ?? 0
      }
      // Ficheiros pedidos e linhas escritas divergem quando há versões
      // duplicadas. Dizer só "N registadas" escondia exatamente isso.
      console.log(
        `\n${written} linhas escritas para ${toMark.length} ficheiros` +
          (written === toMark.length ? '' : ' (versões duplicadas colapsaram)') +
          '. Volta a correr sem --baseline.',
      )
      return
    }

    if (pending.length === 0) {
      console.log('\nem dia — nada pendente.')
      return
    }

    // Um ficheiro mais antigo do que a última aplicada entrou fora de ordem —
    // dois branches a aterrar migrações ao mesmo tempo. Não é erro, mas o
    // runner antigo saltava-o em silêncio, que é a pior das respostas.
    const latest = [...applied].sort().at(-1) ?? ''
    const outOfOrder = pending.filter((f) => versionOf(f) < latest)

    console.log(`\npendentes (${pending.length}):`)
    for (const f of pending) {
      console.log(`  · ${f}${outOfOrder.includes(f) ? '   ⚠ fora de ordem' : ''}`)
    }
    if (outOfOrder.length > 0) {
      console.log(
        `\n⚠ ${outOfOrder.length} são anteriores à última aplicada (${latest}). Vão correr na mesma,` +
          '\n  mas confirma que não dependem de nada que tenha entrado depois delas.',
      )
    }

    // A assinatura de "o registo não existe, a base de dados não é nova": sem
    // registo e com muitas pendentes. Aplicar aqui reproduziria a história toda
    // contra dados reais. Exige-se um baseline explícito primeiro.
    if (applied.size === 0 && pending.length > 5 && !only) {
      console.log(
        `\n✖ O registo está vazio e há ${pending.length} pendentes.` +
          '\n  Ou esta base de dados é nova, ou — bem mais provável — a história dela é' +
          '\n  anterior ao registo e aplicar isto reproduziria tudo outra vez.' +
          '\n' +
          '\n  Se já está em produção, marca a história como aplicada primeiro:' +
          `\n    ${INVOCATION} -- --baseline=<última versão já em produção> --apply` +
          '\n' +
          '\n  Se é mesmo uma base de dados nova, força com --first-run.',
      )
      if (!has('--first-run')) process.exit(2)
    }

    // Aplicar uma pendente cuja versão colide deixaria a outra do par marcada
    // como aplicada sem ter corrido. Renomear um dos ficheiros resolve-o; o
    // runner não escolhe qual, porque a escolha muda o que fica registado.
    const pendingCollisions = pending.filter((f) => byVersion.get(versionOf(f)).length > 1)
    if (pendingCollisions.length > 0) {
      console.log(
        `\n✖ ${pendingCollisions.length} pendentes partilham a versão com outro ficheiro:` +
          `\n  ${pendingCollisions.join('\n  ')}` +
          '\n\n  O registo guarda uma linha por versão, portanto aplicar estas marcaria a' +
          '\n  outra do par como aplicada sem a ter corrido. Renomeia uma delas para uma' +
          '\n  versão livre e volta a correr.',
      )
      process.exit(2)
    }

    if (!apply) {
      console.log(`\n(simulação — nada foi escrito. Junta --apply para aplicar.)`)
      return
    }

    await ensureLedger(client)

    for (const file of pending) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
      process.stdout.write(`aplicar ${file} … `)
      // Cada ficheiro numa transação COM o seu registo. É o que garante que uma
      // falha a meio não deixa metade do schema aplicado e nada registado — o
      // estado que obriga a desfazer à mão antes de se poder tentar de novo.
      try {
        await client.query('begin')
        await client.query(sql)
        await client.query(
          `insert into ${LEDGER} (version, statements, name) values ($1, $2, $3)
           on conflict (version) do nothing`,
          [versionOf(file), [sql], nameOf(file)],
        )
        await client.query('commit')
        console.log('ok')
      } catch (err) {
        await client.query('rollback').catch(() => {})
        console.log('FALHOU')
        console.error(`\n${file}: ${err.message}`)
        console.error('\nRevertida. Nada desta migração ficou aplicado, e nada foi registado.')
        console.error('As anteriores desta passagem ficaram aplicadas e registadas.')
        process.exit(1)
      }
    }

    console.log(`\n${pending.length} aplicadas.`)
  } finally {
    await client.end()
  }
}

async function ensureLedger(client) {
  // A MESMA tabela que o Supabase CLI e o dashboard escrevem, com as mesmas
  // colunas. É o que faz com que `supabase db push` e este script partilhem uma
  // só história em vez de duas que se ignoram — e se reaplicam uma à outra.
  await client.query('create schema if not exists supabase_migrations')
  await client.query(
    `create table if not exists ${LEDGER} (
       version text primary key,
       statements text[],
       name text
     )`,
  )
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
