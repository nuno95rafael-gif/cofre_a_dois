/* ---------- utilitários ---------- */
const FMT=new Intl.NumberFormat('pt-PT',{style:'currency',currency:'EUR'});
const eur=v=>FMT.format(Math.abs(v)<0.005?0:v);
const r2=v=>Math.round((v+Number.EPSILON)*100)/100;
const uid=()=>(crypto.randomUUID?crypto.randomUUID():'id'+Date.now().toString(36)+Math.random().toString(36).slice(2,12));
const pad=n=>String(n).padStart(2,'0');
const iso=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parse=s=>{const[y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d)};
const TODAY=iso(new Date());
const dim=(y,m0)=>new Date(y,m0+1,0).getDate();
function addMonths(s,n){const[y,m,d]=s.split('-').map(Number);const t=(m-1)+n;const ny=y+Math.floor(t/12);const nm=((t%12)+12)%12;return `${ny}-${pad(nm+1)}-${pad(Math.min(d,dim(ny,nm)))}`}
function addDays(s,n){const d=parse(s);d.setDate(d.getDate()+n);return iso(d)}
const MESES=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const MAB=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const ym=s=>s.slice(0,7);
const ymLabel=k=>{const[y,m]=k.split('-').map(Number);return `${MESES[m-1]} ${y}`};
const ymAdd=(k,n)=>addMonths(k+'-01',n).slice(0,7);
const fDate=s=>{const[y,m,d]=s.split('-');return `${d}/${m}/${y}`};
const fShort=s=>{const[,m,d]=s.split('-').map(Number);return `${d} ${MAB[m-1]}`};
const daysBetween=(a,b)=>Math.round((parse(b)-parse(a))/86400000);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const FREQ={1:'Mensal',2:'Bimestral',3:'Trimestral',6:'Semestral',12:'Anual'};

/* ---------- estado ---------- */
let S=null;
const PREF=(()=>{try{return JSON.parse(localStorage.getItem('cofre-prefs')||'{}')}catch(e){return{}}})();
function savePref(){try{localStorage.setItem('cofre-prefs',JSON.stringify(PREF))}catch(e){}}
function save(){if(window.Cloud)Cloud.persistSoon()}
const DEFAULT_CATEGORIES=[
  {id:'casa',name:'Casa',icon:'🏠'},{id:'alim',name:'Alimentação',icon:'🛒'},{id:'rest',name:'Restauração',icon:'🍽️'},
  {id:'transp',name:'Transportes',icon:'🚗'},{id:'saude',name:'Saúde',icon:'💊'},{id:'lazer',name:'Lazer',icon:'🎬'},
  {id:'subs',name:'Subscrições',icon:'📺'},{id:'viag',name:'Viagens',icon:'✈️'},{id:'anim',name:'Animais',icon:'🐾'},
  {id:'pres',name:'Presentes',icon:'🎁'},{id:'outros',name:'Outros',icon:'📦'}];

function generate(){
  const horizon=addDays(TODAY,31);
  for(const r of S.recurring){
    if(!r.active)continue;
    for(let k=0;k<1000;k++){
      const d=addMonths(r.start,k*r.freq);
      if(d>horizon||(r.end&&d>r.end))break;
      if(d<r.genFrom||r.skip.includes(d))continue;
      if(S.expenses.some(e=>e.recurringId===r.id&&e.period===d))continue;
      S.expenses.push({id:`rec_${r.id}_${d}`,desc:r.desc,amount:r.amount,cat:r.cat,date:d,status:'por_pagar',paidDate:null,scope:r.scope,owner:r.owner,payer:r.payer,split:{...r.split},recurringId:r.id,period:d});
    }
  }
  // gastos fixos com pagamento automático (débito direto): ficam pagos quando chega a data
  for(const e of S.expenses){
    if(e.status!=='pago'&&e.date<=TODAY&&isAuto(e)){e.status='pago';e.paidDate=e.date}
  }
}
function isAuto(e){
  if(!e.recurringId||e.autoPay===false)return false;
  const r=S.recurring.find(x=>x.id===e.recurringId);
  return !!r&&r.autoPay!==false;
}
function nextDue(r){
  if(!r.active)return null;
  for(let k=0;k<1000;k++){const d=addMonths(r.start,k*r.freq);if(r.end&&d>r.end)return null;if(d>=TODAY&&!r.skip.includes(d))return d}
  return null;
}

/* ---------- regras de negócio ---------- */
const other=u=>u==='u1'?'u2':'u1';
const nm=u=>(S.users[u]&&S.users[u].name)||(u===S.viewer?'Tu':'A outra pessoa');
const you=u=>u===S.viewer?'Tu':nm(u);
const cat=id=>S.categories.find(c=>c.id===id)||S.categories.find(c=>c.id==='outros')||{name:'Outros',icon:'📦'};
function shares(e){
  if(e.scope==='pessoal')return{u1:e.owner==='u1'?e.amount:0,u2:e.owner==='u2'?e.amount:0};
  const s=e.split||{type:'equal'};let a;
  if(s.type==='percent')a=r2(e.amount*s.value/100);
  else if(s.type==='fixed')a=r2(Math.min(s.value,e.amount));
  else a=r2(e.amount/2);
  return{u1:a,u2:r2(e.amount-a)};
}
const myPart=e=>shares(e)[S.viewer];
function balanceU1(){ // >0: u2 deve a u1
  let b=0;
  for(const e of S.expenses){if(e.scope!=='partilhada'||e.status!=='pago')continue;const sh=shares(e);if(e.payer==='u1')b+=sh.u2;else b-=sh.u1}
  for(const t of S.settlements){if(t.from==='u2')b-=t.amount;else b+=t.amount}
  return r2(b);
}
const balanceViewer=()=>S.viewer==='u1'?balanceU1():-balanceU1();
const isLate=e=>e.status==='por_pagar'&&e.date<TODAY;
function splitText(e){
  if(e.scope!=='partilhada')return '';
  const s=e.split||{type:'equal'};
  if(s.type==='equal')return '50/50';
  if(s.type==='percent')return `${nm('u1')} ${r2(s.value)}% · ${nm('u2')} ${r2(100-s.value)}%`;
  const sh=shares(e);return `${nm('u1')} ${eur(sh.u1)} · ${nm('u2')} ${eur(sh.u2)}`;
}

/* ---------- UI helpers ---------- */
const $=s=>document.querySelector(s);
let toastT;
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove('show'),2200)}
function statusBadge(e){
  if(e.status==='pago')return `<span class="badge b-paid">✓ Pago${e.paidDate?' '+fShort(e.paidDate):''}</span>`;
  if(isAuto(e))return `<span class="badge b-pers">🔁 Automático a ${fShort(e.date)}</span>`;
  if(isLate(e))return `<span class="badge b-late">⚠ Em atraso</span>`;
  return `<span class="badge b-due">⏳ Por pagar</span>`;
}
function expRow(e,opts={}){
  const c=cat(e.cat);const shared=e.scope==='partilhada';
  const sub=[c.name, opts.showDate!==false?fShort(e.date):null,
    shared?(e.status==='pago'?`pagou ${e.payer===S.viewer?'tu':nm(e.payer)}`:`paga ${e.payer===S.viewer?'tu':nm(e.payer)}`):null,
    shared&&e.split&&e.split.type!=='equal'?splitShort(e):null,
    e.recurringId?'🔁 fixo':null].filter(Boolean).join(' · ');
  const extras=`${(e.photos&&e.photos.length)?` <span class="badge b-pers">📎 ${e.photos.length}</span>`:''}${e.notes?' <span class="badge b-pers" title="Tem notas">📝</span>':''}`;
  const share=shared?`<div class="share">tua parte ${eur(myPart(e))}</div>`:'';
  const quick=opts.quick&&e.status!=='pago'&&!isAuto(e)?`<div><button class="btn small primary" data-pay="${e.id}" style="margin-top:4px">Marcar pago</button></div>`:'';
  return `<div class="swipe"><div class="sw-act"><button class="sw-dup" data-swdup="${e.id}" tabindex="-1">⧉<small>Duplicar</small></button><button class="sw-del" data-swdel="${e.id}" tabindex="-1">🗑<small>Apagar</small></button></div><div class="row" tabindex="0" data-exp="${e.id}">
    <div class="ico">${esc(c.icon)}</div>
    <div class="mid"><div class="t">${esc(e.desc)}</div><div class="s">${esc(sub)}</div><div>${statusBadge(e)}${extras}</div>${e.notes&&opts.showDate===false?`<div class="s" style="font-style:italic">“${esc(e.notes)}”</div>`:''}</div>
    <div class="r"><div class="amt">${eur(e.amount)}</div>${share}${quick}</div>
  </div></div>`;
}
function dupPrefill(ex){return{desc:ex.desc,amount:ex.amount,cat:ex.cat,scope:ex.scope,owner:ex.owner,payer:ex.payer,split:{...ex.split},notes:ex.notes||'',date:TODAY,paidDate:TODAY,status:'pago'}}
function deleteExpense(ex,extra=[]){
  if(ex.recurringId){const r=S.recurring.find(r=>r.id===ex.recurringId);if(r&&!r.skip.includes(ex.period))r.skip.push(ex.period)}
  [...(ex.photos||[]),...extra].forEach(id=>PH.del(id));
  S.expenses=S.expenses.filter(e=>e.id!==ex.id);commit('Despesa apagada');
}
function askDeleteExpense(ex,extra=[]){confirmSheet('Apagar despesa?',`"${ex.desc}" de ${eur(ex.amount)} vai ser apagada${(ex.photos||[]).length?', com as fotos':''}.`,'Apagar',()=>deleteExpense(ex,extra))}
function splitShort(e){const sh=shares(e);const a=Math.round(sh.u1/e.amount*100);return `${a}/${100-a}`}

/* ---------- vistas ---------- */
const UI={gmonth:ym(TODAY),space:'casal',month:ym(TODAY),status:'todos',cat:'todas',rmonth:ym(TODAY)};
const isCasal=()=>UI.space==='casal';
const inSpace=x=>isCasal()?x.scope==='partilhada':(x.scope==='pessoal'&&x.owner===S.viewer);
const spaceVal=e=>e.amount; // em cada espaço, o valor mostrado é o valor total da despesa
const sumMine=list=>list.reduce((a,e)=>a+myPart(e),0);

function listsBlock(vis){
  const late=vis.filter(isLate).sort((a,b)=>a.date.localeCompare(b.date));
  const lim=addDays(TODAY,30);
  const next=vis.filter(e=>e.status!=='pago'&&e.date>=TODAY&&e.date<=lim).sort((a,b)=>a.date.localeCompare(b.date));
  return `${late.length?`<h3 class="sec">⚠ Em atraso</h3><div class="list">${late.map(e=>expRow(e,{quick:true})).join('')}</div>`:''}
  <h3 class="sec">Próximos 30 dias</h3>
  <div class="list">${next.length?next.map(e=>expRow(e,{quick:true})).join(''):'<div class="empty">Nada por pagar nos próximos 30 dias.</div>'}</div>`;
}

function vInicio(){
  const mk=ym(TODAY),mes=MESES[+mk.slice(5)-1];
  const vis=S.expenses.filter(inSpace);
  const month=vis.filter(e=>ym(e.date)===mk);
  const unpaid=month.filter(e=>e.status!=='pago');
  const note=!S.users[other(S.viewer)]&&isCasal()?`<div class="demo-note">💌 Falta a outra pessoa entrar no cofre. Partilha o código <b style="font-size:15px;letter-spacing:.08em">${esc(S.household.invite_code)}</b>: basta criar conta e escolher “Entrar com código”. <a href="#definicoes">Mais detalhes</a></div>`:'';
  if(isCasal()){
    const b=balanceViewer();const o=nm(other(S.viewer));
    const big=b>0.004?`${esc(o)} deve-te ${eur(b)}`:b<-0.004?`Deves ${eur(-b)} a ${esc(o)}`:'Estão quites 🎉';
    const hist=[...S.settlements].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,3);
    // previsão: o saldo quando as contas partilhadas por pagar até ao fim do mês forem pagas por quem as vai pagar
    const endM=mk+'-31';
    const pend=S.expenses.filter(e=>e.scope==='partilhada'&&e.status!=='pago'&&e.date<=endM);
    let proj='';
    if(pend.length){
      let d=0;for(const e of pend){const sh=shares(e);d+=e.payer==='u1'?sh.u2:-sh.u1}
      const pb=r2(b+(S.viewer==='u1'?d:-d));
      const tot=pend.reduce((a,e)=>a+e.amount,0);
      const txt=pb>0.004?`${esc(o)} vai dever-te ${eur(pb)}`:pb<-0.004?`vais dever ${eur(-pb)} a ${esc(o)}`:'continuam quites';
      proj=`<div class="preview" style="margin:-4px 0 12px">⏳ Há ${pend.length} ${pend.length===1?'conta partilhada':'contas partilhadas'} por pagar este mês (${eur(tot)}). Quando ${pend.length===1?'estiver paga':'estiverem pagas'}, ${txt}.</div>`;
    }
    return `${note}<div class="cols"><div>
    <div class="card balance">
      <div class="pair">${avatar('u1',36)}${S.users.u2?avatar('u2',36):''}</div>
      <div class="lbl">Saldo entre os dois <span class="muted">(só contas já pagas)</span></div>
      <div class="big">${big}</div>${proj}
      <button class="btn primary" id="settle" ${Math.abs(b)<0.005?'disabled style="opacity:.5"':''}>${Math.abs(b)<0.005?'Acertar contas':`Acertar ${eur(Math.abs(b))}`}</button>
      ${hist.length?`<div class="hist"><div class="muted" style="font-size:12px">Últimos acertos</div>${hist.map(t=>`<div><span>${fShort(t.date)} · ${esc(you(t.from))} → ${esc(you(t.to))}${t.note?' · '+esc(t.note):''}</span><b>${eur(t.amount)}</b></div>`).join('')}</div>`:''}
    </div>
    <div class="grid2">
      <div class="card stat"><div class="lbl">Gastos do casal em ${mes}</div><div class="val">${eur(month.reduce((a,e)=>a+e.amount,0))}</div><div class="sub">a tua parte: ${eur(sumMine(month))}</div></div>
      <div class="card stat"><div class="lbl">Por pagar este mês</div><div class="val">${eur(unpaid.reduce((a,e)=>a+e.amount,0))}</div><div class="sub">${unpaid.length} ${unpaid.length===1?'conta':'contas'}</div></div>
    </div>${budgetAlerts(mk)}${goalsBlock()}</div>
    <div>${listsBlock(vis)}</div></div>`;
  }
  const pers=month.reduce((a,e)=>a+e.amount,0);
  const sharedMine=sumMine(S.expenses.filter(e=>e.scope==='partilhada'&&ym(e.date)===mk));
  return `${note}<div class="cols"><div>
  ${balanceCard(mk,`Balanço de ${mes} (ganhos − gastos)`)}
  <div class="grid2">
    <div class="card stat"><div class="lbl">Por pagar este mês</div><div class="val">${eur(unpaid.reduce((a,e)=>a+e.amount,0))}</div><div class="sub">${unpaid.length} ${unpaid.length===1?'conta':'contas'}</div></div>
    <div class="card stat"><div class="lbl">Só tu vês</div><div class="val">🔒</div><div class="sub">${esc(nm(other(S.viewer)))} não tem acesso a este espaço</div></div>
  </div>${budgetAlerts(mk)}${goalsBlock()}</div>
  <div>${listsBlock(vis)}</div></div>`;
}

