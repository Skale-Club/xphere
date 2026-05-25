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

  const script = buildScript(token, INGEST_URL)

  return new Response(script, {
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}

function buildScript(token: string, ingestUrl: string): string {
  return `(function(){
var T="${token}",U="${ingestUrl}";
function uuid(){return'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){var r=Math.random()*16|0;return(c==='x'?r:(r&0x3|0x8)).toString(16)})}
function gc(n){var m=document.cookie.match(new RegExp('(?:^|; )'+n+'=([^;]*)'));return m?decodeURIComponent(m[1]):null}
function sc(n,v,d){var e=new Date();e.setTime(e.getTime()+d*864e5);document.cookie=n+'='+encodeURIComponent(v)+';expires='+e.toUTCString()+';path=/;SameSite=Lax'}
function utms(){var p=new URLSearchParams(location.search);return{utm_source:p.get('utm_source')||undefined,utm_medium:p.get('utm_medium')||undefined,utm_campaign:p.get('utm_campaign')||undefined,utm_term:p.get('utm_term')||undefined,utm_content:p.get('utm_content')||undefined}}
function device(){var ua=navigator.userAgent;var dt=(/Tablet|iPad/i.test(ua)?'tablet':(/Mobi|Android|iPhone|iPod/i.test(ua)?'mobile':'desktop'));var br=(/Edg\//i.test(ua)?'Edge':/OPR\//i.test(ua)?'Opera':/Firefox\//i.test(ua)?'Firefox':/Chrome\//i.test(ua)?'Chrome':/Safari\//i.test(ua)?'Safari':'Other');var os=(/Windows/i.test(ua)?'Windows':/Mac OS/i.test(ua)?'macOS':/Android/i.test(ua)?'Android':(/iPhone|iPad|iPod/i.test(ua)?'iOS':/Linux/i.test(ua)?'Linux':'Other'));return{device_type:dt,browser:br,os:os}}
function send(p){var d=Object.assign({token:T},p);(navigator.sendBeacon?function(){navigator.sendBeacon(U,JSON.stringify(d))}:function(){fetch(U,{method:'POST',body:JSON.stringify(d),keepalive:true,headers:{'Content-Type':'application/json'}}).catch(function(){})})()}
var vid=gc('_xvid')||uuid();sc('_xvid',vid,365);
var sid=sessionStorage.getItem('_xvsid')||uuid();sessionStorage.setItem('_xvsid',sid);
var isNew=!sessionStorage.getItem('_xvss');
if(isNew){sessionStorage.setItem('_xvss','1');var u=utms();var dv=device();send(Object.assign({type:'session_start',visitor_id:vid,session_key:sid,url:location.href,referrer:document.referrer||undefined},u,dv));}
function pv(){send({type:'pageview',visitor_id:vid,session_key:sid,url:location.href,path:location.pathname,title:document.title,referrer:document.referrer||undefined})}
pv();
var _ps=history.pushState;history.pushState=function(){_ps.apply(history,arguments);setTimeout(pv,100)};
window.addEventListener('popstate',pv);
document.addEventListener('click',function(e){var a=e.target.closest('a');if(!a)return;var h=a.href||'';if(h.startsWith('tel:'))send({type:'event',visitor_id:vid,session_key:sid,event_type:'phone_click',url:location.href,metadata:{href:h}});if(h.startsWith('sms:'))send({type:'event',visitor_id:vid,session_key:sid,event_type:'sms_click',url:location.href,metadata:{href:h}})});
document.addEventListener('submit',function(e){send({type:'event',visitor_id:vid,session_key:sid,event_type:'form_submit',url:location.href,metadata:{action:e.target.action||''}})});
window.addEventListener('beforeunload',function(){var t=sessionStorage.getItem('_xvt');var dur=t?Math.round((Date.now()-Number(t))/1000):undefined;send({type:'session_end',visitor_id:vid,session_key:sid,url:location.href,duration_seconds:dur})});
sessionStorage.setItem('_xvt',String(Date.now()));
window.xpTrack=function(et,meta){send({type:'event',visitor_id:vid,session_key:sid,event_type:et||'custom_conversion',url:location.href,metadata:meta||{}})};
})();`
}
