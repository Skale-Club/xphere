import { test } from 'vitest'
import assert from 'node:assert/strict'
import * as bd from '@/lib/security/bot-defense'

test('normalizeIp', () => {
  assert.equal(bd.normalizeIp('::ffff:1.2.3.4'), '1.2.3.4')
  assert.equal(bd.normalizeIp('1.2.3.4:5678'), '1.2.3.4')
  assert.equal(bd.normalizeIp('[2606:4700::1]:443'), '2606:4700::1')
  assert.equal(bd.normalizeIp('2001:DB8::'), '2001:db8::')
  assert.equal(bd.normalizeIp('::1'), '::1')
  assert.equal(bd.normalizeIp('garbage'), null)
  assert.equal(bd.normalizeIp('999.1.1.1'), null)
  assert.equal(bd.normalizeIp('unknown'), null)
})

test('cloudflare / internal matching', () => {
  assert.ok(bd.isCloudflareIp('104.16.1.1'))
  assert.ok(bd.isCloudflareIp('172.70.1.1'))
  assert.ok(bd.isCloudflareIp('2a06:98c7::1'))
  assert.ok(!bd.isCloudflareIp('8.8.8.8'))
  assert.ok(bd.isInternalIp('172.18.0.5'))
  assert.ok(bd.isInternalIp('::1'))
  assert.ok(!bd.isInternalIp('172.64.0.1'))
})

test('resolveClientIp: direct via Traefik', () => {
  assert.equal(bd.resolveClientIp({ forwardedFor: '203.0.113.9', remoteAddress: '172.18.0.2' }), '203.0.113.9')
})
test('resolveClientIp: spoofed XFF ignored', () => {
  assert.equal(bd.resolveClientIp({ forwardedFor: '1.1.1.1, 203.0.113.9', remoteAddress: '::ffff:172.18.0.2' }), '203.0.113.9')
})
test('resolveClientIp: spoofed CF-Connecting-IP ignored when not from Cloudflare', () => {
  assert.equal(bd.resolveClientIp({ forwardedFor: '203.0.113.9', cfConnectingIp: '9.9.9.9', remoteAddress: '172.18.0.2' }), '203.0.113.9')
})
test('resolveClientIp: via Cloudflare', () => {
  assert.equal(bd.resolveClientIp({ forwardedFor: '198.51.100.7, 162.158.1.2', cfConnectingIp: '198.51.100.7', remoteAddress: '172.18.0.2' }), '198.51.100.7')
  assert.equal(bd.resolveClientIp({ forwardedFor: '198.51.100.7, 162.158.1.2', remoteAddress: '127.0.0.1' }), '198.51.100.7')
})
test('resolveClientIp: malformed hops never fall through to client-controlled entries', () => {
  assert.equal(bd.resolveClientIp({ forwardedFor: '198.51.100.1, garbage' }), null)
  assert.equal(bd.resolveClientIp({ forwardedFor: 'garbage' }), null)
  assert.equal(bd.resolveClientIp({ forwardedFor: '  198.51.100.1  ,  203.0.113.9  ,  ' }), '203.0.113.9')
  assert.equal(bd.resolveClientIp({ forwardedFor: '2001:db8::1' }), '2001:db8::1')
})
test('resolveClientIp: no headers', () => {
  assert.equal(bd.resolveClientIp({ remoteAddress: '::ffff:203.0.113.4' }), '203.0.113.4')
  assert.equal(bd.resolveClientIp({ remoteAddress: '127.0.0.1' }), '127.0.0.1')
  assert.equal(bd.resolveClientIp({}), null)
})

test('trap classification', () => {
  for (const p of ['/.env', '/.env.production', '/api/.env', '/.git/config', '/xmlrpc.php', '/wp-config.php.bak', '/phpmyadmin/', '/vendor/phpunit/src/Util/PHP/eval-stdin.php', '/cgi-bin/luci', '/backup.sql', '/.aws/credentials', '/%2eenv'])
    assert.equal(bd.classifyTrapPath(p), 'hard', p)
  for (const p of ['/wp-admin', '/wp-admin/', '/wp-login.php', '/admin.php', '/wordpress/wp-admin/setup-config.php'])
    assert.ok(bd.classifyTrapPath(p), p)
  assert.equal(bd.classifyTrapPath('/wp-login.php'), 'soft')
  for (const p of ['/', '/admin', '/wp-content/uploads/2020/01/a.jpg', '/api/contact', '/blog/environment-tips', '/services/git-repair', '/env', '/login', '/api/admin/api-credentials/openai', '/.well-known/acme-challenge/x'])
    assert.equal(bd.classifyTrapPath(p), null, p)
})

test('ban ladder + safety rails', () => {
  bd.__resetBotDefense()
  const t0 = 1_000_000
  assert.deepEqual(bd.checkTrap('/.env', '203.0.113.9', 'curl', t0), { trapped: true, kind: 'hard' })
  assert.ok(bd.banRemainingMs('203.0.113.9', t0) > 59 * 60_000)
  assert.equal(bd.banRemainingMs('203.0.113.9', t0 + 61 * 60_000), 0)
  bd.checkTrap('/.git/HEAD', '203.0.113.9', 'curl', t0 + 2 * 3600_000)
  assert.ok(bd.banRemainingMs('203.0.113.9', t0 + 3 * 3600_000) > 20 * 3600_000)
  // Never ban Cloudflare, internal, crawlers
  bd.checkTrap('/.env', '162.158.1.1', 'curl', t0)
  bd.checkTrap('/.env', '10.0.0.1', 'curl', t0)
  bd.checkTrap('/.env', '198.51.100.1', 'Mozilla/5.0 (compatible; Googlebot/2.1)', t0)
  assert.equal(bd.banRemainingMs('162.158.1.1', t0), 0)
  assert.equal(bd.banRemainingMs('10.0.0.1', t0), 0)
  assert.equal(bd.banRemainingMs('198.51.100.1', t0), 0)
})

test('soft strikes', () => {
  bd.__resetBotDefense()
  const ip = '203.0.113.50'
  for (let i = 0; i < 4; i++) bd.checkTrap('/wp-admin', ip, 'x', 1000 + i)
  assert.equal(bd.banRemainingMs(ip, 2000), 0)
  bd.checkTrap('/wp-login.php', ip, 'x', 1005)
  assert.ok(bd.banRemainingMs(ip, 2000) > 0)
})

test('honeypot', () => {
  bd.__resetBotDefense()
  assert.equal(bd.isBotSubmission({ name: 'a' }, { source: 't' }), false)
  assert.equal(bd.isBotSubmission({ hp_extra: 'x' }, { source: 't' }), true)
  assert.equal(bd.isBotSubmission({ elapsedMs: 500 }, { source: 't' }), true)
  assert.equal(bd.isBotSubmission({ elapsedMs: 500 }, { source: 't', checkElapsed: false }), false)
  assert.equal(bd.isBotSubmission({ website: ' ' }, { source: 't', fields: ['website'] }), false)
  assert.equal(bd.isBotSubmission({ website: 'http://spam' }, { source: 't', fields: ['website'] }), true)
})

test('log mode never bans', () => {
  bd.__resetBotDefense()
  process.env.BOT_DEFENSE_MODE = 'log'
  bd.checkTrap('/.env', '203.0.113.77', 'curl')
  assert.equal(bd.banRemainingMs('203.0.113.77'), 0)
  delete process.env.BOT_DEFENSE_MODE
})