const norm=s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
function matchQ(e,q){
  const nq=norm(q).trim();if(!nq)return true;
  const hay=norm([e.desc,e.notes,cat(e.cat).name].join(' '));
  const qa=nq.replace(',','.').replace(/\s*€/,'');
  if(/^\d+(\.\d+)?$/.test(qa)&&String(e.amount.toFixed(2)).startsWith(qa))return true;
  return nq.split(/\s+/).every(w=>hay.includes(w));
}
function expTable(list){
  const c=isCasal();
  const head=`<tr><th>Data</th><th>Descrição</th><th>Categoria</th>${c?'<th>Pagou</th>':''}<th class="num">Valor</th>${c?'<th class="num">Tua parte</th>':''}<th>Estado</th><th></th></tr>`;
  const rows=list.map(e=>{const ct=cat(e.cat);return `<tr tabindex="0" data-exp="${e.id}">
    <td class="nowrap">${fDate(e.date)}</td>
    <td><div class="t">${esc(e.desc)}${e.recurringId?' <span class="muted" title="Gasto fixo">🔁</span>':''}${e.photos&&e.photos.length?` <span class="muted" title="Fotos">📎${e.photos.length}</span>`:''}</div>${e.notes?`<div class="s">“${esc(e.notes)}”</div>`:''}</td>
    <td class="nowrap">${esc(ct.icon)} ${esc(ct.name)}</td>
    ${c?`<td class="nowrap">${e.payer===S.viewer?'Tu':esc(nm(e.payer))}${e.split&&e.split.type!=='equal'?` <span class="muted">(${splitShort(e)})</span>`:''}</td>`:''}
    <td class="num"><b>${eur(e.amount)}</b></td>
    ${c?`<td class="num">${eur(myPart(e))}</td>`:''}
    <td class="nowrap">${statusBadge(e)}</td>
    <td class="num">${e.status!=='pago'&&!isAuto(e)?`<button class="btn small primary" data-pay="${e.id}">Marcar pago</button>`:''}</td></tr>`}).join('');
  return `<table class="tbl"><thead>${head}</thead><tbody>${rows}</tbody></table>`;
}
function despesasResults(){
  const q=(UI.q||'').trim();
  let list=S.expenses.filter(inSpace);
  if(!q)list=list.filter(e=>ym(e.date)===UI.month);else list=list.filter(e=>matchQ(e,q));
  if(UI.status==='pago')list=list.filter(e=>e.status==='pago');
  if(UI.status==='por_pagar')list=list.filter(e=>e.status!=='pago');
  if(UI.status==='atraso')list=list.filter(isLate);
  if(UI.cat!=='todas')list=list.filter(e=>e.cat===UI.cat);
  list.sort((a,b)=>b.date.localeCompare(a.date));
  const tot=list.reduce((a,e)=>a+e.amount,0);
  let html='',last='',lastM='';
  for(const e of list){
    if(q&&ym(e.date)!==lastM){lastM=ym(e.date);html+=`<div class="dayhdr" style="color:var(--ink);font-size:13px;padding-top:14px">${ymLabel(lastM)}</div>`;last=''}
    if(e.date!==last){const d=parse(e.date);html+=`<div class="dayhdr">${d.toLocaleDateString('pt-PT',{weekday:'long',day:'numeric',month:'long'})}</div>`;last=e.date}
    html+=expRow(e,{showDate:false});
  }
  if(wide())html=list.length?expTable(list):'';
  return `<div class="totals"><span>${list.length} ${list.length===1?'despesa':'despesas'}${q?' encontradas':''} · total <b>${eur(tot)}</b></span>${isCasal()?`<span>tua parte <b>${eur(sumMine(list))}</b></span>`:''}</div>
  <div class="list">${html||`<div class="empty">${q?`Nada encontrado para “${esc(q)}”.`:'Sem despesas com estes filtros.'}</div>`}</div>`;
}
function vDespesas(){
  const q=UI.q||'';
  return `<h2 class="page">${isCasal()?'Despesas do casal':'Despesas pessoais'}</h2>
  <div class="search"><span aria-hidden="true">🔍</span><input id="q" type="search" placeholder="Pesquisar em todos os meses…" value="${esc(q)}" autocomplete="off" aria-label="Pesquisar despesas"><button id="qx" class="${q?'':'hidden'}" aria-label="Limpar pesquisa">✕</button></div>
  <div class="monthnav ${q?'hidden':''}" id="mnav"><button data-m="-1" aria-label="Mês anterior">‹</button><b>${ymLabel(UI.month)}</b><button data-m="1" aria-label="Mês seguinte">›</button></div>
  <div class="filters">
    <select class="chip" id="fst" aria-label="Estado">
      <option value="todos" ${UI.status==='todos'?'selected':''}>Estado: todos</option>
      <option value="pago" ${UI.status==='pago'?'selected':''}>Pago</option>
      <option value="por_pagar" ${UI.status==='por_pagar'?'selected':''}>Por pagar</option>
      <option value="atraso" ${UI.status==='atraso'?'selected':''}>Em atraso</option>
    </select>
    <select class="chip" id="fcat" aria-label="Categoria">
      <option value="todas">Categoria: todas</option>
      ${S.categories.map(c=>`<option value="${c.id}" ${UI.cat===c.id?'selected':''}>${esc(c.icon+' '+c.name)}</option>`).join('')}
    </select>
  </div>
  ${!wide()&&!PREF.swiped&&('ontouchstart' in window)?'<p class="muted sw-hint" style="font-size:12.5px;margin:0 2px 8px">💡 Desliza uma despesa para a esquerda para a duplicar ou apagar.</p>':''}
  <div id="dres">${despesasResults()}</div>`;
}

function vFixos(){
  const list=S.recurring.filter(inSpace);
  const act=list.filter(r=>r.active);
  const monthlyTotal=act.reduce((a,r)=>a+r.amount/r.freq,0);
  const monthlyMine=act.reduce((a,r)=>a+shares(r)[S.viewer]/r.freq,0);
  list.sort((a,b)=>(b.active-a.active)||(nextDue(a)||'9').localeCompare(nextDue(b)||'9'));
  const rows=list.map(r=>{
    const c=cat(r.cat),nd=nextDue(r);
    const eq=r.freq>1?` · ≈ ${eur(r.amount/r.freq)}/mês`:'';
    const pz=r.active?'':`<span class="badge b-pause">⏸ Em pausa</span>`;
    const who=(r.scope==='partilhada'?` · paga ${r.payer===S.viewer?'tu':nm(r.payer)}`:'')+(r.autoPay!==false?' · 🔁 automático':'');
    const part=r.scope==='partilhada'?`<div class="share">tua parte ${eur(shares(r)[S.viewer])}</div>`:'';
    return `<div class="row" tabindex="0" data-rec="${r.id}" style="${r.active?'':'opacity:.6'}">
      <div class="ico">${esc(c.icon)}</div>
      <div class="mid"><div class="t">${esc(r.desc)}</div><div class="s">${FREQ[r.freq]}${eq}${who}</div><div class="s">${nd?'Próximo: '+fDate(nd):''}</div>${pz?`<div>${pz}</div>`:''}</div>
      <div class="r"><div class="amt">${eur(r.amount)}</div>${part}</div></div>`}).join('');
  const stats=isCasal()
    ?`<div class="card stat"><div class="lbl">Fixos do casal</div><div class="val">${eur(monthlyTotal)}<span class="muted" style="font-size:13px;font-weight:500">/mês</span></div><div class="sub">${eur(monthlyTotal*12)} por ano</div></div>
      <div class="card stat"><div class="lbl">A tua parte</div><div class="val">${eur(monthlyMine)}<span class="muted" style="font-size:13px;font-weight:500">/mês</span></div><div class="sub">${eur(monthlyMine*12)} por ano</div></div>`
    :`<div class="card stat"><div class="lbl">Os teus fixos pessoais</div><div class="val">${eur(monthlyTotal)}<span class="muted" style="font-size:13px;font-weight:500">/mês</span></div><div class="sub">${eur(monthlyTotal*12)} por ano</div></div>
      <div class="card stat"><div class="lbl">Ativos</div><div class="val">${act.length}</div><div class="sub">${list.length-act.length} em pausa</div></div>`;
  return `<h2 class="page">${isCasal()?'Fixos do casal':'Fixos pessoais'}</h2>
  <div class="grid2" style="margin-top:0">${stats}</div>
  <p class="muted" style="font-size:12.5px;margin:10px 2px">Anuidades e semestralidades aparecem também como custo mensal (ex.: 360 €/ano ≈ 30 €/mês). A app cria cada pagamento sozinha, como <i>por pagar</i>.</p>
  <div class="list">${rows||'<div class="empty">Ainda não há gastos fixos aqui. Toca em + para adicionar.</div>'}</div>`;
}

