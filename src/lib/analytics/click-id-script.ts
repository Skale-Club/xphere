// Client-side Google click-id capture, injected into the analytics script
// (src/app/api/analytics/script/route.ts) — Phase E1 of
// .planning/clients/o-bigode-portugues/PHASE-E-SPEC.md.
//
// Mirrors the existing fbclid handling (see fb() in route.ts's buildScript)
// but persists to localStorage instead of a cookie, per the spec's fixed
// data contract shared with Xkedule: `_xp_gclid`/`_xp_gbraid`/`_xp_wbraid`,
// each a JSON `{v,t}` blob, valid for 90 days, newest URL param always wins
// over whatever was already stored.
//
// Extracted into its own module (instead of inlined straight into the
// template literal like the rest of buildScript) so this logic has a single
// source of truth that can be exercised directly in tests/analytics-click-
// ids.test.ts via Node's vm module — the rest of the script has no
// comparable unit coverage today because it's un-extractable browser-global
// wiring (event listeners, sendBeacon), but click-id capture is pure enough
// to warrant it.
//
// Deliberately NOT minified like the surrounding template — kept readable
// since it's short and the whole script is already served with far-future
// caching, so byte count here is not the bottleneck.
export const CLICK_ID_SCRIPT = `function xpLs(n){try{return localStorage.getItem(n)}catch(e){return null}}
function xpSls(n,v){try{localStorage.setItem(n,v)}catch(e){}}
function xpClickId(storageKey,param){var p=new URLSearchParams(location.search);var v=p.get(param);var now=Date.now();var stored=null;try{stored=JSON.parse(xpLs(storageKey))}catch(e){stored=null}var valid=stored&&stored.v&&stored.t&&(now-stored.t)<=7776000000;if(v){xpSls(storageKey,JSON.stringify({v:v,t:now}));return v}if(valid)return stored.v;return undefined}
function collectClickIds(){return{gclid:xpClickId('_xp_gclid','gclid'),gbraid:xpClickId('_xp_gbraid','gbraid'),wbraid:xpClickId('_xp_wbraid','wbraid')}}`
