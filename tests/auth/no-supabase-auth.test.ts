import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

/**
 * Guards the Identity Platform migration (docs/auth/identity-platform-migration.md).
 *
 * Supabase clients are created with the `accessToken` option, so supabase-js
 * THROWS at runtime on any `supabase.auth.*` call. TypeScript cannot see that:
 * the methods still type-check. This test is the compile-time stand-in. Read
 * the session with getUser() from '@/lib/supabase/server', and look users up
 * with '@/lib/auth/users'.
 */

const SRC = path.resolve(__dirname, '../../src')

const AUTH_CALL =
  /\.auth\.(getUser|getSession|signIn\w*|signUp|signOut|updateUser|admin|verifyOtp|exchangeCodeForSession|resetPasswordForEmail)\b/
// The one place allowed to call Supabase Auth: the temporary database-token bridge
// (generateLink + verifyOtp, createUser for the shadow row). It goes away with Supabase.
const BRIDGE_FILE = 'lib/auth/supabase-jwt.ts'
const BRIDGE_ONLY = /\.auth\.(admin|verifyOtp)\b/

const SSR_IMPORT = /@supabase\/ssr/

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx|mts|js|jsx)$/.test(name) ? [full] : []
  })
}

function offenders(pattern: RegExp, allow: { file: string; pattern: RegExp } | null = null): string[] {
  const found: string[] = []
  for (const file of sourceFiles(SRC)) {
    const relative = path.relative(SRC, file).split(path.sep).join('/')
    const bridge = allow !== null && relative === allow.file
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        // Comments may still name the old API: only code can throw.
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
        // In the bridge file only these calls are exempt; any other auth call there still fails.
        if (bridge && allow!.pattern.test(line)) return
        if (pattern.test(line)) found.push(`${relative}:${index + 1}: ${line.trim()}`)
      })
  }
  return found
}

describe('no Supabase Auth under src/', () => {
  it('calls no supabase.auth.* method', () => {
    expect(offenders(AUTH_CALL, { file: BRIDGE_FILE, pattern: BRIDGE_ONLY })).toEqual([])
  })

  it('imports nothing from @supabase/ssr', () => {
    expect(offenders(SSR_IMPORT)).toEqual([])
  })
})