function monthTotal(k){return S.expenses.filter(inSpace).filter(e=>ym(e.date)===k).reduce((a,e)=>a+e.amount,0)}
function vResumo(){
  const k=UI.rmonth;
  const vis=S.expenses.filter(inSpace).filter(e=>ym(e.date)===k);
  const total=vis.reduce((a,e)=>a+e.amount,0);
  const prevK=ymAdd(k,-1),prev=monthTotal(prevK),delta=total-prev;
  const unpaid=vis.filter(e=>e.status!=='pago').reduce((a,e)=>a+e.amount,0);
  const by={};for(const e of vis)by[e.cat]=(by[e.cat]||0)+e.amount;
  const cats=Object.entries(by).sort((a,b)=>b[1]-a[1]);
  const max=cats.length?cats[0][1]:1;
  const bars=cats.map(([id,v])=>{const c=cat(id);const p=total?Math.round(v/total*100):0;
    return `<div class="cbar" tabindex="0" data-tip="${esc(c.name)}|${eur(v)} · ${p}% do mês"><div class="nm">${esc(c.icon)} ${esc(c.name)}</div><div class="track"><div class="fill" style="width:${(v/max*100).toFixed(1)}%"></div></div><div class="v">${eur(v)}<small>${p}%</small></div></div>`}).join('');
  const months=[];for(let i=5;i>=0;i--)months.push(ymAdd(k,-i));
  const vals=months.map(monthTotal);const tmax=Math.max(...vals,1);
  const cols=months.map((m,i)=>{const h=vals[i]/tmax*100;const sel=m===k;
    return `<div class="tcol ${sel?'sel':''}" tabindex="0" data-rm="${m}" data-tip="${esc(ymLabel(m))}|${eur(vals[i])}">${sel?`<div class="tv" style="bottom:calc(${h}% + 4px)">${eur(vals[i])}</div>`:''}<div class="tb" style="height:${h}%"></div></div>`}).join('');
  const dtxt=prev>0?`${delta>=0?'▲ +':'▼ −'}${eur(Math.abs(delta))} (${delta>=0?'+':'−'}${Math.abs(Math.round(delta/prev*100))}%) face a ${MESES[+prevK.slice(5)-1]}`:`sem dados de ${MESES[+prevK.slice(5)-1]}`;
  const extra=isCasal()
    ?`<div class="sub">A tua parte: ${eur(sumMine(vis))} · ${esc(nm(other(S.viewer)))}: ${eur(total-sumMine(vis))}</div>`
    :`<div class="sub">+ a tua parte no casal: ${eur(sumMine(S.expenses.filter(e=>e.scope==='partilhada'&&ym(e.date)===k)))}</div>`;
  return `<h2 class="page">${isCasal()?'Resumo do casal':'Resumo pessoal'}</h2>
  <div class="monthnav"><button data-rmn="-1" aria-label="Mês anterior">‹</button><b>${ymLabel(k)}</b><button data-rmn="1" aria-label="Mês seguinte">›</button></div>
  <div class="card stat"><div class="lbl">${isCasal()?'Total gasto pelo casal':'Total dos teus gastos pessoais'}</div><div class="val" style="font-size:28px">${eur(total)}</div><div class="sub">${dtxt}${unpaid>0?` · inclui ${eur(unpaid)} por pagar`:''}</div>${extra}</div>
  ${isCasal()?'':`<div class="mt">${balanceCard(k,'Ganhos vs gastos')}</div>`}
  ${budgetsBlock(k,`Orçamentos de ${MESES[+k.slice(5)-1]}`)}
  <div class="cols"><div>
  <h3 class="sec">Por categoria</h3>
  <div class="card">${bars||'<div class="empty">Sem despesas neste mês.</div>'}</div>
  </div><div>
  <h3 class="sec">Últimos 6 meses</h3>
  <div class="card"><div class="trend">${cols}</div><div class="tlabels">${months.map(m=>`<span class="${m===k?'sel':''}">${MAB[+m.slice(5)-1]}</span>`).join('')}</div>
  <p class="muted" style="font-size:12px;margin:8px 0 0">Toca numa barra para ver esse mês.</p></div></div></div>
  ${evolutionBlock(k)}`;
}
function evolutionBlock(k){
  const months=[];for(let i=11;i>=0;i--)months.push(ymAdd(k,-i));
  const inRange=S.expenses.filter(inSpace).filter(e=>ym(e.date)>=months[0]&&ym(e.date)<=k);
  const tot={};for(const e of inRange)tot[e.cat]=(tot[e.cat]||0)+e.amount;
  const cats=Object.keys(tot).sort((a,b)=>tot[b]-tot[a]);
  if(!cats.length)return '';
  if(!UI.evoCat||!tot[UI.evoCat])UI.evoCat=cats[0];
  const c=UI.evoCat;
  const vals=months.map(m=>inRange.filter(e=>e.cat===c&&ym(e.date)===m).reduce((a,e)=>a+e.amount,0));
  const mx=Math.max(...vals,1),used=vals.filter(v=>v>0),avg=used.length?used.reduce((a,v)=>a+v,0)/used.length:0;
  const iMax=vals.indexOf(Math.max(...vals));
  const cols=months.map((m,i)=>{const h=vals[i]/mx*100,sel=m===k;
    return `<div class="tcol ${sel?'sel':''}" tabindex="0" data-rm="${m}" data-tip="${esc(cat(c).name)} · ${esc(ymLabel(m))}|${eur(vals[i])}">${sel||i===iMax?`<div class="tv" style="bottom:calc(${h}% + 4px)">${Math.round(vals[i])}€</div>`:''}<div class="tb" style="height:${h}%"></div></div>`}).join('');
  const prev=vals[10],cur=vals[11];
  const diff=prev>0?`${cur>=prev?'▲ +':'▼ −'}${eur(Math.abs(cur-prev))}`:'';
  return `<h3 class="sec">📈 Evolução por categoria (12 meses)</h3>
  <div class="card">
    <select class="chip" id="evoCat" aria-label="Categoria" style="margin-bottom:6px">${cats.map(id=>`<option value="${id}" ${id===c?'selected':''}>${esc(cat(id).icon+' '+cat(id).name)} · ${eur(tot[id])}</option>`).join('')}</select>
    <div class="trend trend12">${cols}</div>
    <div class="tlabels trend12">${months.map(m=>`<span class="${m===k?'sel':''}">${MAB[+m.slice(5)-1].slice(0,1).toUpperCase()}${MAB[+m.slice(5)-1].slice(1,3)}</span>`).join('')}</div>
    <div class="hist" style="border:0;margin-top:8px;padding:0">
      <div><span>Média nos meses com gastos</span><b>${eur(avg)}</b></div>
      <div><span>Mês mais alto</span><b>${esc(ymLabel(months[iMax]))} · ${eur(vals[iMax])}</b></div>
      <div><span>Total em 12 meses</span><b>${eur(tot[c])}</b></div>
      ${diff?`<div><span>${esc(ymLabel(k))} vs mês anterior</span><b>${diff}</b></div>`:''}
    </div>
  </div>`;
}

function vDefinicoes(){
  const me=S.viewer,o=other(me),partner=S.users[o];
  return `<h2 class="page">Definições</h2>
  <h3 class="sec" style="margin-top:4px">A tua conta</h3>
  <div class="card">
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px">${avatar(me,64)}
      <div style="display:flex;gap:8px;flex-wrap:wrap"><label class="btn ghost small" style="cursor:pointer">📷 ${S.users[me]&&S.users[me].avatar?'Mudar foto':'Pôr foto de perfil'}<input type="file" accept="image/*" id="avIn" style="display:none"></label>${S.users[me]&&S.users[me].avatar?'<button class="btn small ghost" id="avRm">Remover</button>':''}</div></div>
    <div class="field"><label for="myName">O teu nome</label><input class="inp" id="myName" value="${esc(nm(me))}" maxlength="40"></div>
    <p class="muted" style="font-size:13px;margin:0 0 10px">Sessão iniciada como ${esc(S.email||'')}</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary small" id="saveName">Guardar nome</button><button class="btn ghost small" id="logout">Terminar sessão</button></div>
  </div>
  <h3 class="sec">O casal</h3>
  <div class="card">
    ${partner?`<div style="display:flex;align-items:center;gap:10px"><div class="pair" style="margin:0">${avatar(me,36)}${avatar(o,36)}</div><p style="margin:0">${esc(nm(me))} e ${esc(partner.name)} partilham este cofre.</p></div>`:`<p style="margin:0 0 8px">Ainda falta a outra pessoa. Envia-lhe este código:</p>
    <div style="display:flex;gap:10px;align-items:center"><b style="font-size:26px;letter-spacing:.12em">${esc(S.household.invite_code)}</b><button class="btn small ghost" id="copyCode">Copiar</button></div>
    <p class="muted" style="font-size:12.5px;margin:8px 0 0">A outra pessoa abre a app, cria conta e escolhe “Entrar com código”.</p>`}
  </div>
  <h3 class="sec">🔔 Notificações</h3>
  <div class="card" id="pushBox"><p class="muted" style="margin:0">A verificar…</p></div>
  <h3 class="sec">Categorias</h3>
  <div class="list" id="cats">${S.categories.map(c=>`<div class="catrow"><input class="inp emo" data-ci="${c.id}" value="${esc(c.icon)}" aria-label="Ícone"><input class="inp" data-cn="${c.id}" value="${esc(c.name)}" aria-label="Nome">${c.id==='outros'?'<span style="width:34px"></span>':`<button class="btn small danger" data-cd="${c.id}" aria-label="Apagar">✕</button>`}</div>`).join('')}
    <div class="catrow"><input class="inp emo" id="newIcon" value="🏷️" aria-label="Ícone"><input class="inp" id="newCat" placeholder="Nova categoria" aria-label="Nova categoria"><button class="btn small primary" id="addCat">+</button></div>
  </div>
  <button class="btn ghost small mt" id="saveCats">Guardar categorias</button>
  <h3 class="sec">⭐ Despesas frequentes</h3>
  <div class="list">${S.templates.filter(t=>t.scope==='partilhada'||t.owner===S.viewer).map(t=>`<div class="catrow"><span style="font-size:18px">${esc(cat(t.cat).icon)}</span><span style="flex:1">${esc(t.desc)}${t.amount?` · ${eur(t.amount)}`:''} <span class="badge ${t.scope==='partilhada'?'b-scope':'b-pers'}">${t.scope==='partilhada'?'👥 Casal':'🔒 Pessoal'}</span></span><button class="btn small danger" data-td="${t.id}" aria-label="Remover">✕</button></div>`).join('')||'<div class="empty">Ainda não tens frequentes. Ao guardar uma despesa, marca “⭐ Guardar como frequente”.</div>'}</div>
  <h3 class="sec">Aparência</h3>
  <div class="card"><div class="lab" style="font-size:12.5px;font-weight:600;color:var(--ink2);margin-bottom:6px">Tema</div>
    <div class="seg" id="themeSeg">${[['auto','📱 Automático'],['light','☀️ Claro'],['dark','🌙 Escuro']].map(([v,l])=>`<label><input type="radio" name="theme" value="${v}" ${(PREF.theme||'auto')===v?'checked':''}><span>${l}</span></label>`).join('')}</div>
    <p class="muted" style="font-size:12.5px;margin:8px 0 0">Automático segue o modo claro/escuro do telemóvel.</p></div>
`;
}

/* ---------- ganhos (rendimentos) ---------- */
function genIncome(st=S){
  const cur=ym(TODAY);
  for(const s of st.incomeSources){
    if(!s.active)continue;
    for(let m=s.startMonth;m<=cur;m=ymAdd(m,1)){
      if(s.skip.includes(m)||st.incomeEntries.some(e=>e.sourceId===s.id&&e.month===m))continue;
      st.incomeEntries.push({id:`inc_${s.id}_${m}`,owner:s.owner,sourceId:s.id,month:m,type:s.type,desc:s.name,qty:0,unitPrice:s.unitPrice,amount:s.type==='fixed'?s.amount:0,received:false});
    }
  }
}
const incAmt=e=>e.type==='unit'?r2(e.qty*e.unitPrice):e.amount;
const incomeOf=k=>S.incomeEntries.filter(e=>e.owner===S.viewer&&e.month===k);
const incomeTotal=k=>incomeOf(k).reduce((a,e)=>a+incAmt(e),0);
const spentTotal=k=>S.expenses.filter(e=>ym(e.date)===k&&(e.scope==='partilhada'||e.owner===S.viewer)).reduce((a,e)=>a+myPart(e),0);
const unitLbl=(e)=>{const s=S.incomeSources.find(s=>s.id===e.sourceId);return (s&&s.unitLabel)||'unidades'};
const incIcon=e=>e.type==='unit'?'🩺':e.type==='once'?'✨':'💼';

function balanceCard(k,title){
  const inc=incomeTotal(k),sp=spentTotal(k),left=inc-sp;
  const spP=S.expenses.filter(e=>ym(e.date)===k&&e.scope==='pessoal'&&e.owner===S.viewer).reduce((a,e)=>a+e.amount,0);
  const rate=inc>0?Math.round(left/inc*100):null;
  return `<div class="card balance">
    <div class="lbl">${title}</div>
    <div class="big">${left>=0?'Sobram ':'Faltam '}${eur(Math.abs(left))}</div>
    <div class="hist" style="margin-top:0;border-top:0;padding-top:0">
      <div><span>💰 Ganhos</span><b>${eur(inc)}</b></div>
      <div><span>🔒 Gastos pessoais</span><b>− ${eur(spP)}</b></div>
      <div><span>👥 A tua parte no casal</span><b>− ${eur(sp-spP)}</b></div>
      <div style="border-top:1px solid var(--line);margin-top:4px;padding-top:6px;color:var(--ink)"><span><b>${left>=0?'Fica para poupar':'Diferença'}</b></span><b>${left<0?'− ':''}${eur(Math.abs(left))}${rate!==null&&left>=0?` · ${rate}%`:''}</b></div>
    </div>
  </div>`;
}

function vGanhos(){
  const k=UI.gmonth;const list=incomeOf(k).sort((a,b)=>({fixed:0,unit:1,once:2}[a.type]-{fixed:0,unit:1,once:2}[b.type]));
  const tot=list.reduce((a,e)=>a+incAmt(e),0),rec=list.filter(e=>e.received).reduce((a,e)=>a+incAmt(e),0);
  const rows=list.map(e=>{
    const sub=e.type==='unit'?`${e.qty} ${esc(unitLbl(e))} × ${eur(e.unitPrice)}`:e.type==='once'?'Pontual (só este mês)':'Fixo mensal';
    const step=e.type==='unit'?`<div class="stepper"><button class="btn small" data-qm="${e.id}" aria-label="Menos uma">−</button><b>${e.qty}</b><button class="btn small" data-qp="${e.id}" aria-label="Mais uma">+</button></div>`:'';
    const badge=e.received?`<span class="badge b-paid">✓ Recebido</span>`:`<button class="badge b-due" data-rcv="${e.id}" style="border:0;cursor:pointer">⏳ Por receber · marcar</button>`;
    return `<div class="row" tabindex="0" data-inc="${e.id}">
      <div class="ico">${incIcon(e)}</div>
      <div class="mid"><div class="t">${esc(e.desc)}</div><div class="s">${sub}</div><div>${badge}</div></div>
      <div class="r"><div class="amt">${eur(incAmt(e))}</div>${step}</div></div>`}).join('');
  const srcs=S.incomeSources.filter(s=>s.owner===S.viewer).map(s=>`<div class="row" tabindex="0" data-src="${s.id}" style="${s.active?'':'opacity:.6'}">
      <div class="ico">${s.type==='unit'?'🩺':'💼'}</div>
      <div class="mid"><div class="t">${esc(s.name)}</div><div class="s">${s.type==='unit'?`${eur(s.unitPrice)} por ${esc(s.unitLabel.replace(/s$/,'')||'unidade')}`:`${eur(s.amount)} por mês`}${s.active?'':' · em pausa'}</div></div>
      <div class="r muted">›</div></div>`).join('');
  const future=k>ym(TODAY);
  return `<h2 class="page">Ganhos</h2>
  <div class="monthnav"><button data-gm="-1" aria-label="Mês anterior">‹</button><b>${ymLabel(k)}</b><button data-gm="1" aria-label="Mês seguinte">›</button></div>
  <div class="grid2" style="margin-top:0">
    <div class="card stat"><div class="lbl">Ganhos do mês</div><div class="val">${eur(tot)}</div><div class="sub">recebido ${eur(rec)}</div></div>
    <div class="card stat"><div class="lbl">Por receber</div><div class="val">${eur(tot-rec)}</div><div class="sub">${list.filter(e=>!e.received).length} por confirmar</div></div>
  </div>
  <div class="cols"><div>
  <h3 class="sec">Este mês</h3>
  <div class="list">${rows||`<div class="empty">${future?'Os meses futuros aparecem quando chegarem.':'Sem ganhos registados neste mês.'}</div>`}</div>
  <p class="muted" style="font-size:12.5px;margin:8px 2px">Usa os botões − / + para contar as consultas à medida que as fazes. Toca numa linha para editar só esse mês.</p>
  </div><div>
  <div class="mt cols-top0">${balanceCard(k,`Balanço de ${MESES[+k.slice(5)-1]}`)}</div>
  <h3 class="sec">Fontes de rendimento</h3>
  <div class="list">${srcs||'<div class="empty">Ainda não tens fontes. Toca em + para adicionar.</div>'}</div></div></div>`;
}

