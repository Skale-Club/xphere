import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(__dirname, '..')
const SEEDS_DIR = join(REPO_ROOT, 'supabase', 'seeds', 'workflows')
const EXAMPLES_AGENDAMENTO_DIR = join(REPO_ROOT, '.planning', 'workflows', 'examples', 'agendamento')

function collectYaml(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...collectYaml(full))
    else if (entry.endsWith('.yaml') || entry.endsWith('.yml')) out.push(full)
  }
  return out
}

const FORBIDDEN_PATTERNS = [/skleanings/i, /\$120 minimum/i, /508.?500.?6625/, /hello@skleanings\.com/i, /Job Confirmed/]

describe('SCH-04: platform-default workflow seeds are tenant-neutral', () => {
  it('no file under supabase/seeds/workflows/ references Skleanings-specific branding or copy', () => {
    const offenders: string[] = []
    for (const file of collectYaml(SEEDS_DIR)) {
      const content = readFileSync(file, 'utf8')
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(content)) offenders.push(`${file} matches ${pattern}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('supabase/seeds/workflows/agendamento/ no longer exists (relocated, not just edited)', () => {
    expect(existsSync(join(SEEDS_DIR, 'agendamento'))).toBe(false)
  })

  it('all 8 relocated Skleanings example workflows exist under .planning/workflows/examples/agendamento/', () => {
    expect(collectYaml(EXAMPLES_AGENDAMENTO_DIR)).toHaveLength(8)
  })
})
