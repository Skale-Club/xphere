"use strict";(()=>{var le=Object.defineProperty;var X=Object.getOwnPropertySymbols;var de=Object.prototype.hasOwnProperty,ce=Object.prototype.propertyIsEnumerable;var Q=(n,i,p)=>i in n?le(n,i,{enumerable:!0,configurable:!0,writable:!0,value:p}):n[i]=p,K=(n,i)=>{for(var p in i||(i={}))de.call(i,p)&&Q(n,p,i[p]);if(X)for(var p of X(i))ce.call(i,p)&&Q(n,p,i[p]);return n};var l={stageBg:"var(--bg-primary)",stageDots:"radial-gradient(circle, rgba(148,163,184,0.12) 1px, transparent 1px)",stageDotsSize:"16px 16px",panelBg:"#ceced2",headerBg:"#f4f4f5",borderColor:"#e4e4e7",assistantBubbleBg:null,inputFieldBg:"#ffffff",textPrimary:"#09090b",textSecondary:"#71717a",userBubbleRadius:"10px"};var S={displayName:"AI Assistant",primaryColor:"#18181B",welcomeMessage:"Hi! How can I help?",greetingEnabled:!0,greetingMessage:"Hi! How can I help?",greetingDelaySeconds:3},ge=`
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
  background: ${l.panelBg};
  border: 1px solid ${l.borderColor};
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
  background: ${l.inputFieldBg};
  border: 1px solid ${l.borderColor};
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
  color: ${l.textPrimary};
  font-family: inherit;
}
.opps-greeting-input::placeholder { color: ${l.textSecondary}; }
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
  background: ${l.headerBg};
  border-bottom: 1px solid ${l.borderColor};
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
  color: ${l.textPrimary};
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
  background: ${l.panelBg};
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
  border-radius: ${l.userBubbleRadius};
  font-size: 14px;
  font-weight: 400;
  line-height: 1.5;
}
.opps-bubble-assistant {
  color: ${l.textPrimary};
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
  background: ${l.panelBg};
  padding: 24px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.opps-input {
  flex: 1;
  height: 36px;
  background: ${l.inputFieldBg};
  border: 1px solid ${l.borderColor};
  border-radius: 18px;
  padding: 0 16px;
  font-size: 14px;
  font-weight: 400;
  line-height: 1.4;
  color: ${l.textPrimary};
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  outline: none;
}
.opps-input::placeholder { color: ${l.textSecondary}; }
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

/* Product cards (contract \xA76 ui/product_cards) */
.opps-cards {
  display: flex;
  flex-wrap: nowrap;
  gap: 10px;
  overflow-x: auto;
  padding: 8px 0 4px;
  margin-top: 4px;
  align-self: stretch;
  max-width: 100%;
}
.opps-card {
  flex: 0 0 auto;
  width: 148px;
  background: ${l.panelBg};
  border: 1px solid ${l.borderColor};
  border-radius: 10px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
.opps-card-img {
  width: 100%;
  height: 96px;
  object-fit: cover;
  display: block;
  background: ${l.inputFieldBg};
}
.opps-card-title {
  font-size: 12px;
  font-weight: 600;
  color: ${l.textPrimary};
  padding: 8px 10px 0;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.opps-card-price {
  font-size: 12px;
  font-weight: 400;
  color: ${l.textSecondary};
  padding: 2px 10px 0;
}
.opps-card-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 8px 10px 10px;
  margin-top: auto;
}
.opps-card-view {
  font-size: 11px;
  font-weight: 500;
  color: ${l.textPrimary};
  text-decoration: none;
  border: 1px solid ${l.borderColor};
  border-radius: 6px;
  padding: 5px 8px;
  white-space: nowrap;
}
.opps-card-view:hover { background: rgba(0,0,0,0.04); }
.opps-card-add {
  font-size: 11px;
  font-weight: 600;
  color: #ffffff;
  background: var(--opps-primary-color);
  border: none;
  border-radius: 6px;
  padding: 6px 8px;
  cursor: pointer;
  white-space: nowrap;
  transition: opacity 150ms ease;
}
.opps-card-add:hover { opacity: 0.92; }
.opps-card-add:active { opacity: 0.84; }
`,Z='<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',ue='<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',oe='<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>',me='<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',ee='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#52525b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>',fe='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#52525b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>',T=document.currentScript,ne,te=(ne=T==null?void 0:T.dataset.token)!=null?ne:"",he=T!=null&&T.src?new URL(T.src).origin:location.origin,ie,be=(ie=T==null?void 0:T.dataset.contextEndpoint)!=null?ie:"";te&&!document.getElementById("opps-root")&&Ee(te,he,be);function se(n){return`opps_${n}_sessionId`}function re(n){try{return localStorage.getItem(se(n))}catch(i){return null}}function xe(n,i){try{localStorage.setItem(se(n),i)}catch(p){}}function J(n,i){if(typeof n!="string")return i;let p=n.trim();return p.length>0?p:i}function ye(n){if(typeof n!="string")return S.primaryColor;let i=n.trim();return/^#[0-9A-Fa-f]{6}$/.test(i)?i.toUpperCase():S.primaryColor}function V(n){return n.trim().charAt(0).toUpperCase()||S.displayName.charAt(0)}async function we(n,i){try{let p=`${n}/api/widget/${i}/config?u=${encodeURIComponent(location.href)}`,u=await fetch(p,{method:"GET",headers:{Accept:"application/json"}});if(u.status===403)return{config:S,blocked:!0};if(!u.ok)return{config:S,blocked:!1};let d=await u.json(),c=J(d.welcomeMessage,S.welcomeMessage),s=typeof d.greetingDelaySeconds=="number"?d.greetingDelaySeconds:S.greetingDelaySeconds;return{config:{displayName:J(d.displayName,S.displayName),primaryColor:ye(d.primaryColor),welcomeMessage:c,greetingEnabled:d.greetingEnabled!==!1,greetingMessage:J(d.greetingMessage,c),greetingDelaySeconds:Math.max(0,Math.min(30,s))},blocked:!1}}catch(p){return{config:S,blocked:!1}}}async function ve(n,i){var c;if(!n.body)return;let p=n.body.getReader(),u=new TextDecoder,d="";for(;;){let{done:s,value:h}=await p.read();if(s)break;d+=u.decode(h,{stream:!0});let m=d.split(`
`);d=(c=m.pop())!=null?c:"";for(let P of m){let v=P.trim();if(v)try{i(JSON.parse(v))}catch(H){}}}if(d.trim())try{i(JSON.parse(d.trim()))}catch(s){}}async function ke(n){let{apiBase:i,token:p,message:u,sessionId:d,commerceContext:c,onEvent:s}=n,h;try{h=await fetch(`${i}/api/chat/${p}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(K(K({message:u,pageUrl:location.href},d?{sessionId:d}:{}),c?{commerce_context:c}:{}))})}catch(m){s({event:"error"});return}if(!h.ok||!h.body){s({event:"error",sessionId:String(h.status)});return}await ve(h,s)}function Ce(n,i,p,u,d){let c=document.createElement("div");c.className="opps-panel",c.setAttribute("role","dialog"),c.setAttribute("aria-label","Chat"),c.setAttribute("aria-hidden","true");let s=document.createElement("div");s.className="opps-header";let h=document.createElement("div");h.className="opps-avatar",h.textContent=V(S.displayName);let m=document.createElement("span");m.className="opps-bot-name",m.textContent=S.displayName;let P=document.createElement("div");P.className="opps-header-actions";let v=document.createElement("button");v.className="opps-header-btn",v.type="button",v.setAttribute("aria-label","Expand chat"),v.innerHTML=ee,P.appendChild(v),s.appendChild(h),s.appendChild(m),s.appendChild(P);let H=!1;v.addEventListener("click",()=>{H=!H,c.classList.toggle("opps-expanded",H),v.innerHTML=H?fe:ee,v.setAttribute("aria-label",H?"Collapse chat":"Expand chat")});let a=document.createElement("div");a.className="opps-messages",a.setAttribute("aria-live","polite");let N=document.createElement("div");N.className="opps-empty";let M=document.createElement("div");M.className="opps-empty-avatar",M.textContent=V(S.displayName);let B=document.createElement("p");B.className="opps-empty-heading",B.textContent=S.welcomeMessage;let k=document.createElement("p");k.className="opps-empty-body",k.textContent="Ask me anything \u2014 I\u2019m here to help.",N.appendChild(M),N.appendChild(B),N.appendChild(k),a.appendChild(N);let C=document.createElement("div");C.className="opps-input-area";let f=document.createElement("input");f.type="text",f.className="opps-input",f.placeholder="Type a message\u2026",f.setAttribute("aria-label","Message input");let y=document.createElement("button");y.className="opps-send",y.setAttribute("aria-label","Send message"),y.setAttribute("aria-disabled","true"),y.disabled=!0,y.innerHTML=oe,C.appendChild(f),C.appendChild(y),c.appendChild(s),c.appendChild(a),c.appendChild(C);let I=!1,$=re(i),F=!1,D=null,j=0;function O(e){try{let o=e.length%4===0?"":"=".repeat(4-e.length%4);return JSON.parse(atob(e.replace(/-/g,"+").replace(/_/g,"/")+o))}catch(o){return null}}function A(e){var g;let o=O((g=e.split(".")[0])!=null?g:"");D=e,j=typeof(o==null?void 0:o.exp)=="number"?o.exp:Math.floor(Date.now()/1e3)+60}async function U(){if(!u)return null;let e=Math.floor(Date.now()/1e3);if(D&&j>e+5)return D;try{let o=await fetch(u,{credentials:"same-origin"});if(!o.ok)return null;let{token:g}=await o.json();return g?(A(g),D):null}catch(o){return null}}function L(e,o){F||(N.remove(),F=!0);let g=document.createElement("div");g.className=`opps-msg opps-msg-${o==="user"?"user":"assistant"}`;let b=document.createElement("div");b.className=o==="error"?"opps-bubble-error":`opps-bubble-${o}`,b.textContent=e,g.appendChild(b),a.appendChild(g),a.scrollTop=a.scrollHeight}function _(e){var b,E;let o=e.filter(x=>typeof x=="object"&&x!==null);if(!o.length)return;let g=document.createElement("div");g.className="opps-cards";for(let x of o){let r=document.createElement("div");if(r.className="opps-card",typeof x.thumbnail=="string"&&x.thumbnail){let w=document.createElement("img");w.className="opps-card-img",w.src=x.thumbnail,w.alt="",r.appendChild(w)}let G=document.createElement("div");if(G.className="opps-card-title",G.textContent=String((b=x.title)!=null?b:""),r.appendChild(G),typeof x.price=="string"&&x.price){let w=document.createElement("div");w.className="opps-card-price",w.textContent=x.price,r.appendChild(w)}let W=document.createElement("div");if(W.className="opps-card-actions",typeof x.url=="string"&&x.url){let w=document.createElement("a");w.className="opps-card-view",w.href=x.url,w.target="_top",w.rel="noopener",w.textContent="View",W.appendChild(w)}let pe=String((E=x.title)!=null?E:""),R=document.createElement("button");R.className="opps-card-add",R.type="button",R.textContent="Add to cart",R.addEventListener("click",()=>{z(`Add "${pe}" to my cart`)}),W.appendChild(R),r.appendChild(W),g.appendChild(r)}a.appendChild(g),a.scrollTop=a.scrollHeight}function Y(){let e=document.createElement("div");e.className="opps-typing",e.setAttribute("aria-label","AI is typing");for(let o=0;o<3;o++){let g=document.createElement("div");g.className="opps-dot",e.appendChild(g)}return a.appendChild(e),a.scrollTop=a.scrollHeight,e}function t(e){f.disabled=!e,y.disabled=!e||f.value.trim()==="",y.setAttribute("aria-disabled",String(!e||f.value.trim()===""))}async function z(e){let o=e.trim();if(!o||I)return;I=!0,t(!1),L(o,"user");let g=Y(),b="",E=[],x=await U();await ke({apiBase:p,token:i,message:o,sessionId:$,commerceContext:x,onEvent:r=>{if(r.event==="session"&&r.sessionId)$||($=r.sessionId,xe(i,$));else if(r.event==="token"&&r.text)b+=r.text;else if(r.event==="commerce")window.dispatchEvent(new CustomEvent("xphere:commerce",{detail:{action:r.action,cartId:r.cartId,itemCount:r.itemCount,sig:r.sig}})),r.action==="cart_created"&&(D=null,j=0);else if(r.event==="ui"&&r.component==="product_cards"&&Array.isArray(r.items))E=r.items.slice(0,5);else if(r.event==="done")g.remove(),b&&L(b,"assistant"),b="",E.length&&(_(E),E=[]),I=!1,t(!0),f.focus();else if(r.event!=="tool_call"){if(r.event==="error"){g.remove();let W=r.sessionId==="401"?"This chat is unavailable right now.":"Something went wrong. Please try again.";L(W,"error"),I=!1,t(!0)}}}}),I&&(g.remove(),b&&L(b,"assistant"),E.length&&(_(E),E=[]),I=!1,t(!0))}function q(){let e=f.value.trim();!e||I||(f.value="",z(e))}f.addEventListener("input",()=>{y.disabled=f.value.trim()===""||I,y.setAttribute("aria-disabled",String(y.disabled))}),f.addEventListener("keydown",e=>{e.key==="Enter"&&!e.shiftKey&&(e.preventDefault(),q())}),y.addEventListener("click",()=>{q()}),c.addEventListener("keydown",e=>{if(e.key!=="Tab")return;let o=Array.from(c.querySelectorAll('button, input, [tabindex="0"]'));if(o.length===0)return;let g=o[0],b=o[o.length-1],E=n.activeElement;e.shiftKey?E===g&&(e.preventDefault(),b.focus()):E===b&&(e.preventDefault(),g.focus())});function ae(e){let o=V(e.displayName);h.textContent=o,m.textContent=e.displayName,M.textContent=o,B.textContent=e.welcomeMessage}return{panel:c,applyConfig:ae,submitMessage:z,setContext:A}}function Ee(n,i,p){let u=document.createElement("div");u.id="opps-root",u.style.display="none",document.body.appendChild(u);let d=u.attachShadow({mode:"open"}),c=document.createElement("style");c.textContent=ge,d.appendChild(c);let s=document.createElement("button");s.className="opps-bubble",s.setAttribute("aria-label","Open chat"),s.setAttribute("tabindex","0");let h=document.createElement("span");h.className="opps-bubble-icon",h.innerHTML=Z,s.appendChild(h),re(n)||s.classList.add("opps-pulse");let{panel:m,applyConfig:P,submitMessage:v,setContext:H}=Ce(d,n,i,p,s);d.appendChild(s),d.appendChild(m);let a=document.createElement("div");a.className="opps-greeting",a.setAttribute("aria-hidden","true");let N=document.createElement("div");N.className="opps-greeting-row";let M=document.createElement("button");M.className="opps-greeting-close",M.setAttribute("aria-label","Dismiss greeting"),M.innerHTML=me;let B=document.createElement("div");B.className="opps-greeting-pill";let k=document.createElement("input");k.type="text",k.className="opps-greeting-input",k.placeholder="Write a message\u2026",k.setAttribute("aria-label","Write a message");let C=document.createElement("button");C.className="opps-greeting-send",C.setAttribute("aria-label","Send message"),C.disabled=!0,C.innerHTML=oe,B.appendChild(k),B.appendChild(C),N.appendChild(M),N.appendChild(B),a.appendChild(N),d.appendChild(a);let f=`opps_${n}_greetingDismissed`;function y(){try{return sessionStorage.getItem(f)==="1"}catch(t){return!1}}function I(){try{sessionStorage.setItem(f,"1")}catch(t){}}let $=!1;function F(){$||A||y()||($=!0,a.setAttribute("aria-hidden","false"),a.classList.remove("opps-greeting-closing"),a.classList.add("opps-greeting-opening"))}function D(t){if(t&&I(),a.getAttribute("aria-hidden")==="true"){$=!1;return}a.classList.remove("opps-greeting-opening"),a.classList.add("opps-greeting-closing"),setTimeout(()=>{a.setAttribute("aria-hidden","true"),a.classList.remove("opps-greeting-closing")},200),$=!1}k.addEventListener("input",()=>{C.disabled=k.value.trim()===""});function j(){let t=k.value.trim();t&&(k.value="",C.disabled=!0,D(!0),L(),v(t))}k.addEventListener("keydown",t=>{t.key==="Enter"&&!t.shiftKey&&(t.preventDefault(),j())}),C.addEventListener("click",()=>j()),M.addEventListener("click",()=>D(!0));let O=null;we(i,n).then(({config:t,blocked:z})=>{if(z){u.remove();return}u.style.display="",u.style.setProperty("--opps-primary-color",t.primaryColor),P(t),t.greetingEnabled&&!y()&&(O=setTimeout(F,t.greetingDelaySeconds*1e3))});let A=!1;function U(t){let z=document.createElement("span");z.className="opps-bubble-icon opps-icon-entering",z.innerHTML=t,s.innerHTML="",s.appendChild(z)}function L(){O&&(clearTimeout(O),O=null),D(!1),A=!0,m.setAttribute("aria-hidden","false"),m.classList.remove("opps-panel-closing"),m.classList.add("opps-panel-opening"),s.setAttribute("aria-label","Close chat"),U(ue);let t=m.querySelector(".opps-input");setTimeout(()=>t==null?void 0:t.focus(),330)}function _(){A=!1,m.classList.remove("opps-panel-opening"),m.classList.add("opps-panel-closing"),s.setAttribute("aria-label","Open chat"),U(Z),setTimeout(()=>{m.setAttribute("aria-hidden","true"),m.classList.remove("opps-panel-closing")},220)}s.addEventListener("click",()=>{A?_():L()}),s.addEventListener("keydown",t=>{(t.key==="Enter"||t.key===" ")&&(t.preventDefault(),A?_():L())});let Y=window;Y.Opps||(Y.Opps={open:()=>{A||L()},close:()=>{A&&_()},sendMessage:t=>{typeof t!="string"||!t.trim()||(L(),v(t))},setContext:t=>{typeof t=="string"&&t&&H(t)}})}})();