function incomeChooser(){
  openSheet(`<h3>Adicionar ganho</h3>
  <div class="list">
    <button class="row" data-new="fixed"><div class="ico">💼</div><div class="mid"><div class="t">Fonte fixa mensal</div><div class="s">Ex.: 1000 € da Empresa X todos os meses</div></div></button>
    <button class="row" data-new="unit"><div class="ico">🩺</div><div class="mid"><div class="t">Por unidade</div><div class="s">Ex.: consultas a 40 € cada; contas quantas fazes por mês</div></div></button>
    <button class="row" data-new="once"><div class="ico">✨</div><div class="mid"><div class="t">Rendimento pontual</div><div class="s">Só neste mês. Ex.: um workshop, um prémio</div></div></button>
  </div>
  <div class="actions"><button class="btn" data-x>Cancelar</button></div>`,s=>{
    s.querySelector('[data-x]').onclick=closeSheet;
    s.querySelectorAll('[data-new]').forEach(b=>b.onclick=()=>b.dataset.new==='once'?onceForm():sourceForm(null,b.dataset.new));
  });
}
const NET_HINT='<p class="muted" style="font-size:12.5px;margin:-4px 0 10px">Indica o valor <b>líquido</b>, o que recebes de facto (depois de impostos e retenções).</p>';
function sourceForm(id,type){
  const ex=id?S.incomeSources.find(s=>s.id===id):null;
  const x=ex?{...ex}:{name:'',type,amount:'',unitPrice:'',unitLabel:'consultas',startMonth:ym(TODAY)};
  const v=n=>n===''||n===0?'':String(n).replace('.',',');
  openSheet(`<h3>${ex?'Editar fonte':x.type==='unit'?'Nova fonte por unidade':'Nova fonte fixa'}</h3>
  <form novalidate>
    <div class="field"><label for="sn">Nome</label><input class="inp" id="sn" name="name" value="${esc(x.name)}" placeholder="Ex.: Empresa X, Consultas" maxlength="40"></div>
    <div class="field"><div class="lab">Tipo</div>${seg('stype2',[['fixed','💼 Fixo mensal'],['unit','🩺 Por unidade']],x.type)}</div>
    <div id="fxBox"><div class="field"><label for="am">Valor por mês (€)</label><input class="inp" id="am" name="amount" inputmode="decimal" value="${v(x.amount)}" placeholder="1000,00"></div></div>
    <div id="unBox"><div class="row2"><div class="field"><label for="up">Preço por unidade (€)</label><input class="inp" id="up" name="unitPrice" inputmode="decimal" value="${v(x.unitPrice)}" placeholder="40,00"></div>
      <div class="field"><label for="ul">Unidade</label><input class="inp" id="ul" name="unitLabel" value="${esc(x.unitLabel||'consultas')}" placeholder="consultas" maxlength="20"></div></div></div>
    ${NET_HINT}
    ${ex?'<p class="muted" style="font-size:12.5px">As alterações (incluindo mudar o tipo) aplicam-se ao mês atual, se ainda não estiver recebido, e aos seguintes. Os meses anteriores mantêm-se como estavam.</p>':''}
    <div class="err" id="err"></div>
    ${ex?`<div class="actions" style="margin-top:8px"><button type="button" class="btn" id="pause">${ex.active?'⏸ Pausar':'▶ Retomar'}</button><button type="button" class="btn danger" id="del">Apagar</button></div>`:''}
    <div class="actions"><button type="button" class="btn" data-x>Cancelar</button><button class="btn primary" type="submit">Guardar</button></div>
  </form>`,s=>{
    const f=s.querySelector('form');
    const tog=()=>{const t=new FormData(f).get('stype2');s.querySelector('#fxBox').classList.toggle('hidden',t!=='fixed');s.querySelector('#unBox').classList.toggle('hidden',t!=='unit')};
    f.addEventListener('change',tog);tog();
    s.querySelector('[data-x]').onclick=closeSheet;
    const cur=ym(TODAY);
    const dropCurrentUnreceived=src=>{S.incomeEntries=S.incomeEntries.filter(e=>!(e.sourceId===src.id&&e.month>=cur&&!e.received&&(e.type!=='unit'||e.qty===0)))};
    if(ex){
      s.querySelector('#pause').onclick=()=>{if(ex.active){ex.active=false;dropCurrentUnreceived(ex);closeSheet();commit('Fonte em pausa')}else{ex.active=true;ex.startMonth=cur;closeSheet();commit('Fonte retomada')}};
      s.querySelector('#del').onclick=()=>confirmSheet('Apagar fonte?','Os meses já recebidos ficam no histórico.','Apagar',()=>{dropCurrentUnreceived(ex);S.incomeEntries.forEach(e=>{if(e.sourceId===ex.id)e.sourceId=null});S.incomeSources=S.incomeSources.filter(z=>z.id!==ex.id);commit('Fonte apagada')});
    }
    f.onsubmit=ev=>{
      ev.preventDefault();const fd=new FormData(f);const err=s.querySelector('#err');
      const name=fd.get('name').trim();if(!name)return err.textContent='Escreve um nome.';
      const t=fd.get('stype2');let amount=0,unitPrice=0,unitLabel='';
      if(t==='unit'){unitPrice=r2(num(fd.get('unitPrice')));unitLabel=(fd.get('unitLabel')||'').trim()||'unidades';if(!(unitPrice>0))return err.textContent='Indica um preço maior que zero.'}
      else{amount=r2(num(fd.get('amount')));if(!(amount>0))return err.textContent='Indica um valor maior que zero.'}
      if(ex){
        const changed=t!==ex.type;
        Object.assign(ex,{name,type:t,amount,unitPrice,unitLabel});
        for(const e of S.incomeEntries)if(e.sourceId===ex.id&&e.month>=cur&&!e.received){
          e.desc=name;
          if(changed){e.type=t;if(t==='unit'){e.qty=0;e.unitPrice=unitPrice;e.amount=0}else{e.amount=amount;e.qty=0}}
          else if(t==='unit')e.unitPrice=unitPrice;else e.amount=amount;
        }
        closeSheet();commit(changed?`Fonte mudada para ${t==='unit'?'por unidade':'fixo mensal'}`:'Fonte atualizada');
      }else{
        S.incomeSources.push({id:uid(),owner:S.viewer,name,type:t,amount,unitPrice,unitLabel,startMonth:cur,active:true,skip:[]});
        UI.gmonth=cur;closeSheet();commit('Fonte adicionada');
      }
    };
  });
}
function onceForm(){
  openSheet(`<h3>Rendimento pontual</h3>
  <form novalidate>
    <div class="field"><label for="od">Descrição</label><input class="inp" id="od" name="desc" placeholder="Ex.: Workshop" maxlength="40"></div>
    <div class="row2"><div class="field"><label for="oa">Valor (€)</label><input class="inp" id="oa" name="amount" inputmode="decimal" placeholder="0,00"></div>
      <div class="field"><label for="om">Mês</label><input class="inp" type="month" id="om" name="month" value="${UI.gmonth}"></div></div>
    ${NET_HINT}
    <div class="field"><div class="lab">Estado</div>${seg('received',[['1','✓ Recebido'],['0','⏳ Por receber']],'1')}</div>
    <div class="err" id="err"></div>
    <div class="actions"><button type="button" class="btn" data-x>Cancelar</button><button class="btn primary" type="submit">Guardar</button></div>
  </form>`,s=>{
    s.querySelector('[data-x]').onclick=closeSheet;
    s.querySelector('form').onsubmit=ev=>{ev.preventDefault();const fd=new FormData(ev.target);const err=s.querySelector('#err');
      const desc=fd.get('desc').trim(),amount=r2(num(fd.get('amount'))),month=fd.get('month')||UI.gmonth;
      if(!desc)return err.textContent='Escreve uma descrição.';if(!(amount>0))return err.textContent='Indica um valor maior que zero.';
      S.incomeEntries.push({id:uid(),owner:S.viewer,sourceId:null,month,type:'once',desc,qty:0,unitPrice:0,amount,received:fd.get('received')==='1'});
      UI.gmonth=month;closeSheet();commit('Rendimento adicionado')};
  });
}
function entryForm(id){
  const e=S.incomeEntries.find(z=>z.id===id);const isU=e.type==='unit';
  openSheet(`<h3>${esc(e.desc)} · ${ymLabel(e.month)}</h3>
  <form novalidate>
    ${isU?`<div class="row2"><div class="field"><label for="eq">N.º de ${esc(unitLbl(e))}</label><input class="inp" id="eq" name="qty" inputmode="numeric" value="${e.qty}"></div>
      <div class="field"><label for="ep">Preço (€)</label><input class="inp" id="ep" name="unitPrice" inputmode="decimal" value="${String(e.unitPrice).replace('.',',')}"></div></div>
      <div class="preview" id="prev"></div>`
    :`<div class="field"><label for="ea">Valor deste mês (€)</label><input class="inp" id="ea" name="amount" inputmode="decimal" value="${String(e.amount).replace('.',',')}"></div>
      ${e.type==='fixed'?'<p class="muted" style="font-size:12.5px;margin:-4px 0 10px">Muda só este mês (ex.: subsídio de Natal, prémio). Para mudar todos os meses, edita a fonte.</p>':''}`}
    <div class="field mt"><div class="lab">Estado</div>${seg('received',[['1','✓ Recebido'],['0','⏳ Por receber']],e.received?'1':'0')}</div>
    <div class="err" id="err"></div>
    <div class="actions"><button type="button" class="btn danger" id="del">Apagar</button><button class="btn primary" type="submit">Guardar</button></div>
  </form>`,s=>{
    const f=s.querySelector('form');
    if(isU){const up=()=>{const q=num(f.qty.value),p=num(f.unitPrice.value);s.querySelector('#prev').textContent=isNaN(q)||isNaN(p)?'—':`${q} × ${eur(p)} = ${eur(r2(q*p))}`};f.addEventListener('input',up);up()}
    s.querySelector('#del').onclick=()=>confirmSheet('Apagar este registo?',`${e.desc} em ${ymLabel(e.month)}.`,'Apagar',()=>{const src=S.incomeSources.find(z=>z.id===e.sourceId);if(src&&!src.skip.includes(e.month))src.skip.push(e.month);S.incomeEntries=S.incomeEntries.filter(z=>z.id!==e.id);commit('Registo apagado')});
    f.onsubmit=ev=>{ev.preventDefault();const fd=new FormData(f);const err=s.querySelector('#err');
      if(isU){const q=num(fd.get('qty')),p=r2(num(fd.get('unitPrice')));if(!(q>=0)||q%1)return err.textContent='O número tem de ser inteiro (0 ou mais).';if(!(p>=0))return err.textContent='Preço inválido.';e.qty=q;e.unitPrice=p}
      else{const a=r2(num(fd.get('amount')));if(!(a>=0))return err.textContent='Valor inválido.';e.amount=a}
      e.received=fd.get('received')==='1';closeSheet();commit('Guardado')};
  });
}

