/* BENIN TOURS – couche d'accès autonome (hors Claude).
   Remplace window.claude.use("db" | "user" | "downloads") par Firebase :
   Authentication (e-mail + mot de passe) et Cloud Firestore.
   Niveaux d'accès : propriétaire (DAF) > Éditeur (admin) > Contributeur (interact) > Lecteur (view). */
(function(){
"use strict";
const CFG=window.BT_FIREBASE_CONFIG;
const NIV=[["","Aucun accès"],["view","Lecteur (consultation)"],["interact","Contributeur"],["admin","Éditeur (saisie)"]];
const css=`#bt-login{position:fixed;inset:0;z-index:1000;background:#F3F5F4;display:flex;align-items:center;justify-content:center;padding:16px;font-family:"IBM Plex Sans",system-ui,sans-serif}
#bt-login .box{background:#fff;border:1px solid #DCE3E0;border-radius:12px;padding:28px;width:100%;max-width:380px;display:flex;flex-direction:column;gap:12px;color:#15201C}
#bt-login h1{font-family:"IBM Plex Sans Condensed",sans-serif;font-size:22px;margin:0}#bt-login p{margin:0;color:#5D6B66;font-size:13px}
#bt-login label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:#5D6B66}
#bt-login input{font:inherit;font-size:14px;padding:8px 10px;border:1px solid #DCE3E0;border-radius:6px;background:#EEF4FB;color:#15201C}
#bt-login button{font:inherit;font-weight:600;padding:9px 12px;border-radius:7px;border:1px solid #0E6B4F;background:#0E6B4F;color:#fff;cursor:pointer}
#bt-login button.lnk{background:none;border:0;color:#0E6B4F;padding:0;text-align:left;font-weight:500}
#bt-login .err{color:#B42318;font-size:13px;min-height:1em}
#bt-acc{position:fixed;inset:0;z-index:999;background:rgba(0,0,0,.35);display:flex;align-items:flex-start;justify-content:center;padding:40px 16px;overflow:auto}
#bt-acc .box{background:var(--panel,#fff);color:var(--ink,#15201C);border-radius:12px;padding:20px;width:100%;max-width:760px;display:flex;flex-direction:column;gap:12px}
#bt-acc table{width:100%;border-collapse:collapse;font-size:13px}#bt-acc td,#bt-acc th{padding:6px 8px;border-bottom:1px solid var(--line,#DCE3E0);text-align:left}
#bt-acc select{width:auto}`;
function el(h){const d=document.createElement("div");d.innerHTML=h.trim();return d.firstChild;}
function addCss(){const s=document.createElement("style");s.textContent=css;document.head.appendChild(s);}

let resolveAuth;const authReady=new Promise(r=>resolveAuth=r);
let fs=null,auth=null,cur=null,acces=null,profilsCache={};
window.BT_STANDALONE=true;
/* le budget (PTA) n'est pas publié avec le programme : il est lu dans la base protégée après connexion */
const _fetch=window.fetch.bind(window);
window.fetch=async(u,o)=>{if(/data\/budget\.json(\?|$)/.test(String(u))){await authReady;
  try{const d=await fs.collection("referentiel").doc("budget").get();const L=d.exists&&Array.isArray(d.data().lignes)?d.data().lignes:[];return new Response(JSON.stringify(L),{status:200,headers:{"Content-Type":"application/json"}});}
  catch(e){return new Response("[]",{status:200,headers:{"Content-Type":"application/json"}});}}
  return _fetch(u,o);};

function niveau(uid){if(!acces)return 0;if(acces.proprietaire===uid)return 4;const n=(acces.membres||{})[uid]||"";return {admin:3,interact:2,view:1}[n]||0;}

function loginScreen(msg){
  let o=document.getElementById("bt-login");if(o)o.remove();
  o=el(`<div id="bt-login"><form class="box" autocomplete="on">
   <h1>BENIN TOURS</h1><p>Gestion financière · SYSCOHADA. Connectez-vous avec le compte que le DAF vous a créé.</p>
   <label>Adresse e-mail<input type="email" id="bt-em" autocomplete="username" required></label>
   <label>Mot de passe<input type="password" id="bt-pw" autocomplete="current-password" required></label>
   <div class="err" id="bt-er">${msg||""}</div>
   <button type="submit" id="bt-go">Se connecter</button>
   <button type="button" class="lnk" id="bt-rs">Mot de passe oublié</button></form></div>`);
  document.body.appendChild(o);
  const er=t=>{document.getElementById("bt-er").textContent=t;};
  o.querySelector("form").addEventListener("submit",async e=>{e.preventDefault();er("");const b=document.getElementById("bt-go");b.disabled=true;
    try{await auth.signInWithEmailAndPassword(document.getElementById("bt-em").value.trim(),document.getElementById("bt-pw").value);}
    catch(x){b.disabled=false;er(/wrong-password|invalid-credential|user-not-found|invalid-login/.test(x.code||"")?"Adresse ou mot de passe incorrect.":/too-many/.test(x.code||"")?"Trop de tentatives : réessayez dans quelques minutes.":"Connexion impossible : "+(x.message||x.code||""));}});
  document.getElementById("bt-rs").addEventListener("click",async()=>{const m=document.getElementById("bt-em").value.trim();if(!m)return er("Saisissez d'abord votre adresse e-mail.");
    try{await auth.sendPasswordResetEmail(m);er("Un e-mail de réinitialisation vient de vous être envoyé.");}catch(x){er("Envoi impossible : "+(x.message||x.code||""));}});
}

async function afterLogin(u){
  cur=u;const lg=document.getElementById("bt-login");if(lg)lg.remove();
  const db=fs;
  /* profil (nom affiché dans le journal des interventions) */
  try{const p=await db.collection("profils").doc(u.uid).get();const nom=(p.exists&&p.data().nom)||u.displayName||u.email;
    await db.collection("profils").doc(u.uid).set({nom,email:u.email,vu:new Date().toISOString()},{merge:true});}catch(e){}
  /* configuration des accès : créée par le premier utilisateur (le DAF) */
  let c;
  try{c=await db.collection("acces").doc("config").get();}
  catch(e){return blocage(u,"Lecture de la configuration des accès refusée par Firebase ("+(e.code||e.message||"erreur")+"). Vérifiez que les règles du fichier firestore.rules sont publiées dans la console Firebase (Firestore > Règles), puis rechargez la page.");}
  if(!c.exists){
    /* première ouverture : pas de boîte confirm(), que certains navigateurs intégrés bloquent sans rien afficher */
    const ok=await premiereOuverture(u);if(!ok)return;
    try{await db.collection("acces").doc("config").set({proprietaire:u.uid,membres:{},creeLe:new Date().toISOString()});acces={proprietaire:u.uid,membres:{}};document.getElementById("bt-login")?.remove();}
    catch(e){return blocage(u,"Création du propriétaire refusée par Firebase ("+(e.code||e.message||"erreur")+"). Vérifiez que les règles du fichier firestore.rules sont publiées (Firestore > Règles), puis rechargez la page.");}
  }else acces=c.data();
  db.collection("acces").doc("config").onSnapshot(s=>{const prev=niveau(u.uid);acces=s.exists?s.data():null;if(niveau(u.uid)!==prev)location.reload();},()=>{});
  if(!niveau(u.uid)){document.body.appendChild(el(`<div id="bt-login"><div class="box"><h1>Accès en attente</h1><p>Votre compte (${esc(u.email)}) est bien connecté, mais le DAF ne vous a pas encore donné accès à l'outil. Demandez-lui de vous l'ouvrir dans « Accès à l'outil » ; la page se rechargera d'elle-même.</p><button type="button" id="bt-out2">Se déconnecter</button></div></div>`));
    document.getElementById("bt-out2").addEventListener("click",()=>auth.signOut().then(()=>location.reload()));return;}
  resolveAuth(true);sideButtons();
}
function blocage(u,msg){const o=document.getElementById("bt-login");if(o)o.remove();
  document.body.appendChild(el(`<div id="bt-login"><div class="box"><h1>Connexion impossible</h1><p>Compte : ${esc(u.email)}</p><div class="err">${esc(msg)}</div><button type="button" id="bt-out3">Se déconnecter</button></div></div>`));
  document.getElementById("bt-out3").addEventListener("click",()=>auth.signOut().then(()=>location.reload()));}
function premiereOuverture(u){return new Promise(res=>{const o0=document.getElementById("bt-login");if(o0)o0.remove();
  const o=el(`<div id="bt-login"><div class="box"><h1>Première ouverture de l'outil</h1><p>Aucun propriétaire n'est encore défini. En continuant, le compte <b>${esc(u.email)}</b> devient le propriétaire (DAF) de l'outil, seul habilité à gérer les accès, la paie, la sauvegarde et la restauration. Ce choix est définitif.</p><button type="button" id="bt-own">Devenir propriétaire (DAF)</button><button type="button" class="lnk" id="bt-own-no">Ce n'est pas moi : se déconnecter</button></div></div>`);
  document.body.appendChild(o);
  o.querySelector("#bt-own").addEventListener("click",e=>{e.target.disabled=true;res(true);});
  o.querySelector("#bt-own-no").addEventListener("click",()=>{res(false);auth.signOut().then(()=>location.reload());});});}
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

function sideButtons(){
  const add=()=>{const a=document.querySelector("aside");if(!a||document.getElementById("bt-side"))return;
    const own=niveau(cur.uid)===4;
    const d=el(`<div id="bt-side" style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--muted)"><span>Connecté : <b style="color:var(--ink)">${esc(profilsCache[cur.uid]||cur.email)}</b> · ${esc(["","Lecteur","Contributeur","Éditeur","Propriétaire (DAF)"][niveau(cur.uid)])}</span>
      ${own?'<button class="btn sm" id="bt-accb" type="button">Accès à l\'outil</button>':""}<button class="btn sm" id="bt-pwb" type="button">Changer mon mot de passe</button><button class="btn sm" id="bt-out" type="button">Se déconnecter</button></div>`);
    a.appendChild(d);
    document.getElementById("bt-out").addEventListener("click",()=>auth.signOut().then(()=>location.reload()));
    document.getElementById("bt-pwb").addEventListener("click",async()=>{try{await auth.sendPasswordResetEmail(cur.email);alert("Un e-mail pour choisir un nouveau mot de passe vient d'être envoyé à "+cur.email+".");}catch(x){alert("Envoi impossible : "+(x.message||""));}});
    if(own)document.getElementById("bt-accb").addEventListener("click",accesPanel);};
  add();new MutationObserver(add).observe(document.body,{childList:true,subtree:true});
}

async function accesPanel(){
  const db=fs;let P=[];try{const s=await db.collection("profils").limit(500).get();P=s.docs.map(d=>({id:d.id,...d.data()}));}catch(e){alert("Lecture des profils impossible : "+(e.message||""));return;}
  const M={...(acces.membres||{})};
  const o=el(`<div id="bt-acc"><div class="box"><div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0">Accès à l'outil</h2><button class="btn sm" id="bt-accx" type="button">Fermer</button></div>
   <p class="muted" style="margin:0;font-size:13px">Pour ajouter quelqu'un : créez son compte dans la console Firebase (Authentication &gt; Users &gt; Ajouter un utilisateur), puis demandez-lui de se connecter une fois : il apparaît alors dans ce tableau. Choisissez son niveau et enregistrez. Le niveau Éditeur est nécessaire pour saisir ; les rôles (comptable, agent comptable…) se cochent ensuite dans « Utilisateurs et rôles ». La paie reste réservée au propriétaire.</p>
   <table><thead><tr><th>Nom</th><th>E-mail</th><th>Dernière connexion</th><th>Niveau d'accès</th></tr></thead><tbody>
   ${P.sort((a,b)=>(a.nom||"").localeCompare(b.nom||"")).map(p=>`<tr><td><input data-nom="${esc(p.id)}" value="${esc(p.nom||"")}" ${p.id===cur.uid?"":"disabled"}></td><td>${esc(p.email||"")}</td><td>${esc((p.vu||"").slice(0,10).split("-").reverse().join("/"))}</td><td>${p.id===acces.proprietaire?"<b>Propriétaire (DAF)</b>":`<select data-uid="${esc(p.id)}">${NIV.map(([v,l])=>`<option value="${v}" ${(M[p.id]||"")===v?"selected":""}>${l}</option>`).join("")}</select>`}</td></tr>`).join("")}
   </tbody></table><div><button class="btn pri" id="bt-accs" type="button">Enregistrer</button></div></div></div>`);
  document.body.appendChild(o);
  o.querySelector("#bt-accx").addEventListener("click",()=>o.remove());
  o.querySelector("#bt-accs").addEventListener("click",async()=>{o.querySelectorAll("[data-uid]").forEach(s=>{if(s.value)M[s.dataset.uid]=s.value;else delete M[s.dataset.uid];});
    try{await db.collection("acces").doc("config").update({membres:M,modifieLe:new Date().toISOString(),modifiePar:cur.uid});
      const n=o.querySelector(`[data-nom="${cur.uid}"]`);if(n&&n.value.trim())await db.collection("profils").doc(cur.uid).set({nom:n.value.trim()},{merge:true});
      o.remove();alert("Accès enregistrés.");}catch(e){alert("Enregistrement refusé : "+(e.message||""));}});
}

const userApi={
  id:async()=>cur.uid,
  me:async()=>({id:cur.uid,name:profilsCache[cur.uid]||cur.email}),
  isOwner:async()=>niveau(cur.uid)===4,
  canEdit:async()=>niveau(cur.uid)>=3,
  can:name=>name==="data.write"?niveau(cur.uid)>=2:null,
  profiles:async ids=>{const out={};await Promise.all(ids.map(async id=>{if(profilsCache[id]===undefined){try{const p=await fs.collection("profils").doc(id).get();profilsCache[id]=p.exists?(p.data().nom||p.data().email||""):"";}catch(e){profilsCache[id]="";}}out[id]={name:profilsCache[id]};}));return out;}
};
const downloadsApi={save:async({filename,data})=>{const b=data instanceof Blob?data:new Blob([data],{type:/\.xlsx$/i.test(filename)?"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":/\.csv$/i.test(filename)?"text/csv;charset=utf-8":/\.json$/i.test(filename)?"application/json":"application/octet-stream"});
  const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=filename;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1500);}};

window.claude={use:async name=>{await authReady;if(name==="db")return fs;if(name==="user")return userApi;if(name==="downloads")return downloadsApi;return null;}};

/* Firestore refuse les tableaux imbriqués (ex. barème ITS [[seuil,taux],…]) que la version Claude acceptait.
   On les enveloppe à l'écriture ({__tab:[…]}) et on les rétablit à la lecture, de façon transparente pour l'outil. */
const TAB="__tab";
const plain=o=>o!==null&&typeof o==="object"&&(Object.getPrototypeOf(o)===Object.prototype||Object.getPrototypeOf(o)===null);
function enc(v,inArr){if(Array.isArray(v)){const a=v.map(x=>enc(x,true));return inArr?{[TAB]:a}:a;}
  if(plain(v)){const o={};for(const k of Object.keys(v))o[k]=enc(v[k],false);return o;}return v;}
function dec(v){if(Array.isArray(v))return v.map(dec);
  if(plain(v)){const ks=Object.keys(v);if(ks.length===1&&ks[0]===TAB&&Array.isArray(v[TAB]))return v[TAB].map(dec);const o={};for(const k of ks)o[k]=dec(v[k]);return o;}return v;}
function patchNestedArrays(){const F=firebase.firestore;if(!F||F.__btTab)return;F.__btTab=true;
  const DR=F.DocumentReference&&F.DocumentReference.prototype,CR=F.CollectionReference&&F.CollectionReference.prototype;
  if(DR){const set=DR.set,upd=DR.update;
    DR.set=function(d,...o){return set.call(this,enc(d,false),...o);};
    DR.update=function(a,...r){return typeof a==="string"||!plain(a)?upd.call(this,a,...r.map((x,i)=>i%2===0?enc(x,false):x)):upd.call(this,enc(a,false),...r);};}
  if(CR){const add=CR.add;CR.add=function(d){return add.call(this,enc(d,false));};}
  for(const C of [F.DocumentSnapshot,F.QueryDocumentSnapshot]){const P=C&&C.prototype;if(!P||!Object.prototype.hasOwnProperty.call(P,"data")&&P!==(F.DocumentSnapshot&&F.DocumentSnapshot.prototype))continue;
    const data=P.data;if(data.__btTab)continue;const w=function(...a){const d=data.apply(this,a);return d===undefined?d:dec(d);};w.__btTab=true;P.data=w;}
}
window.BT_TAB={enc,dec};
function start(){
  addCss();
  if(!CFG||!CFG.apiKey||/A_REMPLIR/.test(CFG.apiKey)){document.body.appendChild(el(`<div id="bt-login"><div class="box"><h1>Configuration manquante</h1><p>Le fichier config.js ne contient pas encore les paramètres du projet Firebase de BENIN TOURS. Voir le guide d'installation, étape 3.</p></div></div>`));return;}
  firebase.initializeApp(CFG);patchNestedArrays();auth=firebase.auth();fs=firebase.firestore();
  try{fs.settings({ignoreUndefinedProperties:true,merge:true});}catch(e){}
  auth.onAuthStateChanged(async u=>{if(u){try{const p=await fs.collection("profils").doc(u.uid).get();if(p.exists)profilsCache[u.uid]=p.data().nom||"";}catch(e){}afterLogin(u);}else loginScreen();});
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start);else start();
window.BT_SHIM={niveau:()=>cur?niveau(cur.uid):0};
})();
