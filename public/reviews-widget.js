"use strict";(()=>{var A=`
:host {
  color-scheme: light;
}

*, *::before, *::after {
  box-sizing: border-box;
}

.orw-shell {
  --orw-bg: #fffdf7;
  --orw-card: #ffffff;
  --orw-text: #191919;
  --orw-muted: #6b665d;
  --orw-border: rgba(25, 25, 25, 0.12);
  --orw-shadow: 0 18px 50px rgba(25, 25, 25, 0.08);
  --orw-primary: #1f2937;
  --orw-star: #f59e0b;
  --orw-radius: 20px;
  width: 100%;
  max-width: var(--orw-max-width, 960px);
  margin: 0 auto;
  color: var(--orw-text);
  font-family: Georgia, 'Times New Roman', serif;
}

.orw-shell[data-theme="dark"] {
  --orw-bg: #171717;
  --orw-card: #222222;
  --orw-text: #f5f3ef;
  --orw-muted: #c9c2b8;
  --orw-border: rgba(245, 243, 239, 0.14);
  --orw-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
}

.orw-frame {
  border-radius: calc(var(--orw-radius) + 8px);
  background:
    radial-gradient(circle at top left, color-mix(in srgb, var(--orw-primary) 14%, transparent), transparent 34%),
    linear-gradient(180deg, color-mix(in srgb, var(--orw-primary) 6%, var(--orw-bg)), var(--orw-bg));
  border: 1px solid var(--orw-border);
  box-shadow: var(--orw-shadow);
  overflow: hidden;
}

.orw-header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
  padding: 22px 22px 16px;
}

.orw-kicker {
  margin: 0 0 6px;
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--orw-muted);
  font-family: 'Trebuchet MS', Arial, sans-serif;
}

.orw-title {
  margin: 0;
  font-size: clamp(22px, 4vw, 32px);
  line-height: 1.1;
  color: var(--orw-primary);
}

.orw-subtitle {
  margin: 8px 0 0;
  font-size: 14px;
  line-height: 1.5;
  color: var(--orw-muted);
  font-family: 'Trebuchet MS', Arial, sans-serif;
}

.orw-controls {
  display: flex;
  gap: 10px;
}

.orw-nav {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 999px;
  border: 1px solid var(--orw-border);
  background: var(--orw-card);
  color: var(--orw-primary);
  cursor: pointer;
}

.orw-nav[hidden] {
  display: none;
}

.orw-body {
  padding: 0 22px 22px;
}

.orw-list,
.orw-grid,
.orw-compact,
.orw-carousel-track {
  display: grid;
  gap: 16px;
}

.orw-list,
.orw-compact {
  grid-template-columns: 1fr;
}

.orw-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.orw-carousel-viewport {
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
  padding-bottom: 4px;
}

.orw-carousel-viewport::-webkit-scrollbar {
  display: none;
}

.orw-carousel-track {
  grid-auto-flow: column;
  grid-auto-columns: minmax(280px, 72%);
}

.orw-card {
  min-width: 0;
  height: 100%;
  padding: 18px;
  border-radius: var(--orw-radius);
  border: 1px solid var(--orw-border);
  background: var(--orw-card);
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.08);
}

.orw-carousel .orw-card {
  scroll-snap-align: start;
}

.orw-compact .orw-card {
  padding: 16px;
}

.orw-stars {
  display: inline-flex;
  gap: 3px;
  margin-bottom: 12px;
  color: var(--orw-star);
}

.orw-star {
  width: 16px;
  height: 16px;
  fill: currentColor;
}

.orw-copy {
  margin: 0 0 14px;
  font-size: 15px;
  line-height: 1.65;
  color: var(--orw-text);
}

.orw-footer-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.orw-author {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.orw-photo,
.orw-photo-fallback {
  width: 42px;
  height: 42px;
  border-radius: 999px;
  flex-shrink: 0;
}

.orw-photo {
  object-fit: cover;
  border: 1px solid var(--orw-border);
}

.orw-photo-fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--orw-primary) 10%, var(--orw-card));
  color: var(--orw-primary);
  font-family: 'Trebuchet MS', Arial, sans-serif;
  font-size: 13px;
  font-weight: 700;
}

.orw-author-meta {
  min-width: 0;
}

.orw-author-name,
.orw-author-name-link {
  display: inline-block;
  max-width: 100%;
  color: var(--orw-text);
  font-size: 14px;
  font-weight: 700;
  text-decoration: none;
  font-family: 'Trebuchet MS', Arial, sans-serif;
}

.orw-author-name-link:hover {
  text-decoration: underline;
}

.orw-date {
  margin-top: 3px;
  font-size: 12px;
  color: var(--orw-muted);
  font-family: 'Trebuchet MS', Arial, sans-serif;
}

.orw-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 999px;
  background: var(--orw-primary);
  color: #ffffff;
  text-decoration: none;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
  font-family: 'Trebuchet MS', Arial, sans-serif;
}

.orw-attribution {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 0 22px 20px;
  color: var(--orw-muted);
  font-size: 12px;
  font-family: 'Trebuchet MS', Arial, sans-serif;
}

.orw-powered {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.orw-powered img {
  height: 14px;
  width: auto;
}

.orw-place-link {
  color: var(--orw-primary);
  text-decoration: none;
  font-weight: 700;
}

.orw-place-link:hover {
  text-decoration: underline;
}

@media (max-width: 720px) {
  .orw-grid {
    grid-template-columns: 1fr;
  }

  .orw-header,
  .orw-attribution,
  .orw-footer-row {
    align-items: start;
  }

  .orw-carousel-track {
    grid-auto-columns: minmax(260px, 88%);
  }
}
`,f='<svg class="orw-star" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17.3 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"></path></svg>',l=document.currentScript,N,T,x=(T=(N=l==null?void 0:l.dataset.token)==null?void 0:N.trim())!=null?T:"";l&&x&&l.dataset.reviewsWidgetLoaded!=="true"&&(l.dataset.reviewsWidgetLoaded="true",L(l,x));async function L(e,a){let r=document.createElement("div");r.className="operator-reviews-widget-host",e.insertAdjacentElement("afterend",r);try{let o=r.attachShadow({mode:"open"}),t=M(e),i=new URL(e.src,window.location.href).origin,s=await P(i,a);if(!s||s.reviews.length===0){k(r);return}R(o,i,s,t)}catch(o){k(r)}}function M(e){return{layout:W(e.dataset.layout),theme:e.dataset.theme==="dark"?"dark":"light",primaryColor:b(e.dataset.primaryColor,"#1f2937"),starColor:b(e.dataset.starColor,"#f59e0b"),showPhoto:g(e.dataset.showPhoto,!0),showDate:g(e.dataset.showDate,!0),showGoogleButton:g(e.dataset.showGoogleButton,!0),borderRadius:y(e.dataset.borderRadius,20,8,40),maxWidth:y(e.dataset.maxWidth,960,280,1440)}}function W(e){return e==="carousel"||e==="grid"||e==="compact"||e==="list"?e:"list"}function g(e,a){return e==="true"?!0:e==="false"?!1:a}function b(e,a){return/^#[0-9A-Fa-f]{6}$/.test(e!=null?e:"")?e:a}function y(e,a,r,o){let t=Number(e);return Number.isFinite(t)?Math.min(o,Math.max(r,t)):a}async function P(e,a){var t;let r=await fetch(`${e}/api/reviews/${a}`,{method:"GET",headers:{Accept:"application/json"}});if(!r.ok)return null;let o=await r.json();return!((t=o==null?void 0:o.location)!=null&&t.name)||!Array.isArray(o.reviews)||o.reviews.length===0?null:o}function R(e,a,r,o){let t=document.createElement("style");t.textContent=A,e.appendChild(t);let i=document.createElement("section");i.className="orw-shell",i.dataset.theme=o.theme,i.style.setProperty("--orw-primary",o.primaryColor),i.style.setProperty("--orw-star",o.starColor),i.style.setProperty("--orw-radius",`${o.borderRadius}px`),i.style.setProperty("--orw-max-width",`${o.maxWidth}px`);let s=document.createElement("div");s.className="orw-frame",i.appendChild(s);let d=document.createElement("div");d.className="orw-header",d.innerHTML=`
    <div>
      <p class="orw-kicker">Google reviews</p>
      <h2 class="orw-title">What customers say about ${G(r.location.name)}</h2>
      <p class="orw-subtitle">Up to ${r.location.reviewCount} recent reviews from Google, rendered without touching your host site's styles.</p>
    </div>
  `;let u=document.createElement("div");u.className="orw-controls";let w=v("Previous reviews","&#8592;"),h=v("Next reviews","&#8594;");w.hidden=o.layout!=="carousel",h.hidden=o.layout!=="carousel",u.append(w,h),d.appendChild(u),s.appendChild(d);let p=document.createElement("div");if(p.className="orw-body",s.appendChild(p),o.layout==="carousel"){let n=document.createElement("div");n.className="orw-carousel-viewport orw-carousel";let c=document.createElement("div");c.className="orw-carousel-track",r.reviews.forEach(E=>{c.appendChild(C(E,o))}),n.appendChild(c),p.appendChild(n),w.addEventListener("click",()=>{n.scrollBy({left:-n.clientWidth*.85,behavior:"smooth"})}),h.addEventListener("click",()=>{n.scrollBy({left:n.clientWidth*.85,behavior:"smooth"})})}else{let n=document.createElement("div");n.className=o.layout==="grid"?"orw-grid":o.layout==="compact"?"orw-compact":"orw-list",r.reviews.forEach(c=>{n.appendChild(C(c,o))}),p.appendChild(n)}let m=document.createElement("div");if(m.className="orw-attribution",m.innerHTML=`
    <span class="orw-powered">
      <img src="${a}/google-logo.svg" alt="Google" />
      <span>Powered by Google</span>
    </span>
  `,r.location.mapsUrl){let n=document.createElement("a");n.className="orw-place-link",n.href=r.location.mapsUrl,n.target="_blank",n.rel="noopener noreferrer",n.textContent=`View ${r.location.name} on Google`,m.appendChild(n)}i.appendChild(m),e.appendChild(i)}function v(e,a){let r=document.createElement("button");return r.type="button",r.className="orw-nav",r.setAttribute("aria-label",e),r.innerHTML=a,r}function C(e,a){let r=document.createElement("article");r.className="orw-card";let o=document.createElement("div");o.className="orw-stars",o.setAttribute("aria-label",`${e.rating} out of 5 stars`),o.innerHTML=Array.from({length:5},(s,d)=>(d<e.rating,f)).join(""),r.appendChild(o);let t=document.createElement("p");t.className="orw-copy",t.textContent=e.reviewText||e.originalText||"Recommended by a Google reviewer.",r.appendChild(t);let i=document.createElement("div");if(i.className="orw-footer-row",i.appendChild(S(e,a)),a.showGoogleButton&&e.googleMapsUrl){let s=document.createElement("a");s.className="orw-button",s.href=e.googleMapsUrl,s.target="_blank",s.rel="noopener noreferrer",s.textContent="Read on Google",i.appendChild(s)}return r.appendChild(i),r}function S(e,a){let r=document.createElement("div");if(r.className="orw-author",a.showPhoto)if(e.authorPhotoUrl){let t=document.createElement("img");t.className="orw-photo",t.src=e.authorPhotoUrl,t.alt=e.authorName,r.appendChild(t)}else{let t=document.createElement("span");t.className="orw-photo-fallback",t.textContent=U(e.authorName),r.appendChild(t)}let o=document.createElement("div");if(o.className="orw-author-meta",e.authorUri){let t=document.createElement("a");t.className="orw-author-name-link",t.href=e.authorUri,t.target="_blank",t.rel="noopener noreferrer",t.textContent=e.authorName,o.appendChild(t)}else{let t=document.createElement("span");t.className="orw-author-name",t.textContent=e.authorName,o.appendChild(t)}if(a.showDate&&e.relativeTime){let t=document.createElement("div");t.className="orw-date",t.textContent=e.relativeTime,o.appendChild(t)}return r.appendChild(o),r}function U(e){let a=e.trim().split(/\s+/).filter(Boolean);return a.length>=2?`${a[0][0]}${a[1][0]}`.toUpperCase():e.trim().slice(0,2).toUpperCase()||"GR"}function k(e){e.remove()}function G(e){return e.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;")}})();
