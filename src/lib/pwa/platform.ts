/**
 * Install-platform detection for the PWA install flow.
 *
 * Only Chromium browsers fire `beforeinstallprompt`. Everywhere else the user
 * installs by hand, and the steps depend on both the OS and the browser:
 * Safari, Chrome and Firefox on iOS each put "Add to Home Screen" somewhere
 * different, and in-app browsers (Instagram, Facebook, LinkedIn…) cannot
 * install at all — the page has to be opened in a real browser first.
 */

export type InstallOs = 'ios' | 'android' | 'desktop'

export type InstallBrowser =
  | 'safari'
  | 'chrome'
  | 'edge'
  | 'firefox'
  | 'samsung'
  | 'in-app'
  | 'other'

export interface InstallPlatform {
  os: InstallOs
  browser: InstallBrowser
}

const IN_APP_RE = /FBAN|FBAV|FB_IAB|Instagram|LinkedInApp|Line\/|Twitter|TikTok|musical_ly|Snapchat|Pinterest/i

export function detectInstallPlatform(ua: string, maxTouchPoints = 0): InstallPlatform {
  // iPadOS 13+ reports itself as a Mac; a touch screen gives it away.
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1)
  const android = !ios && /Android/i.test(ua)
  const os: InstallOs = ios ? 'ios' : android ? 'android' : 'desktop'

  let browser: InstallBrowser
  if (IN_APP_RE.test(ua)) browser = 'in-app'
  else if (/CriOS/i.test(ua)) browser = 'chrome'
  else if (/EdgiOS|EdgA|Edg\//i.test(ua)) browser = 'edge'
  else if (/FxiOS|Firefox/i.test(ua)) browser = 'firefox'
  else if (/SamsungBrowser/i.test(ua)) browser = 'samsung'
  else if (/Chrome|Chromium/i.test(ua)) browser = 'chrome'
  else if (/Safari/i.test(ua)) browser = 'safari'
  else browser = 'other'

  // Android's own WebView ("; wv)") is what most in-app browsers embed.
  if (android && /; wv\)/i.test(ua)) browser = 'in-app'
  // iOS apps that embed WKWebView omit the "Safari/" token entirely.
  if (ios && browser === 'other') browser = 'in-app'

  return { os, browser }
}
