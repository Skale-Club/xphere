export const runtime = 'nodejs'

import { createServiceRoleClient } from '@/lib/supabase/admin'

const INGEST_URL = 'https://xphere.app/api/traffic/ingest'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const token = searchParams.get('t')

  if (!token) {
    return new Response('// invalid token', { status: 400, headers: { 'Content-Type': 'application/javascript' } })
  }

  // Validate the token exists
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceRoleClient() as any
  const { data } = await supabase
    .from('traffic_setups')
    .select('organization_id')
    .eq('script_token', token)
    .maybeSingle()

  if (!data) {
    return new Response('// invalid token', { status: 404, headers: { 'Content-Type': 'application/javascript' } })
  }

  // Resolve the org's Meta Pixel so the script can fire browser-side conversions
  // that dedup against the server-side CAPI events (shared eventID). Only inject
  // when CAPI + browser Pixel are both enabled and a pixel id is configured.
  let pixelId: string | null = null
  const { data: capi } = await supabase
    .from('meta_capi_config')
    .select('pixel_id, browser_pixel_enabled, enabled')
    .eq('org_id', data.organization_id)
    .maybeSingle()
  if (capi?.enabled && capi?.browser_pixel_enabled && capi?.pixel_id) {
    pixelId = capi.pixel_id as string
  }

  const script = buildScript(token, INGEST_URL, pixelId)

  return new Response(script, {
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}

function buildScript(token: string, ingestUrl: string, pixelId: string | null): string {
  // Meta Pixel base code (only when configured). PageView fires immediately;
  // conversions fire with the same eventID we send to ingest so Meta dedups
  // the browser event against the server-side CAPI event.
  const pixelInit = pixelId
    ? `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');try{fbq('init','${pixelId}');fbq('track','PageView')}catch(e){}`
    : ''
  const pixelTrack = pixelId
    ? `function fbqTrack(n,p,id){try{if(window.fbq)fbq('track',n,p||{},{eventID:id})}catch(e){}}`
    : `function fbqTrack(){}`

  return `(function(){
var T="${token}",U="${ingestUrl}";
function uuid(){return'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){var r=Math.random()*16|0;return(c==='x'?r:(r&0x3|0x8)).toString(16)})}
function gc(n){var m=document.cookie.match(new RegExp('(?:^|; )'+n+'=([^;]*)'));return m?decodeURIComponent(m[1]):null}
function sc(n,v,d){var e=new Date();e.setTime(e.getTime()+d*864e5);document.cookie=n+'='+encodeURIComponent(v)+';expires='+e.toUTCString()+';path=/;SameSite=Lax'}
function utms(){var p=new URLSearchParams(location.search);return{utm_source:p.get('utm_source')||undefined,utm_medium:p.get('utm_medium')||undefined,utm_campaign:p.get('utm_campaign')||undefined,utm_term:p.get('utm_term')||undefined,utm_content:p.get('utm_content')||undefined}}
function fb(){var p=new URLSearchParams(location.search);var cl=p.get('fbclid')||undefined;var c=gc('_fbc');if(!c&&cl){c='fb.1.'+Date.now()+'.'+cl;sc('_fbc',c,90)}return{fbclid:cl,fbc:c||undefined,fbp:gc('_fbp')||undefined}}
function device(){var ua=navigator.userAgent;var dt=(/Tablet|iPad/i.test(ua)?'tablet':(/Mobi|Android|iPhone|iPod/i.test(ua)?'mobile':'desktop'));var br=(ua.indexOf('Edg/')>=0?'Edge':ua.indexOf('OPR/')>=0?'Opera':ua.indexOf('Firefox/')>=0?'Firefox':ua.indexOf('Chrome/')>=0?'Chrome':ua.indexOf('Safari/')>=0?'Safari':'Other');var os=(/Windows/i.test(ua)?'Windows':/Mac OS/i.test(ua)?'macOS':/Android/i.test(ua)?'Android':(/iPhone|iPad|iPod/i.test(ua)?'iOS':/Linux/i.test(ua)?'Linux':'Other'));return{device_type:dt,browser:br,os:os}}
function send(p){var d=Object.assign({token:T},p);(navigator.sendBeacon?function(){navigator.sendBeacon(U,JSON.stringify(d))}:function(){fetch(U,{method:'POST',body:JSON.stringify(d),keepalive:true,headers:{'Content-Type':'application/json'}}).catch(function(){})})()}
${pixelInit}
${pixelTrack}
var vid=gc('_xvid')||uuid();sc('_xvid',vid,365);
var sid=sessionStorage.getItem('_xvsid')||uuid();sessionStorage.setItem('_xvsid',sid);
var isNew=!sessionStorage.getItem('_xvss');
if(isNew){sessionStorage.setItem('_xvss','1');var u=utms();var dv=device();var f=fb();send(Object.assign({type:'session_start',visitor_id:vid,session_key:sid,url:location.href,referrer:document.referrer||undefined},u,dv,f));}
function pv(){send({type:'pageview',visitor_id:vid,session_key:sid,url:location.href,path:location.pathname,title:document.title,referrer:document.referrer||undefined})}
pv();
var _ps=history.pushState;history.pushState=function(){_ps.apply(history,arguments);setTimeout(pv,100)};
window.addEventListener('popstate',pv);
document.addEventListener('click',function(e){var a=e.target.closest('a');if(!a)return;var h=a.href||'';if(h.startsWith('tel:'))send({type:'event',visitor_id:vid,session_key:sid,event_type:'phone_click',url:location.href,metadata:{href:h}});if(h.startsWith('sms:'))send({type:'event',visitor_id:vid,session_key:sid,event_type:'sms_click',url:location.href,metadata:{href:h}})});
document.addEventListener('submit',function(e){var eid=uuid();var f=fb();send({type:'event',visitor_id:vid,session_key:sid,event_type:'form_submit',url:location.href,metadata:Object.assign({action:e.target.action||'',event_id:eid},f)});fbqTrack('Lead',{},eid)});
window.addEventListener('beforeunload',function(){var t=sessionStorage.getItem('_xvt');var dur=t?Math.round((Date.now()-Number(t))/1000):undefined;send({type:'session_end',visitor_id:vid,session_key:sid,url:location.href,duration_seconds:dur})});
sessionStorage.setItem('_xvt',String(Date.now()));
window.xpTrack=function(et,meta){var eid=uuid();var m=Object.assign({event_id:eid},meta||{});send({type:'event',visitor_id:vid,session_key:sid,event_type:et||'custom_conversion',url:location.href,metadata:m});fbqTrack((et==='purchase'?'Purchase':(et==='lead'?'Lead':(et||'CustomConversion'))),meta||{},eid)};
})();`
}