/* ---------- fotos (Supabase Storage, bucket privado "photos") ---------- */
// caminho: <household>/shared/<id>.jpg  (casal)  ou  <household>/<u1|u2>/<id>.jpg  (pessoal)
const photoPath=scope=>`${S.household.id}/${scope==='partilhada'?'shared':S.viewer}/${uid()}.jpg`;
const PH={urls:new Map(),
  bucket(){return Cloud.sb.storage.from('photos')},
  async put(path,blob){const{error}=await this.bucket().upload(path,blob,{contentType:'image/jpeg',upsert:false});if(error)throw error},
  async del(path){this.urls.delete(path);try{await this.bucket().remove([path])}catch(e){}},
  async url(path){const c=this.urls.get(path);if(c&&c.exp>Date.now())return c.u;const{data,error}=await this.bucket().createSignedUrl(path,3600);if(error||!data)return null;this.urls.set(path,{u:data.signedUrl,exp:Date.now()+50*60000});return data.signedUrl},
  async move(path,scope){const np=photoPath(scope);const{error}=await this.bucket().copy(path,np);if(error)throw error;await this.del(path);return np}
};
/* ---------- fotos de perfil ---------- */
const avPending=new Set();
function avatar(slot,size=28){
  const u=S.users[slot],p=u&&u.avatar,c=p&&PH.urls.get(p),url=c&&c.exp>Date.now()?c.u:null;
  if(p&&!url&&!avPending.has(p)){avPending.add(p);PH.url(p).then(x=>{if(x)render()}).finally(()=>avPending.delete(p))}
  return `<span class="av ${slot}" style="width:${size}px;height:${size}px;font-size:${Math.round(size*.45)}px">${url?`<img src="${esc(url)}" alt="">`:esc(nm(slot).charAt(0).toUpperCase())}</span>`;
}
async function cropSquare(file,size=512,q=0.85){
  const src=URL.createObjectURL(file);
  try{
    const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error('img'));i.src=src});
    const m=Math.min(img.naturalWidth,img.naturalHeight),out=Math.min(size,m);
    const c=document.createElement('canvas');c.width=c.height=out;
    c.getContext('2d').drawImage(img,(img.naturalWidth-m)/2,(img.naturalHeight-m)/2,m,m,0,0,out,out);
    return await new Promise((res,rej)=>c.toBlob(b=>b?res(b):rej(new Error('blob')),'image/jpeg',q));
  }finally{URL.revokeObjectURL(src)}
}
async function compressImage(file,max=1600,q=0.72){
  const src=URL.createObjectURL(file);
  try{
    const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error('img'));i.src=src});
    const k=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
    const c=document.createElement('canvas');c.width=Math.round(img.naturalWidth*k);c.height=Math.round(img.naturalHeight*k);
    c.getContext('2d').drawImage(img,0,0,c.width,c.height);
    return await new Promise((res,rej)=>c.toBlob(b=>b?res(b):rej(new Error('blob')),'image/jpeg',q));
  }finally{URL.revokeObjectURL(src)}
}
async function fillThumbs(root){for(const el of root.querySelectorAll('[data-ph]')){const u=await PH.url(el.dataset.ph);const im=el.querySelector('img');if(u&&im)im.src=u;else if(im)im.alt='Foto indisponível'}}
async function viewPhotos(ids,start=0){
  let i=start;const ov=$('#pv');
  const show=async()=>{const u=await PH.url(ids[i]);$('#pvImg').src=u||'';$('#pvN').textContent=ids.length>1?`${i+1} / ${ids.length}`:'';$('#pvPrev').classList.toggle('hidden',ids.length<2);$('#pvNext').classList.toggle('hidden',ids.length<2)};
  $('#pvPrev').onclick=()=>{i=(i-1+ids.length)%ids.length;show()};$('#pvNext').onclick=()=>{i=(i+1)%ids.length;show()};
  ov.classList.add('open');await show();
}
$('#pvClose').onclick=()=>$('#pv').classList.remove('open');
$('#pv').addEventListener('click',e=>{if(e.target.id==='pv')$('#pv').classList.remove('open')});

/* ---------- orçamentos ---------- */
const budgetsFor=(scope,owner)=>S.budgets.filter(b=>b.scope===scope&&(scope==='partilhada'||b.owner===owner));
const spaceBudgets=()=>budgetsFor(isCasal()?'partilhada':'pessoal',S.viewer);
function budgetSpent(b,k){return S.expenses.filter(e=>e.cat===b.cat&&ym(e.date)===k&&e.scope===b.scope&&(b.scope==='partilhada'||e.owner===b.owner)).reduce((a,e)=>a+e.amount,0)}
function budgetState(p){return p>100?{cls:'crit',lbl:'⛔ Ultrapassado'}:p>=80?{cls:'warn',lbl:'⚠ Perto do limite'}:{cls:'ok',lbl:''}}
function budgetRow(b,k){
  const sp=budgetSpent(b,k),p=b.limit?Math.round(sp/b.limit*100):0,st=budgetState(p),c=cat(b.cat);
  const left=b.limit-sp;
  return `<div class="bud" data-tip="${esc(c.name)}|${eur(sp)} de ${eur(b.limit)} · ${p}%">
    <div class="bud-h"><span>${esc(c.icon)} ${esc(c.name)}</span><span><b>${eur(sp)}</b> <span class="muted">/ ${eur(b.limit)}</span></span></div>
    <div class="bud-track"><div class="bud-fill ${st.cls}" style="width:${Math.min(100,p)}%"></div></div>
    <div class="bud-f"><span class="${st.cls==='ok'?'muted':'st-'+st.cls}">${st.lbl||`${p}% usado`}</span><span class="muted">${left>=0?`restam ${eur(left)}`:`passou ${eur(-left)}`}</span></div>
  </div>`;
}
function budgetsBlock(k,title){
  const bs=spaceBudgets();
  return `<h3 class="sec" style="display:flex;justify-content:space-between;align-items:center">${title}<button class="btn small ghost" id="mgBud" style="text-transform:none;letter-spacing:0">Gerir</button></h3>
  <div class="card">${bs.length?bs.map(b=>budgetRow(b,k)).join(''):'<div class="empty" style="padding:8px">Sem orçamentos. Toca em “Gerir” para definir um limite mensal por categoria.</div>'}
  ${!isCasal()&&bs.length?'<p class="muted" style="font-size:12px;margin:6px 0 0">Conta só as despesas pessoais (não inclui a tua parte do casal).</p>':''}</div>`;
}
function budgetAlerts(k){
  const al=spaceBudgets().map(b=>({b,p:b.limit?budgetSpent(b,k)/b.limit*100:0})).filter(x=>x.p>=80).sort((a,b)=>b.p-a.p);
  if(!al.length)return '';
  return `<div class="card mt alert-card">${al.map(({b,p})=>{const st=budgetState(p);return `<div class="hist" style="border:0;margin:0;padding:2px 0"><div><span class="st-${st.cls}">${st.lbl.split(' ')[0]} ${esc(cat(b.cat).name)}</span><b>${Math.round(p)}% do orçamento</b></div></div>`}).join('')}</div>`;
}
function budgetToast(e){
  const b=budgetsFor(e.scope,e.owner).find(b=>b.cat===e.cat);if(!b)return '';
  const p=budgetSpent(b,ym(e.date))/b.limit*100;
  if(p>100)return ` · ⛔ ${cat(b.cat).name}: orçamento ultrapassado`;
  if(p>=80)return ` · ⚠ ${cat(b.cat).name}: ${Math.round(p)}% do orçamento`;
  return '';
}
function budgetForm(){
  const scope=isCasal()?'partilhada':'pessoal';const bs=budgetsFor(scope,S.viewer);
  openSheet(`<h3>Orçamentos mensais <span class="badge ${scope==='partilhada'?'b-scope':'b-pers'}" style="vertical-align:middle">${scope==='partilhada'?'👥 Casal':'🔒 Pessoal'}</span></h3>
  <p class="muted" style="font-size:13px;margin:-4px 0 12px">Define um limite por mês para as categorias que queres controlar. Deixa em branco para não ter limite.</p>
  <form novalidate><div class="list">${S.categories.map(c=>{const b=bs.find(b=>b.cat===c.id);return `<div class="catrow"><span style="flex:1">${esc(c.icon)} ${esc(c.name)}</span><input class="inp" style="width:120px;text-align:right" name="b_${c.id}" inputmode="decimal" placeholder="sem limite" value="${b?String(b.limit).replace('.',','):''}"><span class="muted">€</span></div>`}).join('')}</div>
  <div class="err" id="err"></div>
  <div class="actions"><button type="button" class="btn" data-x>Cancelar</button><button class="btn primary" type="submit">Guardar</button></div></form>`,s=>{
    s.querySelector('[data-x]').onclick=closeSheet;
    s.querySelector('form').onsubmit=ev=>{ev.preventDefault();const fd=new FormData(ev.target);const nb=[];
      for(const c of S.categories){const raw=(fd.get('b_'+c.id)||'').trim();if(!raw)continue;const v=r2(num(raw));if(!(v>0))return s.querySelector('#err').textContent=`Valor inválido em ${c.name}.`;nb.push({id:uid(),scope,owner:S.viewer,cat:c.id,limit:v})}
      S.budgets=S.budgets.filter(b=>!(b.scope===scope&&(scope==='partilhada'||b.owner===S.viewer))).concat(nb);
      closeSheet();commit('Orçamentos guardados')};
  });
}

/* ---------- objetivos de poupança ---------- */
const goalsInSpace=()=>S.goals.filter(g=>isCasal()?g.scope==='partilhada':(g.scope==='pessoal'&&g.owner===S.viewer));
const goalSaved=g=>r2(g.contributions.reduce((a,c)=>a+c.amount,0));
function monthsLeft(deadline){if(!deadline)return null;const[a,b]=ym(TODAY).split('-').map(Number);const[c,d]=deadline.split('-').map(Number);return (c*12+d)-(a*12+b)+1}
function goalCard(g){
  const sv=goalSaved(g),p=g.target?Math.min(100,Math.round(sv/g.target*100)):0,left=r2(g.target-sv);
  const ml=monthsLeft(g.deadline);
  let plan='';
  if(left<=0)plan='🎉 Objetivo atingido!';
  else if(ml!==null)plan=ml>0?`Faltam ${eur(left)} · ≈ ${eur(left/ml)}/mês até ${MAB[+g.deadline.slice(5)-1]} ${g.deadline.slice(0,4)}`:`Faltam ${eur(left)} · prazo ultrapassado`;
  else plan=`Faltam ${eur(left)}`;
  const per=g.scope==='partilhada'?`<div class="s" style="margin-top:4px">${['u1','u2'].map(u=>`${esc(nm(u))} ${eur(g.contributions.filter(c=>c.who===u).reduce((a,c)=>a+c.amount,0))}`).join(' · ')}</div>`:'';
  return `<div class="goal" tabindex="0" data-goal="${g.id}">
    <div class="goal-h"><span class="ico">${esc(g.icon||'🎯')}</span><div style="flex:1;min-width:0"><div class="t">${esc(g.name)}</div><div class="s">${eur(sv)} de ${eur(g.target)}</div></div><b class="goal-p">${p}%</b></div>
    <div class="bud-track"><div class="bud-fill ok" style="width:${p}%"></div></div>
    <div class="s" style="margin-top:6px">${plan}</div>${per}
  </div>`;
}
function goalsBlock(){
  const gs=goalsInSpace();
  return `<h3 class="sec" style="display:flex;justify-content:space-between;align-items:center">🎯 Objetivos de poupança<button class="btn small ghost" id="newGoal" style="text-transform:none;letter-spacing:0">+ Novo</button></h3>
  <div class="goals">${gs.length?gs.map(goalCard).join(''):`<div class="card empty">Ainda sem objetivos. Ex.: ${isCasal()?'uma viagem, entrada para casa':'fundo de emergência, um computador novo'}.</div>`}</div>`;
}
function goalForm(id){
  const ex=id?S.goals.find(g=>g.id===id):null;const scope=ex?ex.scope:(isCasal()?'partilhada':'pessoal');
  const x=ex||{name:'',icon:'🎯',target:'',deadline:''};
  openSheet(`<h3>${ex?'Editar objetivo':'Novo objetivo'} <span class="badge ${scope==='partilhada'?'b-scope':'b-pers'}" style="vertical-align:middle">${scope==='partilhada'?'👥 Casal':'🔒 Pessoal'}</span></h3>
  <form novalidate>
    <div class="row2" style="grid-template-columns:70px 1fr"><div class="field"><label for="gi">Ícone</label><input class="inp" id="gi" name="icon" value="${esc(x.icon)}" style="text-align:center" maxlength="4"></div>
      <div class="field"><label for="gn">Nome</label><input class="inp" id="gn" name="name" value="${esc(x.name)}" placeholder="Ex.: Viagem ao Japão" maxlength="40"></div></div>
    <div class="row2"><div class="field"><label for="gt">Valor a juntar (€)</label><input class="inp" id="gt" name="target" inputmode="decimal" value="${x.target===''?'':String(x.target).replace('.',',')}" placeholder="3000"></div>
      <div class="field"><label for="gd">Prazo (opcional)</label><input class="inp" type="month" id="gd" name="deadline" value="${x.deadline||''}"></div></div>
    <p class="muted" style="font-size:12.5px;margin:-4px 0 10px">Com prazo, a app calcula quanto têm de pôr de lado por mês.</p>
    <div class="err" id="err"></div>
    <div class="actions">${ex?'<button type="button" class="btn danger" id="del">Apagar</button>':'<button type="button" class="btn" data-x>Cancelar</button>'}<button class="btn primary" type="submit">Guardar</button></div>
  </form>`,s=>{
    const x1=s.querySelector('[data-x]');x1&&(x1.onclick=closeSheet);
    ex&&(s.querySelector('#del').onclick=()=>confirmSheet('Apagar objetivo?',`"${ex.name}" e o histórico de ${eur(goalSaved(ex))} vão ser apagados. O dinheiro em si não é afetado.`,'Apagar',()=>{S.goals=S.goals.filter(g=>g.id!==ex.id);commit('Objetivo apagado')}));
    s.querySelector('form').onsubmit=ev=>{ev.preventDefault();const fd=new FormData(ev.target);const err=s.querySelector('#err');
      const name=fd.get('name').trim(),target=r2(num(fd.get('target')));
      if(!name)return err.textContent='Escreve um nome.';if(!(target>0))return err.textContent='Indica um valor maior que zero.';
      const data={name,icon:fd.get('icon').trim()||'🎯',target,deadline:fd.get('deadline')||null};
      if(ex)Object.assign(ex,data);else S.goals.push({id:uid(),scope,owner:S.viewer,contributions:[],...data});
      closeSheet();commit(ex?'Objetivo atualizado':'Objetivo criado')};
  });
}
function goalSheet(id){
  const g=S.goals.find(z=>z.id===id);const sv=goalSaved(g);
  const hist=[...g.contributions].sort((a,b)=>b.date.localeCompare(a.date));
  openSheet(`<h3>${esc(g.icon)} ${esc(g.name)}</h3>
  ${goalCard(g).replace('data-goal=','data-x-goal=')}
  <form novalidate class="mt">
    <div class="field"><div class="lab">Movimento</div>${seg('kind',[['in','➕ Pôr de lado'],['out','➖ Retirar']],'in')}</div>
    <div class="row2"><div class="field"><label for="ca">Valor (€)</label><input class="inp" id="ca" name="amount" inputmode="decimal" placeholder="0,00"></div>
      <div class="field"><label for="cd">Data</label><input class="inp" type="date" id="cd" name="date" value="${TODAY}"></div></div>
    ${g.scope==='partilhada'?`<div class="field"><div class="lab">Quem</div>${seg('who',[['u1',esc(nm('u1'))],['u2',esc(nm('u2'))]],S.viewer)}</div>`:''}
    <div class="field"><label for="cn">Nota (opcional)</label><input class="inp" id="cn" name="note" maxlength="40" placeholder="Ex.: transferência para a poupança"></div>
    <div class="err" id="err"></div>
    <div class="actions" style="margin-top:4px"><button type="button" class="btn" id="edit">✏️ Editar</button><button class="btn primary" type="submit">Registar</button></div>
  </form>
  ${hist.length?`<div class="hist"><div class="muted" style="font-size:12px">Histórico</div>${hist.map(c=>`<div><span>${fShort(c.date)}${g.scope==='partilhada'?' · '+esc(nm(c.who)):''}${c.note?' · '+esc(c.note):''}</span><span><b>${c.amount<0?'− ':''}${eur(Math.abs(c.amount))}</b> <button class="btn small" data-delc="${c.id}" aria-label="Apagar movimento" style="padding:2px 8px">✕</button></span></div>`).join('')}</div>`:''}`,s=>{
    s.querySelector('#edit').onclick=()=>goalForm(g.id);
    s.querySelectorAll('[data-delc]').forEach(b=>b.onclick=()=>{g.contributions=g.contributions.filter(c=>c.id!==b.dataset.delc);save();render();goalSheet(g.id)});
    s.querySelector('form').onsubmit=ev=>{ev.preventDefault();const fd=new FormData(ev.target);const err=s.querySelector('#err');
      let v=r2(num(fd.get('amount')));if(!(v>0))return err.textContent='Indica um valor maior que zero.';
      if(fd.get('kind')==='out'){if(v>sv+0.004)return err.textContent=`Só há ${eur(sv)} juntos.`;v=-v}
      g.contributions.push({id:uid(),date:fd.get('date')||TODAY,amount:v,who:fd.get('who')||S.viewer,note:fd.get('note').trim()});
      const done=goalSaved(g)>=g.target;closeSheet();commit(v>0?(done?'🎉 Objetivo atingido!':`${eur(v)} postos de lado`):'Levantamento registado')};
  });
}

