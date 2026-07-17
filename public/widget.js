"use strict";(()=>{var ie=Object.defineProperty;var G=Object.getOwnPropertySymbols;var se=Object.prototype.hasOwnProperty,oe=Object.prototype.propertyIsEnumerable;var U=(n,i,r)=>i in n?ie(n,i,{enumerable:!0,configurable:!0,writable:!0,value:r}):n[i]=r,R=(n,i)=>{for(var r in i||(i={}))se.call(i,r)&&U(n,r,i[r]);if(G)for(var r of G(i))oe.call(i,r)&&U(n,r,i[r]);return n};var u={stageBg:"var(--bg-primary)",stageDots:"radial-gradient(circle, rgba(148,163,184,0.12) 1px, transparent 1px)",stageDotsSize:"16px 16px",panelBg:"#ceced2",headerBg:"#f4f4f5",borderColor:"#e4e4e7",assistantBubbleBg:null,inputFieldBg:"#ffffff",textPrimary:"#09090b",textSecondary:"#71717a",userBubbleRadius:"10px"};var w={displayName:"AI Assistant",primaryColor:"#18181B",welcomeMessage:"Hi! How can I help?",greetingEnabled:!0,greetingMessage:"Hi! How can I help?",greetingDelaySeconds:3},re=`
/* Theme */
:host {
  --opps-primary-color: #18181B;
}

/* Reset */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

/* Animations */
@keyframes opps-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(24,24,27,0.35); }
  70%  { box-shadow: 0 0 0 12px rgba(24,24,27,0); }
  100% { box-shadow: 0 0 0 0 rgba(24,24,27,0); }
}
@keyframes opps-dot-pulse {
  0%, 60%, 100% { opacity: 0.25; transform: translateY(0); }
  30%            { opacity: 1;    transform: translateY(-4px); }
}
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}

/* Bubble */
.opps-bubble {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 2147483647;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--opps-primary-color);
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 16px rgba(0,0,0,0.18);
  transition: transform 200ms ease;
}
.opps-bubble:hover { transform: scale(1.06); }
.opps-bubble:active { transform: scale(0.96); }
.opps-bubble.opps-pulse {
  animation: opps-pulse 1.4s ease-out 1.2s 2 both;
}

/* Panel */
.opps-panel {
  position: fixed;
  bottom: 88px;
  right: 20px;
  z-index: 2147483646;
  width: 360px;
  height: 520px;
  background: ${u.panelBg};
  border: 1px solid ${u.borderColor};
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.12);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  transform-origin: bottom right;
  transition: width 240ms cubic-bezier(0.2,0,0,1), height 240ms cubic-bezier(0.2,0,0,1);
}
.opps-panel[aria-hidden="true"] {
  display: none;
}
/* Expanded (desktop): a bit larger, still anchored bottom-right */
.opps-panel.opps-expanded {
  width: 420px;
  height: 680px;
  max-height: calc(100vh - 108px);
}
/* Mobile: expanded = fullscreen */
@media (max-width: 640px) {
  .opps-panel.opps-expanded {
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    height: 100%;
    max-height: 100%;
    border-radius: 0;
    border: none;
  }
}
.opps-panel-opening {
  animation: opps-panel-open 320ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}
.opps-panel-closing {
  animation: opps-panel-close 220ms cubic-bezier(0.36, 0, 0.66, -0.3) forwards;
}
@keyframes opps-panel-open {
  from { opacity: 0; transform: scale(0.82) translateY(20px); }
  to   { opacity: 1; transform: scale(1)    translateY(0);    }
}
@keyframes opps-panel-close {
  from { opacity: 1; transform: scale(1)    translateY(0);    }
  to   { opacity: 0; transform: scale(0.82) translateY(20px); }
}

/* Bubble icon flip animation on toggle */
.opps-bubble-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 260ms cubic-bezier(0.34, 1.56, 0.64, 1),
              opacity   180ms ease;
}
.opps-bubble-icon.opps-icon-entering {
  animation: opps-icon-in 260ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}
@keyframes opps-icon-in {
  from { transform: rotate(-90deg) scale(0.6); opacity: 0; }
  to   { transform: rotate(0deg)   scale(1);   opacity: 1; }
}

/* Greeting composer (minimized "Write a message\u2026" prompt) */
.opps-greeting {
  position: fixed;
  /* Anchored to the bubble's vertical centerline (20px bottom + 56/2) and
     shifted down 50% of its own height, so the pill centers on the bubble
     regardless of its height. */
  bottom: 48px;
  right: 88px;
  z-index: 2147483646;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  max-width: 300px;
  transform: translateY(50%);
  transform-origin: bottom right;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
.opps-greeting[aria-hidden="true"] { display: none; }
.opps-greeting-opening { animation: opps-greeting-in 280ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
.opps-greeting-closing { animation: opps-greeting-out 200ms ease forwards; }
@keyframes opps-greeting-in {
  from { opacity: 0; transform: translateY(calc(50% + 12px)) scale(0.96); }
  to   { opacity: 1; transform: translateY(50%)              scale(1);    }
}
@keyframes opps-greeting-out {
  from { opacity: 1; transform: translateY(50%)              scale(1);    }
  to   { opacity: 0; transform: translateY(calc(50% + 12px)) scale(0.96); }
}
.opps-greeting-row { position: relative; display: flex; align-items: center; }
/* Invisible hover bridge above the pill so moving the cursor up to the \xD7 keeps
   the greeting hovered (otherwise the \xD7 re-blurs before you can reach it). */
.opps-greeting-row::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: -36px;
  height: 38px;
}
.opps-greeting-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 264px;
  max-width: 72vw;
  background: ${u.inputFieldBg};
  border: 1px solid ${u.borderColor};
  border-radius: 24px;
  padding: 4px 4px 4px 16px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
}
.opps-greeting-input {
  flex: 1;
  min-width: 0;
  height: 36px;
  border: none;
  outline: none;
  background: transparent;
  font-size: 14px;
  color: ${u.textPrimary};
  font-family: inherit;
}
.opps-greeting-input::placeholder { color: ${u.textSecondary}; }
.opps-greeting-send {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--opps-primary-color);
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: opacity 150ms ease;
}
.opps-greeting-send:hover:not(:disabled) { opacity: 0.92; }
.opps-greeting-send:disabled { background: #d4d4d8; cursor: default; }
.opps-greeting-close {
  position: absolute;
  top: -28px;
  left: -7px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #2e2e2e;
  border: none;
  color: #ffffff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  box-shadow: 0 2px 6px rgba(0,0,0,0.2);
  /* Hidden until the visitor hovers the greeting. The blur + alpha exist ONLY
     during the transition \u2014 the destination (hover) state is fully crisp. */
  opacity: 0;
  filter: blur(4px);
  pointer-events: none;
  transition: opacity 200ms ease, filter 200ms ease, background 150ms ease;
}
.opps-greeting:hover .opps-greeting-close,
.opps-greeting:focus-within .opps-greeting-close {
  opacity: 1;
  filter: blur(0);
  pointer-events: auto;
}
.opps-greeting-close:hover { background: #242424; }

/* Header */
.opps-header {
  height: 52px;
  min-height: 52px;
  background: ${u.headerBg};
  border-bottom: 1px solid ${u.borderColor};
  padding: 0 24px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
.opps-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--opps-primary-color);
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}
.opps-bot-name {
  font-size: 14px;
  font-weight: 600;
  color: ${u.textPrimary};
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
.opps-header-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 2px;
}
.opps-header-btn {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 150ms ease;
}
.opps-header-btn:hover { background: rgba(0,0,0,0.06); }

/* Message list */
.opps-messages {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: ${u.panelBg};
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  scroll-behavior: smooth;
}

/* Empty state */
.opps-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
  text-align: center;
  padding: 16px;
}
.opps-empty-avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--opps-primary-color);
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 600;
  flex-shrink: 0;
}
.opps-empty-heading {
  font-size: 14px;
  font-weight: 600;
  color: #09090b;
}
.opps-empty-body {
  font-size: 14px;
  font-weight: 400;
  color: #71717a;
  line-height: 1.5;
}

/* Message bubbles */
.opps-msg {
  display: flex;
  max-width: 75%;
  word-break: break-word;
}
.opps-msg-user {
  align-self: flex-end;
  justify-content: flex-end;
  margin-top: 12px;
}
.opps-msg-user:first-of-type { margin-top: 0; }
.opps-msg-assistant {
  align-self: flex-start;
  justify-content: flex-start;
  margin-top: 4px;
}
.opps-bubble-user {
  background: var(--opps-primary-color);
  color: #ffffff;
  padding: 8px 16px;
  border-radius: ${u.userBubbleRadius};
  font-size: 14px;
  font-weight: 400;
  line-height: 1.5;
}
.opps-bubble-assistant {
  color: ${u.textPrimary};
  font-size: 14px;
  font-weight: 400;
  line-height: 1.5;
  padding: 2px 4px;
}
.opps-bubble-error {
  background: #f4f4f5;
  color: #ef4444;
  padding: 8px 16px;
  border-radius: 16px 16px 16px 4px;
  font-size: 14px;
  font-weight: 400;
  line-height: 1.5;
}

/* Typing indicator */
.opps-typing {
  display: flex;
  align-items: center;
  gap: 4px;
  background: #f4f4f5;
  padding: 12px 16px;
  border-radius: 16px 16px 16px 4px;
  align-self: flex-start;
  margin-top: 4px;
}
.opps-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #71717a;
}
.opps-dot:nth-child(1) { animation: opps-dot-pulse 1.2s ease-in-out infinite; animation-delay: 0s; }
.opps-dot:nth-child(2) { animation: opps-dot-pulse 1.2s ease-in-out infinite; animation-delay: 0.2s; }
.opps-dot:nth-child(3) { animation: opps-dot-pulse 1.2s ease-in-out infinite; animation-delay: 0.4s; }

/* Input area */
.opps-input-area {
  background: ${u.panelBg};
  padding: 24px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.opps-input {
  flex: 1;
  height: 36px;
  background: ${u.inputFieldBg};
  border: 1px solid ${u.borderColor};
  border-radius: 18px;
  padding: 0 16px;
  font-size: 14px;
  font-weight: 400;
  line-height: 1.4;
  color: ${u.textPrimary};
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  outline: none;
}
.opps-input::placeholder { color: ${u.textSecondary}; }
.opps-input:focus { border-color: #a1a1aa; }
.opps-input:disabled { opacity: 0.5; pointer-events: none; }
.opps-send {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: #18181b;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 150ms ease;
  flex-shrink: 0;
}
.opps-send:hover:not(:disabled) { opacity: 0.92; }
.opps-send:active:not(:disabled) { opacity: 0.84; }
.opps-send:disabled { background: #d4d4d8; cursor: default; }
`,K='<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',ae='<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',Q='<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>',pe='<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',J='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#52525b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>',le='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#52525b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>',L=document.currentScript,V,q=(V=L==null?void 0:L.dataset.token)!=null?V:"",de=L!=null&&L.src?new URL(L.src).origin:location.origin,X,ce=(X=L==null?void 0:L.dataset.contextEndpoint)!=null?X:"";q&&!document.getElementById("opps-root")&&xe(q,de,ce);function Z(n){return`opps_${n}_sessionId`}function ee(n){try{return localStorage.getItem(Z(n))}catch(i){return null}}function ge(n,i){try{localStorage.setItem(Z(n),i)}catch(r){}}function F(n,i){if(typeof n!="string")return i;let r=n.trim();return r.length>0?r:i}function ue(n){if(typeof n!="string")return w.primaryColor;let i=n.trim();return/^#[0-9A-Fa-f]{6}$/.test(i)?i.toUpperCase():w.primaryColor}function Y(n){return n.trim().charAt(0).toUpperCase()||w.displayName.charAt(0)}async function me(n,i){try{let r=`${n}/api/widget/${i}/config?u=${encodeURIComponent(location.href)}`,c=await fetch(r,{method:"GET",headers:{Accept:"application/json"}});if(c.status===403)return{config:w,blocked:!0};if(!c.ok)return{config:w,blocked:!1};let a=await c.json(),p=F(a.welcomeMessage,w.welcomeMessage),o=typeof a.greetingDelaySeconds=="number"?a.greetingDelaySeconds:w.greetingDelaySeconds;return{config:{displayName:F(a.displayName,w.displayName),primaryColor:ue(a.primaryColor),welcomeMessage:p,greetingEnabled:a.greetingEnabled!==!1,greetingMessage:F(a.greetingMessage,p),greetingDelaySeconds:Math.max(0,Math.min(30,o))},blocked:!1}}catch(r){return{config:w,blocked:!1}}}async function fe(n,i){var p;if(!n.body)return;let r=n.body.getReader(),c=new TextDecoder,a="";for(;;){let{done:o,value:f}=await r.read();if(o)break;a+=c.decode(f,{stream:!0});let g=a.split(`
`);a=(p=g.pop())!=null?p:"";for(let H of g){let h=H.trim();if(h)try{i(JSON.parse(h))}catch(B){}}}if(a.trim())try{i(JSON.parse(a.trim()))}catch(o){}}async function be(n){let{apiBase:i,token:r,message:c,sessionId:a,commerceContext:p,onEvent:o}=n,f;try{f=await fetch(`${i}/api/chat/${r}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(R(R({message:c,pageUrl:location.href},a?{sessionId:a}:{}),p?{commerce_context:p}:{}))})}catch(g){o({event:"error"});return}if(!f.ok||!f.body){o({event:"error",sessionId:String(f.status)});return}await fe(f,o)}function he(n,i,r,c,a){let p=document.createElement("div");p.className="opps-panel",p.setAttribute("role","dialog"),p.setAttribute("aria-label","Chat"),p.setAttribute("aria-hidden","true");let o=document.createElement("div");o.className="opps-header";let f=document.createElement("div");f.className="opps-avatar",f.textContent=Y(w.displayName);let g=document.createElement("span");g.className="opps-bot-name",g.textContent=w.displayName;let H=document.createElement("div");H.className="opps-header-actions";let h=document.createElement("button");h.className="opps-header-btn",h.type="button",h.setAttribute("aria-label","Expand chat"),h.innerHTML=J,H.appendChild(h),o.appendChild(f),o.appendChild(g),o.appendChild(H);let B=!1;h.addEventListener("click",()=>{B=!B,p.classList.toggle("opps-expanded",B),h.innerHTML=B?le:J,h.setAttribute("aria-label",B?"Collapse chat":"Expand chat")});let l=document.createElement("div");l.className="opps-messages",l.setAttribute("aria-live","polite");let E=document.createElement("div");E.className="opps-empty";let C=document.createElement("div");C.className="opps-empty-avatar",C.textContent=Y(w.displayName);let T=document.createElement("p");T.className="opps-empty-heading",T.textContent=w.welcomeMessage;let x=document.createElement("p");x.className="opps-empty-body",x.textContent="Ask me anything \u2014 I\u2019m here to help.",E.appendChild(C),E.appendChild(T),E.appendChild(x),l.appendChild(E);let y=document.createElement("div");y.className="opps-input-area";let m=document.createElement("input");m.type="text",m.className="opps-input",m.placeholder="Type a message\u2026",m.setAttribute("aria-label","Message input");let b=document.createElement("button");b.className="opps-send",b.setAttribute("aria-label","Send message"),b.setAttribute("aria-disabled","true"),b.disabled=!0,b.innerHTML=Q,y.appendChild(m),y.appendChild(b),p.appendChild(o),p.appendChild(l),p.appendChild(y);let S=!1,I=ee(i),j=!1,A=null,z=0;function O(e){try{let s=e.length%4===0?"":"=".repeat(4-e.length%4);return JSON.parse(atob(e.replace(/-/g,"+").replace(/_/g,"/")+s))}catch(s){return null}}function N(e){var d;let s=O((d=e.split(".")[0])!=null?d:"");A=e,z=typeof(s==null?void 0:s.exp)=="number"?s.exp:Math.floor(Date.now()/1e3)+60}async function _(){if(!c)return null;let e=Math.floor(Date.now()/1e3);if(A&&z>e+5)return A;try{let s=await fetch(c,{credentials:"same-origin"});if(!s.ok)return null;let{token:d}=await s.json();return d?(N(d),A):null}catch(s){return null}}function M(e,s){j||(E.remove(),j=!0);let d=document.createElement("div");d.className=`opps-msg opps-msg-${s==="user"?"user":"assistant"}`;let v=document.createElement("div");v.className=s==="error"?"opps-bubble-error":`opps-bubble-${s}`,v.textContent=e,d.appendChild(v),l.appendChild(d),l.scrollTop=l.scrollHeight}function P(){let e=document.createElement("div");e.className="opps-typing",e.setAttribute("aria-label","AI is typing");for(let s=0;s<3;s++){let d=document.createElement("div");d.className="opps-dot",e.appendChild(d)}return l.appendChild(e),l.scrollTop=l.scrollHeight,e}function $(e){m.disabled=!e,b.disabled=!e||m.value.trim()==="",b.setAttribute("aria-disabled",String(!e||m.value.trim()===""))}async function t(e){let s=e.trim();if(!s||S)return;S=!0,$(!1),M(s,"user");let d=P(),v="",W=await _();await be({apiBase:r,token:i,message:s,sessionId:I,commerceContext:W,onEvent:k=>{if(k.event==="session"&&k.sessionId)I||(I=k.sessionId,ge(i,I));else if(k.event==="token"&&k.text)v+=k.text;else if(k.event==="commerce"&&k.action==="cart_created")A=null,z=0;else if(k.event==="done")d.remove(),v&&M(v,"assistant"),v="",S=!1,$(!0),m.focus();else if(k.event!=="tool_call"){if(k.event==="error"){d.remove();let ne=k.sessionId==="401"?"This chat is unavailable right now.":"Something went wrong. Please try again.";M(ne,"error"),S=!1,$(!0)}}}}),S&&(d.remove(),v&&M(v,"assistant"),S=!1,$(!0))}function D(){let e=m.value.trim();!e||S||(m.value="",t(e))}m.addEventListener("input",()=>{b.disabled=m.value.trim()===""||S,b.setAttribute("aria-disabled",String(b.disabled))}),m.addEventListener("keydown",e=>{e.key==="Enter"&&!e.shiftKey&&(e.preventDefault(),D())}),b.addEventListener("click",()=>{D()}),p.addEventListener("keydown",e=>{if(e.key!=="Tab")return;let s=Array.from(p.querySelectorAll('button, input, [tabindex="0"]'));if(s.length===0)return;let d=s[0],v=s[s.length-1],W=n.activeElement;e.shiftKey?W===d&&(e.preventDefault(),v.focus()):W===v&&(e.preventDefault(),d.focus())});function te(e){let s=Y(e.displayName);f.textContent=s,g.textContent=e.displayName,C.textContent=s,T.textContent=e.welcomeMessage}return{panel:p,applyConfig:te,submitMessage:t,setContext:N}}function xe(n,i,r){let c=document.createElement("div");c.id="opps-root",c.style.display="none",document.body.appendChild(c);let a=c.attachShadow({mode:"open"}),p=document.createElement("style");p.textContent=re,a.appendChild(p);let o=document.createElement("button");o.className="opps-bubble",o.setAttribute("aria-label","Open chat"),o.setAttribute("tabindex","0");let f=document.createElement("span");f.className="opps-bubble-icon",f.innerHTML=K,o.appendChild(f),ee(n)||o.classList.add("opps-pulse");let{panel:g,applyConfig:H,submitMessage:h,setContext:B}=he(a,n,i,r,o);a.appendChild(o),a.appendChild(g);let l=document.createElement("div");l.className="opps-greeting",l.setAttribute("aria-hidden","true");let E=document.createElement("div");E.className="opps-greeting-row";let C=document.createElement("button");C.className="opps-greeting-close",C.setAttribute("aria-label","Dismiss greeting"),C.innerHTML=pe;let T=document.createElement("div");T.className="opps-greeting-pill";let x=document.createElement("input");x.type="text",x.className="opps-greeting-input",x.placeholder="Write a message\u2026",x.setAttribute("aria-label","Write a message");let y=document.createElement("button");y.className="opps-greeting-send",y.setAttribute("aria-label","Send message"),y.disabled=!0,y.innerHTML=Q,T.appendChild(x),T.appendChild(y),E.appendChild(C),E.appendChild(T),l.appendChild(E),a.appendChild(l);let m=`opps_${n}_greetingDismissed`;function b(){try{return sessionStorage.getItem(m)==="1"}catch(t){return!1}}function S(){try{sessionStorage.setItem(m,"1")}catch(t){}}let I=!1;function j(){I||N||b()||(I=!0,l.setAttribute("aria-hidden","false"),l.classList.remove("opps-greeting-closing"),l.classList.add("opps-greeting-opening"))}function A(t){if(t&&S(),l.getAttribute("aria-hidden")==="true"){I=!1;return}l.classList.remove("opps-greeting-opening"),l.classList.add("opps-greeting-closing"),setTimeout(()=>{l.setAttribute("aria-hidden","true"),l.classList.remove("opps-greeting-closing")},200),I=!1}x.addEventListener("input",()=>{y.disabled=x.value.trim()===""});function z(){let t=x.value.trim();t&&(x.value="",y.disabled=!0,A(!0),M(),h(t))}x.addEventListener("keydown",t=>{t.key==="Enter"&&!t.shiftKey&&(t.preventDefault(),z())}),y.addEventListener("click",()=>z()),C.addEventListener("click",()=>A(!0));let O=null;me(i,n).then(({config:t,blocked:D})=>{if(D){c.remove();return}c.style.display="",c.style.setProperty("--opps-primary-color",t.primaryColor),H(t),t.greetingEnabled&&!b()&&(O=setTimeout(j,t.greetingDelaySeconds*1e3))});let N=!1;function _(t){let D=document.createElement("span");D.className="opps-bubble-icon opps-icon-entering",D.innerHTML=t,o.innerHTML="",o.appendChild(D)}function M(){O&&(clearTimeout(O),O=null),A(!1),N=!0,g.setAttribute("aria-hidden","false"),g.classList.remove("opps-panel-closing"),g.classList.add("opps-panel-opening"),o.setAttribute("aria-label","Close chat"),_(ae);let t=g.querySelector(".opps-input");setTimeout(()=>t==null?void 0:t.focus(),330)}function P(){N=!1,g.classList.remove("opps-panel-opening"),g.classList.add("opps-panel-closing"),o.setAttribute("aria-label","Open chat"),_(K),setTimeout(()=>{g.setAttribute("aria-hidden","true"),g.classList.remove("opps-panel-closing")},220)}o.addEventListener("click",()=>{N?P():M()}),o.addEventListener("keydown",t=>{(t.key==="Enter"||t.key===" ")&&(t.preventDefault(),N?P():M())});let $=window;$.Opps||($.Opps={open:()=>{N||M()},close:()=>{N&&P()},sendMessage:t=>{typeof t!="string"||!t.trim()||(M(),h(t))},setContext:t=>{typeof t=="string"&&t&&B(t)}})}})();