/* ---------- mover despesa entre espaços ---------- */
function moveExpense(ex){
  const toShared=ex.scope==='pessoal';
  const other_=nm(other(S.viewer));
  confirmSheet(toShared?'Mover para o Casal?':'Mover para Pessoal?',
    toShared?`"${ex.desc}" passa a ser partilhada (50/50, paga por ti). ${other_} vai passar a vê-la e o saldo entre os dois é recalculado.`
            :`"${ex.desc}" passa a ser só tua. ${other_} deixa de a ver e o saldo entre os dois é recalculado.`,
    toShared?'Mover para o Casal':'Mover para Pessoal',()=>{
      const newScope=toShared?'partilhada':'pessoal';
      if(ex.photos&&ex.photos.length){Promise.all(ex.photos.map(p=>PH.move(p,newScope).catch(()=>p))).then(ps=>{ex.photos=ps;save()})}
      if(toShared){ex.scope='partilhada';ex.payer=ex.owner;ex.split={type:'equal',value:50}}
      else{ex.scope='pessoal';ex.owner=S.viewer;ex.payer=S.viewer}
      UI.space=toShared?'casal':'pessoal';commit(toShared?'Movida para o Casal 👥':'Movida para Pessoal 🔒')});
}

/* ---------- render / router ---------- */
const VIEWS={ganhos:vGanhos,inicio:vInicio,despesas:vDespesas,fixos:vFixos,resumo:vResumo,definicoes:vDefinicoes};
function route(){const h=location.hash.slice(1);return VIEWS[h]?h:'inicio'}
function applyTheme(){const t=PREF.theme||'auto';const el=document.documentElement;if(t==='auto')el.removeAttribute('data-theme');else el.setAttribute('data-theme',t);const dark=t==='dark'||(t==='auto'&&matchMedia('(prefers-color-scheme: dark)').matches);const b=$('#themeBtn');b.textContent=dark?'☀️':'🌙';b.title=dark?'Mudar para modo claro':'Mudar para modo escuro';b.setAttribute('aria-label',b.title)}
function render(){
  if(!S||!S.household)return;
  applyTheme();
  let r=route();
  if(r==='ganhos'&&isCasal()){UI.space='pessoal'}
  $('#view').innerHTML=VIEWS[r]();
  const tabs=[['inicio','🏠','Início'],['despesas','🧾','Despesas'],['fixos','🔁','Fixos']].concat(isCasal()?[]:[['ganhos','💰','Ganhos']]).concat([['resumo','📊','Resumo']]);
  if(wide())tabs.push(['definicoes','⚙️','Definições']);
  $('#tabs').innerHTML=tabs.map(([k,i,l])=>`<a href="#${k}" class="${k===r?'on':''}"><span class="i">${i}</span>${l}</a>`).join('');
  const v=S.viewer;
  $('#who').innerHTML=`${avatar(v,28)}<span>${esc(nm(v))}</span>`;
  $('#fab').classList.toggle('hidden',r==='resumo'||r==='definicoes');
  document.body.classList.toggle('sp-pessoal',!isCasal());
  document.querySelectorAll('#space button').forEach(b=>b.classList.toggle('on',b.dataset.sp===UI.space));
  $('#space').classList.toggle('hidden',r==='definicoes');
  $('#space [data-sp=pessoal]').textContent=`🔒 Pessoal · ${nm(S.viewer)}`;
  $('#fab').setAttribute('aria-label',r==='fixos'?'Adicionar gasto fixo':r==='ganhos'?'Adicionar ganho':'Adicionar despesa');
  $('#fabL').textContent=r==='fixos'?'Novo gasto fixo':r==='ganhos'?'Novo ganho':'Nova despesa';
  if(r==='definicoes'&&window.Cloud)Cloud.renderPush();
}
function commit(msg){generate();genIncome();save();render();if(msg)toast(msg)}

/* ---------- sheet (formulários) ---------- */
function openSheet(html,mount){$('#sheet').innerHTML='<div class="grab"></div>'+html;$('#ov').classList.add('open');mount&&mount($('#sheet'));const f=$('#sheet').querySelector('input:not([type=radio]),select');f&&setTimeout(()=>f.focus({preventScroll:true}),50)}
const MQ=matchMedia('(min-width: 960px)');const wide=()=>MQ.matches;
try{MQ.addEventListener('change',()=>render())}catch(e){}
let sheetCancel=null;
function closeSheet(){if(sheetCancel){const f=sheetCancel;sheetCancel=null;f()}$('#ov').classList.remove('open');$('#sheet').innerHTML='';if(window.Cloud)Cloud.afterSheetClosed()}
$('#ov').addEventListener('click',e=>{if(e.target.id==='ov')closeSheet()});
document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;if($('#pv').classList.contains('open'))$('#pv').classList.remove('open');else closeSheet()});
function confirmSheet(title,text,okLabel,onOk){
  openSheet(`<h3>${esc(title)}</h3><p style="color:var(--ink2);margin:0">${esc(text)}</p><div class="actions"><button class="btn" data-x>Cancelar</button><button class="btn danger" data-ok>${esc(okLabel)}</button></div>`,s=>{
    s.querySelector('[data-x]').onclick=closeSheet;s.querySelector('[data-ok]').onclick=()=>{closeSheet();onOk()}});
}
const seg=(name,opts,val)=>`<div class="seg">${opts.map(([v,l])=>`<label><input type="radio" name="${name}" value="${v}" ${String(v)===String(val)?'checked':''}><span>${l}</span></label>`).join('')}</div>`;
const catOptions=sel=>S.categories.map(c=>`<option value="${c.id}" ${c.id===sel?'selected':''}>${esc(c.icon+' '+c.name)}</option>`).join('');

function splitBlock(x){
  const s=x.split||{type:'equal',value:50};
  return `<div id="sharedBox" class="${x.scope==='partilhada'?'':'hidden'}">
    <div class="field"><div class="lab" id="payerLab">Quem pagou</div>${seg('payer',[['u1',avatar('u1',20)+' '+esc(nm('u1'))],['u2',avatar('u2',20)+' '+esc(nm('u2'))]],x.payer||S.viewer)}</div>
    <div class="field"><div class="lab">Divisão</div>${seg('stype',[['equal','50/50'],['percent','Percentagem'],['fixed','Valor fixo']],s.type)}</div>
    <div class="field ${s.type==='equal'?'hidden':''}" id="svBox"><label for="sv" id="svLab"></label><input class="inp" id="sv" name="sv" inputmode="decimal" value="${s.type==='equal'?'':String(s.value).replace('.',',')}"></div>
    <div class="preview" id="prev"></div>
  </div>`;
}
const num=v=>{const n=parseFloat(String(v||'').replace(/\s/g,'').replace(',','.'));return isNaN(n)?NaN:n};
function wireSplit(s,isRec){
  const f=s.querySelector('form');
  const upd=()=>{
    const fd=new FormData(f);
    const scope=fd.get('scope');s.querySelector('#sharedBox').classList.toggle('hidden',scope!=='partilhada');
    const st=fd.get('stype');s.querySelector('#svBox').classList.toggle('hidden',st==='equal');
    s.querySelector('#svLab').textContent=st==='percent'?`Parte de ${nm('u1')} (%)`:`Parte de ${nm('u1')} (€)`;
    if(!isRec){const unpaid=!!fd.get('unpaid');s.querySelector('#payerLab').textContent=unpaid?'Quem vai pagar':'Quem pagou';s.querySelector('#dtLab').textContent=unpaid?'Vencimento':'Data'}
    const amount=num(fd.get('amount'));
    const tmp={scope:'partilhada',amount:isNaN(amount)?0:amount,split:{type:st,value:num(fd.get('sv'))||0}};
    const sh=shares(tmp);
    s.querySelector('#prev').textContent=isNaN(amount)||amount<=0?'Indica o valor para ver a divisão.':`${nm('u1')}: ${eur(sh.u1)} · ${nm('u2')}: ${eur(sh.u2)}`;
  };
  f.addEventListener('input',upd);f.addEventListener('change',upd);upd();
}
function readSplit(fd,amount){
  const t=fd.get('stype');const v=num(fd.get('sv'));
  if(t==='equal')return{ok:true,split:{type:'equal',value:50}};
  if(t==='percent'){if(isNaN(v)||v<0||v>100)return{ok:false,msg:'A percentagem tem de estar entre 0 e 100.'};return{ok:true,split:{type:'percent',value:v}}}
  if(isNaN(v)||v<0||v>amount)return{ok:false,msg:`O valor fixo tem de estar entre 0 e ${eur(amount)}.`};
  return{ok:true,split:{type:'fixed',value:r2(v)}};
}

// descrições já usadas neste espaço (mais recentes primeiro) e a última despesa com essa descrição
function spaceExpenses(scope){return S.expenses.filter(e=>scope==='partilhada'?e.scope==='partilhada':(e.scope==='pessoal'&&e.owner===S.viewer))}
function pastDescs(scope){const seen=new Set(),out=[];for(const e of spaceExpenses(scope).sort((a,b)=>b.date.localeCompare(a.date))){const k=norm(e.desc);if(!seen.has(k)){seen.add(k);out.push(e.desc)}if(out.length>=60)break}return out}
function lastWith(scope,desc){const k=norm(desc).trim();if(!k)return null;return spaceExpenses(scope).filter(e=>norm(e.desc).trim()===k).sort((a,b)=>b.date.localeCompare(a.date))[0]||null}
const tplFor=()=>S.templates.filter(t=>isCasal()?t.scope==='partilhada':(t.scope==='pessoal'&&t.owner===S.viewer));
function firstFutureMonthly(date){let d=date,k=1;do{d=addMonths(date,k++)}while(d<TODAY&&k<600);return d}
function expenseForm(id,prefill){
  const ex=id?S.expenses.find(e=>e.id===id):null;
  const base={desc:'',amount:'',cat:'alim',date:TODAY,status:'pago',paidDate:TODAY,scope:isCasal()?'partilhada':'pessoal',owner:S.viewer,payer:S.viewer,split:{type:'equal',value:50},notes:'',photos:[]};
  const x=ex?{...base,...ex,photos:[...(ex.photos||[])]}:{...base,...(prefill||{})};
  const photos=[...x.photos];const added=[];const removed=[];
  const tpls=!ex&&!prefill?tplFor():[];
  const isTpl=S.templates.some(t=>t.scope===x.scope&&(x.scope==='partilhada'||t.owner===x.owner)&&norm(t.desc)===norm(x.desc)&&x.desc);
  openSheet(`<h3>${ex?'Editar despesa':prefill?'Duplicar despesa':'Nova despesa'} <span class="badge ${x.scope==='partilhada'?'b-scope':'b-pers'}" style="vertical-align:middle">${x.scope==='partilhada'?'👥 Casal':'🔒 Pessoal'}</span></h3>
  ${ex&&ex.recurringId?'<p class="preview" style="margin-top:-4px">🔁 Gerada por um gasto fixo. As alterações aqui só afetam este pagamento.</p>':''}
  ${tpls.length?`<div class="lab" style="font-size:12.5px;font-weight:600;color:var(--ink2);margin-bottom:5px">⭐ Frequentes</div><div class="filters" id="tpls">${tpls.map(t=>`<button type="button" class="chip" data-tpl="${t.id}">${esc(cat(t.cat).icon)} ${esc(t.desc)}${t.amount?` · ${eur(t.amount)}`:''}</button>`).join('')}</div>`:''}
  <form novalidate>
    <div class="field"><label for="d">Descrição</label><input class="inp" id="d" name="desc" value="${esc(x.desc)}" placeholder="Ex.: Supermercado" maxlength="60" list="descList" autocomplete="off">
      <datalist id="descList">${pastDescs(x.scope).map(d=>`<option value="${esc(d)}">`).join('')}</datalist><div id="lastHint"></div></div>
    <div class="row2">
      <div class="field"><label for="a">Valor (€)</label><input class="inp" id="a" name="amount" inputmode="decimal" placeholder="0,00" value="${x.amount===''?'':String(x.amount).replace('.',',')}"></div>
      <div class="field"><label for="c">Categoria</label><select class="inp" id="c" name="cat">${catOptions(x.cat)}</select></div>
    </div>
    <div class="row2">
      <div class="field"><label for="dt" id="dtLab">Data</label><input class="inp" type="date" id="dt" name="date" value="${x.date}"></div>
      <div class="field" style="display:flex;align-items:flex-end"><label class="check" style="margin:0 0 12px"><input type="checkbox" name="unpaid" ${x.status!=='pago'?'checked':''}> ⏳ Ainda não está pago</label></div>
    </div>
    <input type="hidden" name="scope" value="${x.scope}">
    ${splitBlock(x)}
    <div class="field mt"><label for="nt">📝 Notas</label><textarea class="inp" id="nt" name="notes" rows="2" maxlength="500" placeholder="Ex.: pago com cartão de crédito; garantia até 2028">${esc(x.notes||'')}</textarea></div>
    <div class="field"><div class="lab">📷 Fotos (talão, fatura, recibo)</div>
      <div class="thumbs" id="thumbs"></div>
      <label class="btn ghost small" style="display:inline-block;margin-top:6px;cursor:pointer">+ Adicionar foto<input type="file" accept="image/*" multiple id="phIn" style="display:none"></label>
      <span class="muted" id="phBusy" style="font-size:12.5px;margin-left:6px"></span>
    </div>
    <label class="check"><input type="checkbox" name="tpl" ${isTpl?'checked':''}> ⭐ Guardar como frequente (atalho para a próxima vez)</label>
    <div class="err" id="err"></div>
    ${ex?`<div class="actions" style="margin-top:12px"><button type="button" class="btn" id="dup">⧉ Duplicar</button>${ex.recurringId?'':'<button type="button" class="btn" id="mkrec">🔁 Tornar fixo</button>'}${ex.recurringId?'':`<button type="button" class="btn" id="mv">${ex.scope==='pessoal'?'↔ Para o Casal':'↔ Para Pessoal'}</button>`}</div>`:''}
    <div class="actions">${ex?'<button type="button" class="btn danger" id="del">Apagar</button>':'<button type="button" class="btn" data-x>Cancelar</button>'}<button class="btn primary" type="submit">Guardar</button></div>
  </form>`,s=>{
    wireSplit(s,false);
    const f=s.querySelector('form');
    if(!ex){
      const hint=s.querySelector('#lastHint');let lastKey='';
      const onDesc=()=>{
        const l=lastWith(x.scope,f.desc.value);const key=l?l.id:'';if(key===lastKey)return;lastKey=key;
        if(!l){hint.innerHTML='';return}
        f.cat.value=l.cat;
        if(x.scope==='partilhada'&&l.split){const st=f.querySelector(`input[name=stype][value=${l.split.type}]`);if(st){st.checked=true;f.sv.value=l.split.type==='equal'?'':String(l.split.value).replace('.',',')}}
        f.dispatchEvent(new Event('change'));
        hint.innerHTML=`<div class="preview" style="margin-top:6px;display:flex;align-items:center;justify-content:space-between;gap:8px"><span>Última vez: <b>${eur(l.amount)}</b> a ${fShort(l.date)} · ${esc(cat(l.cat).name)}</span><button type="button" class="btn small" id="useLast">Usar ${eur(l.amount)}</button></div>`;
        hint.querySelector('#useLast').onclick=()=>{f.amount.value=String(l.amount).replace('.',',');f.dispatchEvent(new Event('input'));f.dt.focus()};
      };
      f.desc.addEventListener('input',onDesc);f.desc.addEventListener('change',onDesc);
    }
    const drawThumbs=()=>{const t=s.querySelector('#thumbs');t.innerHTML=photos.map((p,i)=>`<div class="thumb" data-ph="${p}"><img alt="Foto ${i+1}" data-open="${i}"><button type="button" data-rmph="${p}" aria-label="Remover foto">✕</button></div>`).join('');fillThumbs(t)};
    drawThumbs();
    s.querySelector('#thumbs').onclick=ev=>{const r=ev.target.closest('[data-rmph]');if(r){const id=r.dataset.rmph;photos.splice(photos.indexOf(id),1);removed.push(id);return drawThumbs()}const o=ev.target.closest('[data-open]');if(o)viewPhotos(photos,+o.dataset.open)};
    s.querySelector('#phIn').onchange=async ev=>{
      const files=[...ev.target.files];ev.target.value='';if(!files.length)return;
      const busy=s.querySelector('#phBusy');busy.textContent='A enviar…';
      for(const file of files){try{const blob=await compressImage(file);const id=photoPath(x.scope);await PH.put(id,blob);photos.push(id);added.push(id)}catch(e){toast(e&&e.message&&/fetch|network/i.test(e.message)?'Sem ligação: a foto não foi enviada':'Não foi possível adicionar esta imagem')}}
      busy.textContent='';drawThumbs();
    };
    const tp=s.querySelector('#tpls');
    tp&&(tp.onclick=ev=>{const b=ev.target.closest('[data-tpl]');if(!b)return;const t=S.templates.find(z=>z.id===b.dataset.tpl);
      f.desc.value=t.desc;f.amount.value=t.amount?String(t.amount).replace('.',','):'';f.cat.value=t.cat;
      if(t.scope==='partilhada'){f.querySelector(`input[name=payer][value=${S.viewer}]`).checked=true;f.querySelector(`input[name=stype][value=${t.split.type}]`).checked=true;f.sv.value=t.split.type==='equal'?'':String(t.split.value).replace('.',',')}
      f.dispatchEvent(new Event('change'));tp.querySelectorAll('.chip').forEach(c=>c.classList.toggle('on',c===b));(t.amount?f.dt:f.amount).focus()});
    const cancel=()=>{added.forEach(id=>PH.del(id));closeSheet()};
    const x1=s.querySelector('[data-x]');x1&&(x1.onclick=cancel);
    sheetCancel=()=>added.forEach(id=>PH.del(id));
    if(ex){
      s.querySelector('#dup').onclick=()=>{sheetCancel();sheetCancel=null;closeSheet();expenseForm(null,dupPrefill(ex))};
      const mv=s.querySelector('#mv');mv&&(mv.onclick=()=>{sheetCancel();sheetCancel=null;moveExpense(ex)});
      const mk=s.querySelector('#mkrec');mk&&(mk.onclick=()=>{sheetCancel();sheetCancel=null;closeSheet();recurringForm(null,{desc:ex.desc,amount:ex.amount,cat:ex.cat,freq:1,start:firstFutureMonthly(ex.date),scope:ex.scope,owner:ex.owner,payer:ex.payer,split:{...ex.split}})});
      s.querySelector('#del').onclick=()=>askDeleteExpense(ex,added);
    }
    f.onsubmit=ev=>{
      ev.preventDefault();const fd=new FormData(f);const err=s.querySelector('#err');
      const desc=fd.get('desc').trim(),amount=r2(num(fd.get('amount')));
      if(!desc)return err.textContent='Escreve uma descrição.';
      if(!(amount>0))return err.textContent='Indica um valor maior que zero.';
      if(!fd.get('date'))return err.textContent='Indica a data.';
      const scope=fd.get('scope');let split={type:'equal',value:50};
      if(scope==='partilhada'){const rs=readSplit(fd,amount);if(!rs.ok)return err.textContent=rs.msg;split=rs.split}
      const status=fd.get('unpaid')?'por_pagar':'pago';
      const owner=ex?ex.owner:(x.owner||S.viewer);
      const data={desc,amount,cat:fd.get('cat'),date:fd.get('date'),status,paidDate:status==='pago'?((ex&&ex.status==='pago'&&ex.paidDate)||fd.get('date')):null,scope,owner,payer:scope==='partilhada'?fd.get('payer'):owner,split,notes:fd.get('notes').trim(),photos:[...photos]};
      removed.forEach(id=>PH.del(id));
      const same=t=>t.scope===scope&&(scope==='partilhada'||t.owner===owner);
      S.templates=S.templates.filter(t=>!(same(t)&&(norm(t.desc)===norm(desc)||(ex&&norm(t.desc)===norm(ex.desc)))));
      if(fd.get('tpl'))S.templates.push({id:uid(),scope,owner,desc,amount,cat:data.cat,split:{...split}});
      if(ex&&ex.recurringId&&status!=='pago')data.autoPay=false; // marcado à mão como por pagar: não pagar sozinho
      if(ex)Object.assign(ex,data);else S.expenses.push({id:uid(),recurringId:null,period:null,...data});
      sheetCancel=null;closeSheet();const saved=ex||S.expenses[S.expenses.length-1];commit((ex?'Despesa atualizada':'Despesa adicionada')+budgetToast(saved));
    };
  });
}

function recurringForm(id,prefill){
  const ex=id?S.recurring.find(r=>r.id===id):null;
  const x=ex?{...ex}:{desc:'',amount:'',cat:'casa',freq:1,start:TODAY,scope:isCasal()?'partilhada':'pessoal',owner:S.viewer,payer:S.viewer,split:{type:'equal',value:50},active:true,...(prefill||{})};
  const hist=ex?S.expenses.filter(e=>e.recurringId===ex.id).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,6):[];
  openSheet(`<h3>${ex?'Editar gasto fixo':'Novo gasto fixo'} <span class="badge ${x.scope==='partilhada'?'b-scope':'b-pers'}" style="vertical-align:middle">${x.scope==='partilhada'?'👥 Casal':'🔒 Pessoal'}</span></h3>
  <form novalidate>
    <div class="field"><label for="d">Descrição</label><input class="inp" id="d" name="desc" value="${esc(x.desc)}" placeholder="Ex.: Renda, Netflix, Seguro" maxlength="60"></div>
    <div class="row2">
      <div class="field"><label for="a">Valor (€)</label><input class="inp" id="a" name="amount" inputmode="decimal" placeholder="0,00" value="${x.amount===''?'':String(x.amount).replace('.',',')}"></div>
      <div class="field"><label for="c">Categoria</label><select class="inp" id="c" name="cat">${catOptions(x.cat)}</select></div>
    </div>
    <div class="row2">
      <div class="field"><label for="fq">Periodicidade</label><select class="inp" id="fq" name="freq">${Object.entries(FREQ).map(([k,l])=>`<option value="${k}" ${+k===+x.freq?'selected':''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label for="st">${ex?'1.º vencimento':'Próximo vencimento'}</label><input class="inp" type="date" id="st" name="start" value="${x.start}" ${ex?'disabled':''}></div>
    </div>
    <input type="hidden" name="scope" value="${x.scope}">
    ${splitBlock(x)}
    <label class="check"><input type="checkbox" name="autoPay" ${x.autoPay!==false?'checked':''}> ✓ Fica pago automaticamente na data (débito direto)</label>
    <p class="muted" style="font-size:12.5px">${ex?'As alterações aplicam-se aos pagamentos futuros ainda por pagar; os já pagos mantêm-se.':'Cada pagamento aparece sozinho na data. Desliga a opção acima se preferires confirmar cada pagamento à mão.'}</p>
    ${hist.length?`<div class="hist"><div class="muted" style="font-size:12px">Últimos pagamentos</div>${hist.map(e=>`<div><span>${fDate(e.date)} · ${e.status==='pago'?'✓ pago':isLate(e)?'⚠ em atraso':'⏳ por pagar'}</span><b>${eur(e.amount)}</b></div>`).join('')}</div>`:''}
    <div class="err" id="err"></div>
    ${ex?`<div class="actions" style="margin-top:8px"><button type="button" class="btn" id="pause">${ex.active?'⏸ Pausar':'▶ Retomar'}</button><button type="button" class="btn danger" id="del">Apagar</button></div>`:''}
    <div class="actions"><button type="button" class="btn" data-x>Cancelar</button><button class="btn primary" type="submit">Guardar</button></div>
  </form>`,s=>{
    s.querySelector('#payerLab').textContent='Quem paga';
    wireSplit(s,true);
    s.querySelector('#payerLab').textContent='Quem paga';
    s.querySelector('form').addEventListener('change',()=>{const l=s.querySelector('#payerLab');l&&(l.textContent='Quem paga')});
    s.querySelector('[data-x]').onclick=closeSheet;
    const removeFutureUnpaid=r=>{S.expenses=S.expenses.filter(e=>!(e.recurringId===r.id&&e.status!=='pago'&&e.date>=TODAY))};
    if(ex){
      s.querySelector('#pause').onclick=()=>{
        if(ex.active){ex.active=false;removeFutureUnpaid(ex);closeSheet();commit('Gasto fixo em pausa')}
        else{ex.active=true;ex.genFrom=TODAY;closeSheet();commit('Gasto fixo retomado')}
      };
      s.querySelector('#del').onclick=()=>confirmSheet('Apagar gasto fixo?','Os pagamentos futuros por pagar são apagados. Os já pagos ficam no histórico.','Apagar',()=>{
        removeFutureUnpaid(ex);S.recurring=S.recurring.filter(r=>r.id!==ex.id);commit('Gasto fixo apagado')});
    }
    s.querySelector('form').onsubmit=ev=>{
      ev.preventDefault();const fd=new FormData(ev.target);const err=s.querySelector('#err');
      const desc=fd.get('desc').trim(),amount=r2(num(fd.get('amount')));
      if(!desc)return err.textContent='Escreve uma descrição.';
      if(!(amount>0))return err.textContent='Indica um valor maior que zero.';
      const scope=fd.get('scope');let split={type:'equal',value:50};
      if(scope==='partilhada'){const rs=readSplit(fd,amount);if(!rs.ok)return err.textContent=rs.msg;split=rs.split}
      const data={desc,amount,cat:fd.get('cat'),freq:+fd.get('freq'),autoPay:!!fd.get('autoPay'),scope,payer:scope==='partilhada'?fd.get('payer'):(ex?ex.owner:S.viewer),split};
      if(ex){
        const freqChanged=data.freq!==ex.freq;
        Object.assign(ex,data);
        if(scope==='pessoal'&&ex.scope!=='pessoal')ex.owner=S.viewer;
        if(freqChanged){removeFutureUnpaid(ex);ex.genFrom=TODAY}
        for(const e of S.expenses)if(e.recurringId===ex.id&&e.status!=='pago'&&e.date>=TODAY)Object.assign(e,{desc,amount,cat:data.cat,scope,owner:ex.owner,payer:data.payer,split:{...split},autoPay:data.autoPay});
        closeSheet();commit('Gasto fixo atualizado');
      }else{
        const start=fd.get('start');if(!start)return err.textContent='Indica o próximo vencimento.';
        S.recurring.push({id:uid(),...data,owner:x.owner||S.viewer,start,genFrom:start,end:null,active:true,skip:[]});
        closeSheet();commit('Gasto fixo criado');
      }
    };
  });
}

function settleForm(){
  const b=balanceViewer();const debtor=b>0?other(S.viewer):S.viewer;const creditor=other(debtor);const amt=Math.abs(b);
  openSheet(`<h3>Acertar contas</h3>
  <p style="margin:0 0 12px;color:var(--ink2)">${esc(you(debtor))} ${debtor===S.viewer?'pagas':'paga'} a ${esc(debtor===S.viewer?nm(creditor):'ti')}:</p>
  <form novalidate>
    <div class="row2">
      <div class="field"><label for="sa">Valor (€)</label><input class="inp" id="sa" name="amount" inputmode="decimal" value="${String(amt.toFixed(2)).replace('.',',')}"></div>
      <div class="field"><label for="sd">Data</label><input class="inp" type="date" id="sd" name="date" value="${TODAY}"></div>
    </div>
    <div class="field"><label for="sn">Nota (opcional)</label><input class="inp" id="sn" name="note" placeholder="Ex.: MB Way, transferência" maxlength="40"></div>
    <p class="muted" style="font-size:12.5px;margin:0">Podes acertar só uma parte. O saldo em dívida é ${eur(amt)}.</p>
    <div class="err" id="err"></div>
    <div class="actions"><button type="button" class="btn" data-x>Cancelar</button><button class="btn primary" type="submit">Registar pagamento</button></div>
  </form>`,s=>{
    s.querySelector('[data-x]').onclick=closeSheet;
    s.querySelector('form').onsubmit=ev=>{
      ev.preventDefault();const fd=new FormData(ev.target);const v=r2(num(fd.get('amount')));
      if(!(v>0))return s.querySelector('#err').textContent='Indica um valor maior que zero.';
      if(v>amt+0.004)return s.querySelector('#err').textContent=`O valor não pode passar de ${eur(amt)}.`;
      S.settlements.push({id:uid(),from:debtor,to:creditor,amount:v,date:fd.get('date')||TODAY,note:fd.get('note').trim()});
      closeSheet();commit(Math.abs(v-amt)<0.005?'Contas acertadas 🎉':'Pagamento registado');
    };
  });
}

/* ---------- eventos ---------- */
window.addEventListener('hashchange',render);
$('#who').onclick=()=>{location.hash='definicoes'};
$('#space').onclick=e=>{const b=e.target.closest('[data-sp]');if(!b)return;UI.space=b.dataset.sp;UI.status='todos';UI.cat='todas';if(isCasal()&&route()==='ganhos')location.hash='inicio';render();window.scrollTo(0,0)};
$('#themeBtn').onclick=()=>{const t=PREF.theme||'auto';const dark=t==='dark'||(t==='auto'&&matchMedia('(prefers-color-scheme: dark)').matches);PREF.theme=dark?'light':'dark';savePref();render();toast(dark?'Modo claro ☀️':'Modo escuro 🌙')};
try{matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if((PREF.theme||'auto')==='auto')applyTheme()})}catch(e){}
$('#fab').onclick=()=>route()==='fixos'?recurringForm():route()==='ganhos'?incomeChooser():expenseForm();
$('#view').addEventListener('click',e=>{
  const open=e.target.closest('.swipe.open');
  if(open&&!e.target.closest('.sw-act')){closeSwipes();return}
  const t=e.target.closest('button,[data-exp],[data-rec],[data-rm],[data-inc],[data-src],[data-goal]');if(!t)return;
  if(t.dataset.swdel){closeSwipes();const x=S.expenses.find(z=>z.id===t.dataset.swdel);return x&&askDeleteExpense(x)}
  if(t.dataset.swdup){closeSwipes();const x=S.expenses.find(z=>z.id===t.dataset.swdup);return x&&expenseForm(null,dupPrefill(x))}
  if(t.dataset.pay){e.stopPropagation();const x=S.expenses.find(z=>z.id===t.dataset.pay);x.status='pago';x.paidDate=TODAY;commit(`"${x.desc}" marcada como paga`);return}
  if(t.id==='settle')return settleForm();
  if(t.dataset.exp)return expenseForm(t.dataset.exp);
  if(t.dataset.rec)return recurringForm(t.dataset.rec);
  if(t.dataset.m){UI.month=ymAdd(UI.month,+t.dataset.m);return render()}
  if(t.dataset.rmn){UI.rmonth=ymAdd(UI.rmonth,+t.dataset.rmn);return render()}
  if(t.dataset.rm){UI.rmonth=t.dataset.rm;hideTip();return render()}
  if(t.id==='mgBud')return budgetForm();
  if(t.id==='newGoal')return goalForm();
  if(t.dataset.goal)return goalSheet(t.dataset.goal);
  if(t.dataset.td){S.templates=S.templates.filter(z=>z.id!==t.dataset.td);return commit('Frequente removido')}
  if(t.id==='qx'){UI.q='';return render()}
  if(t.dataset.gm){UI.gmonth=ymAdd(UI.gmonth,+t.dataset.gm);return render()}
  if(t.dataset.qp||t.dataset.qm){e.stopPropagation();const x=S.incomeEntries.find(z=>z.id===(t.dataset.qp||t.dataset.qm));x.qty=Math.max(0,x.qty+(t.dataset.qp?1:-1));return commit()}
  if(t.dataset.rcv){e.stopPropagation();const x=S.incomeEntries.find(z=>z.id===t.dataset.rcv);x.received=true;return commit(`${x.desc}: recebido`)}
  if(t.dataset.inc)return entryForm(t.dataset.inc);
  if(t.dataset.src)return sourceForm(t.dataset.src);
  if(t.id==='avRm')return Cloud.setAvatar(null);
  if(t.id==='saveName'){const v=$('#myName').value.trim();if(!v)return toast('O nome não pode ficar vazio');return Cloud.saveName(v)}
  if(t.id==='logout')return Cloud.signOut();
  if(t.id==='copyCode'){try{navigator.clipboard.writeText(S.household.invite_code).then(()=>toast('Código copiado'),()=>toast('Copia à mão: '+S.household.invite_code))}catch(e){toast('Copia à mão: '+S.household.invite_code)}return}
  if(t.id==='saveCats'){document.querySelectorAll('[data-cn]').forEach(i=>{const c=S.categories.find(c=>c.id===i.dataset.cn);if(i.value.trim())c.name=i.value.trim()});document.querySelectorAll('[data-ci]').forEach(i=>{const c=S.categories.find(c=>c.id===i.dataset.ci);if(i.value.trim())c.icon=i.value.trim()});return commit('Categorias guardadas')}
  if(t.id==='addCat'){const n=$('#newCat').value.trim();if(!n)return toast('Escreve o nome da categoria');S.categories.splice(S.categories.length-1,0,{id:uid(),name:n,icon:$('#newIcon').value.trim()||'🏷️'});S.categories.forEach((c,i)=>c.sort=i);return commit('Categoria adicionada')}
  if(t.dataset.cd){const c=S.categories.find(c=>c.id===t.dataset.cd);const n=S.expenses.filter(e=>e.cat===c.id).length+S.recurring.filter(r=>r.cat===c.id).length;
    return confirmSheet(`Apagar "${c.name}"?`,n?`${n} registo(s) passam para "Outros".`:'Esta categoria não está a ser usada.','Apagar',()=>{S.expenses.forEach(e=>{if(e.cat===c.id)e.cat='outros'});S.recurring.forEach(r=>{if(r.cat===c.id)r.cat='outros'});S.categories=S.categories.filter(x=>x.id!==c.id);commit('Categoria apagada')})}
});
$('#view').addEventListener('input',e=>{if(e.target.id==='q'){UI.q=e.target.value;$('#dres').innerHTML=despesasResults();$('#qx').classList.toggle('hidden',!UI.q);$('#mnav').classList.toggle('hidden',!!UI.q.trim())}});
$('#view').addEventListener('change',e=>{
  if(e.target.id==='avIn'){const f=e.target.files[0];e.target.value='';if(f){toast('A enviar a foto…');cropSquare(f).then(b=>Cloud.setAvatar(b),()=>toast('Não foi possível ler esta imagem'))}return}
  if(e.target.name==='theme'){PREF.theme=e.target.value;savePref();render();return}
  if(e.target.id==='fst'){UI.status=e.target.value;render()}
  if(e.target.id==='fcat'){UI.cat=e.target.value;render()}
  if(e.target.id==='evoCat'){UI.evoCat=e.target.value;render()}
});
$('#view').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-exp],[data-rec],[data-rm],[data-inc],[data-src],[data-goal]')){e.preventDefault();e.target.click()}});
/* deslizar uma despesa para a esquerda: duplicar / apagar (só ecrãs táteis) */
const SWW=150;let sw=null;
function closeSwipes(except){document.querySelectorAll('.swipe.open').forEach(w=>{if(w!==except){w.classList.remove('open');w.querySelector('.row').style.transform=''}})}
$('#view').addEventListener('touchstart',e=>{
  const row=e.target.closest('.swipe>.row');closeSwipes(row&&row.parentElement);if(!row)return;
  sw={row,x:e.touches[0].clientX,y:e.touches[0].clientY,dx:0,base:row.parentElement.classList.contains('open')?-SWW:0,lock:null};
},{passive:true});
$('#view').addEventListener('touchmove',e=>{
  if(!sw)return;const dx=e.touches[0].clientX-sw.x,dy=e.touches[0].clientY-sw.y;
  if(sw.lock===null&&(Math.abs(dx)>8||Math.abs(dy)>8))sw.lock=Math.abs(dx)>Math.abs(dy)?'x':'y';
  if(sw.lock!=='x')return;
  e.preventDefault();sw.dx=dx;
  sw.row.style.transition='none';sw.row.style.transform=`translateX(${Math.min(0,Math.max(-SWW-40,sw.base+dx))}px)`;
},{passive:false});
$('#view').addEventListener('touchend',()=>{
  if(!sw)return;const{row,lock,base,dx}=sw;sw=null;if(lock!=='x')return;
  const isOpen=base+dx<-SWW/2;row.style.transition='';row.style.transform=isOpen?`translateX(-${SWW}px)`:'';
  row.parentElement.classList.toggle('open',isOpen);
  if(isOpen&&!PREF.swiped){PREF.swiped=true;savePref();const h=document.querySelector('.sw-hint');h&&h.remove()}
});
/* tooltip */
const tip=$('#tip');
function showTip(el,x,y){const[a,b]=el.dataset.tip.split('|');tip.innerHTML='';const s=document.createElement('b');s.textContent=b;const l=document.createElement('span');l.textContent=a;tip.append(s,l);tip.style.display='block';const w=tip.offsetWidth;tip.style.left=Math.min(window.innerWidth-w-8,Math.max(8,x-w/2))+'px';tip.style.top=(y-tip.offsetHeight-12)+'px'}
function hideTip(){tip.style.display='none'}
$('#view').addEventListener('pointermove',e=>{const el=e.target.closest('[data-tip]');if(el)showTip(el,e.clientX,e.clientY);else hideTip()});
$('#view').addEventListener('pointerleave',hideTip);
$('#view').addEventListener('focusin',e=>{const el=e.target.closest('[data-tip]');if(el){const r=el.getBoundingClientRect();showTip(el,r.left+r.width/2,r.top)}});
$('#view').addEventListener('focusout',hideTip);

/* ---------- arranque: ver js/cloud.js ---------- */
