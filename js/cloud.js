/* Cofre a Dois — ligação ao Supabase: autenticação, cofre do casal e sincronização.
 *
 * Modelo: a app mantém o estado em memória (S) e, depois de cada alteração,
 * compara-o com o último estado guardado e envia só o que mudou para a tabela
 * "records" (um registo JSON por item). As políticas RLS da base de dados
 * garantem que cada pessoa só vê o que é partilhado e o que é seu.
 */
(function(){
  const CFG=window.COFRE_CONFIG||{};
  const configured=!!(CFG.url&&CFG.key&&!/COLOCAR/.test(CFG.url+CFG.key));
  const sb=configured?window.supabase.createClient(CFG.url,CFG.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}):null;

  // tipo de registo na base de dados <-> lista no estado S
  const KINDS=[['expenses','expense'],['recurring','recurring'],['settlements','settlement'],['templates','template'],
    ['budgets','budget'],['goals','goal'],['incomeSources','income_source'],['incomeEntries','income_entry'],['categories','category']];
  const ARR_OF=Object.fromEntries(KINDS.map(([a,k])=>[k,a]));

  let snap=new Map();       // "tipo|id" -> JSON guardado na base de dados
  let persisting=false,again=false,timer=null,refreshPending=false,refreshTimer=null,channel=null,signature='';

  // quem pode ver cada registo
  function meta(kind,r){
    if(kind==='settlement'||kind==='category')return{visibility:'shared',owner_slot:null};
    if(kind==='income_source'||kind==='income_entry')return{visibility:'private',owner_slot:r.owner};
    return r.scope==='partilhada'?{visibility:'shared',owner_slot:null}:{visibility:'private',owner_slot:r.owner};
  }

  /* ---------------- gravação ---------------- */
  function persistSoon(){clearTimeout(timer);timer=setTimeout(()=>{timer=null;persist()},250)}
  async function persist(){
    if(!S||!S.household)return;
    if(persisting){again=true;return}
    persisting=true;
    try{
      const hid=S.household.id,ups=[],upKeys=[],dels={},seen=new Set();
      for(const[arr,kind]of KINDS){
        for(const r of S[arr]){
          const k=kind+'|'+r.id;seen.add(k);
          const j=JSON.stringify(r);
          if(snap.get(k)!==j){ups.push({household_id:hid,kind,id:r.id,...meta(kind,r),data:r});upKeys.push([k,j])}
        }
      }
      for(const k of snap.keys())if(!seen.has(k)){const i=k.indexOf('|');(dels[k.slice(0,i)]=dels[k.slice(0,i)]||[]).push(k.slice(i+1))}
      for(let i=0;i<ups.length;i+=500){const{error}=await sb.from('records').upsert(ups.slice(i,i+500));if(error)throw error}
      upKeys.forEach(([k,j])=>snap.set(k,j));
      for(const kind in dels){
        const ids=dels[kind];
        for(let i=0;i<ids.length;i+=200){
          const part=ids.slice(i,i+200);
          const{error}=await sb.from('records').delete().eq('household_id',hid).eq('kind',kind).in('id',part);
          if(error)throw error;
          part.forEach(id=>snap.delete(kind+'|'+id));
        }
      }
      signature=sig();
    }catch(e){
      console.error('Erro a guardar',e);
      toast(navigator.onLine?'⚠ Não foi possível guardar. Vou tentar outra vez.':'📴 Sem internet: guardo quando voltar a ligação.');
      setTimeout(persistSoon,navigator.onLine?5000:15000);
    }finally{
      persisting=false;
      if(again){again=false;persist()}
      else if(refreshPending&&!sheetOpen()){refreshPending=false;refresh()}
    }
  }

  /* ---------------- leitura ---------------- */
  const sig=()=>[...snap.entries()].sort().join('\n');
  async function fetchAll(table,cols,hid){
    const out=[];const page=1000;
    for(let from=0;;from+=page){
      let q=sb.from(table).select(cols).eq('household_id',hid);
      if(table==='records')q=q.order('kind').order('id');
      const{data,error}=await q.range(from,from+page-1);
      if(error)throw error;
      out.push(...data);if(data.length<page)break;
    }
    return out;
  }
  async function loadData(){
    const hid=S.household.id;
    const[rows,members]=await Promise.all([fetchAll('records','kind,id,data',hid),fetchAll('members','slot,display_name',hid)]);
    const fresh={};KINDS.forEach(([a])=>fresh[a]=[]);
    const ns=new Map();
    for(const r of rows){const a=ARR_OF[r.kind];if(!a)continue;fresh[a].push(r.data);ns.set(r.kind+'|'+r.id,JSON.stringify(r.data))}
    fresh.categories.sort((a,b)=>(a.sort??99)-(b.sort??99));
    Object.assign(S,fresh);snap=ns;
    S.users={};for(const m of members)S.users[m.slot]={name:m.display_name};
  }
  const sheetOpen=()=>document.getElementById('ov').classList.contains('open');
  async function refresh(){
    if(!S||!S.household)return;
    if(sheetOpen()||persisting||timer){refreshPending=true;return}
    try{
      const before=signature,users=JSON.stringify(S.users);
      await loadData();
      generate();genIncome();
      const now=sig();
      if(now!==before||JSON.stringify(S.users)!==users){
        signature=now;
        const focused=document.activeElement&&document.activeElement.id;
        render();
        if(focused==='q'){const q=document.getElementById('q');if(q){q.focus();q.setSelectionRange(q.value.length,q.value.length)}}
      }
      persistSoon(); // grava o que o generate() possa ter criado
    }catch(e){console.warn('Falha a atualizar',e)}
  }
  function refreshSoon(){clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,500)}
  function afterSheetClosed(){if(refreshPending){refreshPending=false;setTimeout(refresh,300)}}

  function subscribe(){
    if(channel)sb.removeChannel(channel);
    const hid=S.household.id;
    channel=sb.channel('cofre-'+hid)
      .on('postgres_changes',{event:'*',schema:'public',table:'records',filter:`household_id=eq.${hid}`},refreshSoon)
      .on('postgres_changes',{event:'*',schema:'public',table:'members',filter:`household_id=eq.${hid}`},refreshSoon)
      .subscribe();
  }
  document.addEventListener('visibilitychange',()=>{if(!S||!S.household)return;if(document.visibilityState==='visible')refreshSoon();else persist()});
  window.addEventListener('online',()=>{if(S&&S.household){persistSoon();refreshSoon()}});
  setInterval(()=>{if(S&&S.household&&document.visibilityState==='visible')refresh()},60000);

  /* ---------------- ecrãs de entrada ---------------- */
  const G=()=>document.getElementById('gate');
  function gate(html){document.body.classList.add('gated');G().innerHTML=`<div class="gate"><div class="gate-brand">💰 Cofre a Dois</div>${html}</div>`;const f=G().querySelector('input');f&&f.focus()}
  function ungate(){document.body.classList.remove('gated');G().innerHTML=''}
  const loading=()=>gate('<div class="card" style="text-align:center;padding:28px">A carregar…</div>');
  function ptErr(e){
    const m=(e&&e.message)||String(e||'');
    if(/Invalid login credentials/i.test(m))return 'Email ou palavra-passe incorretos.';
    if(/already registered|already exists/i.test(m))return 'Já existe uma conta com este email. Usa “Entrar”.';
    if(/Email not confirmed/i.test(m))return 'Ainda não confirmaste o email. Vê a tua caixa de correio (e o spam).';
    if(/Password should be|weak/i.test(m))return 'A palavra-passe é demasiado fraca (mínimo 8 caracteres).';
    if(/rate limit|too many/i.test(m))return 'Demasiadas tentativas. Espera uns minutos e tenta outra vez.';
    if(/not authorized|Email address .* is invalid/i.test(m))return 'Não foi possível enviar email para este endereço. Fala com quem gere a app.';
    if(/Código inválido/.test(m))return 'Código inválido. Confirma as letras e números.';
    if(/já tem duas pessoas/.test(m))return 'Este cofre já tem duas pessoas.';
    if(/Já pertences a um cofre/.test(m))return 'Esta conta já pertence a um cofre.';
    if(/fetch|network/i.test(m))return 'Sem ligação à internet.';
    return m;
  }
  const field=(id,label,type='text',extra='')=>`<div class="field"><label for="${id}">${label}</label><input class="inp" id="${id}" type="${type}" ${extra}></div>`;
  function form(html,onSubmit){
    const f=G().querySelector('form');
    f.onsubmit=async ev=>{ev.preventDefault();const btn=f.querySelector('button[type=submit]');const err=f.querySelector('.err');err.textContent='';btn.disabled=true;
      try{await onSubmit(f,err)}catch(e){err.textContent=ptErr(e)}finally{btn.disabled=false}};
  }

  function showAuth(mode='login',msg=''){
    const t={login:['Entrar','Entrar'],signup:['Criar conta','Criar conta'],forgot:['Recuperar palavra-passe','Enviar email']}[mode];
    gate(`<div class="card"><h2 style="margin:0 0 4px">${t[0]}</h2>
      <p class="muted" style="margin:0 0 14px;font-size:14px">${mode==='signup'?'Cada um de vocês cria a sua conta.':mode==='forgot'?'Enviamos-te um email com um link para definires uma nova palavra-passe.':'As finanças do casal, em conjunto.'}</p>
      ${msg?`<div class="preview" style="margin:0 0 12px">${msg}</div>`:''}
      <form novalidate>
        ${field('em','Email','email','autocomplete="email" required')}
        ${mode!=='forgot'?field('pw','Palavra-passe','password',`autocomplete="${mode==='signup'?'new-password':'current-password'}" minlength="8" required`):''}
        <div class="err"></div>
        <button class="btn primary" type="submit" style="width:100%;padding:12px">${t[1]}</button>
      </form>
      <div class="gate-links">
        ${mode!=='login'?'<a href="#" data-m="login">Já tenho conta</a>':'<a href="#" data-m="signup">Criar conta</a>'}
        ${mode==='login'?'<a href="#" data-m="forgot">Esqueci-me da palavra-passe</a>':''}
      </div></div>`);
    G().querySelectorAll('[data-m]').forEach(a=>a.onclick=ev=>{ev.preventDefault();showAuth(a.dataset.m)});
    form('',async(f,err)=>{
      const email=f.em.value.trim(),pw=f.pw&&f.pw.value;
      if(!/^\S+@\S+\.\S+$/.test(email)){err.textContent='Email inválido.';return}
      if(mode!=='forgot'&&(!pw||pw.length<8)){err.textContent='A palavra-passe tem de ter pelo menos 8 caracteres.';return}
      const redirect=location.origin+location.pathname;
      if(mode==='login'){const{data,error}=await sb.auth.signInWithPassword({email,password:pw});if(error)throw error;await enter(data.user)}
      else if(mode==='signup'){const{data,error}=await sb.auth.signUp({email,password:pw,options:{emailRedirectTo:redirect}});if(error)throw error;
        if(data.session)await enter(data.user);else showAuth('login','📧 Conta criada. Confirma o email (vê a caixa de correio e o spam) e depois entra aqui.')}
      else{const{error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:redirect});if(error)throw error;showAuth('login','📧 Se existir uma conta com esse email, vais receber um link para mudar a palavra-passe.')}
    });
  }
  function showNewPassword(){
    gate(`<div class="card"><h2 style="margin:0 0 12px">Nova palavra-passe</h2><form novalidate>
      ${field('pw','Nova palavra-passe','password','autocomplete="new-password" minlength="8"')}
      <div class="err"></div><button class="btn primary" type="submit" style="width:100%;padding:12px">Guardar</button></form></div>`);
    form('',async(f,err)=>{if(f.pw.value.length<8){err.textContent='Mínimo 8 caracteres.';return}
      const{data,error}=await sb.auth.updateUser({password:f.pw.value});if(error)throw error;toast('Palavra-passe alterada');await enter(data.user)});
  }
  function showOnboarding(){
    gate(`<div class="card"><h2 style="margin:0 0 4px">Bem-vindo(a)! 👋</h2>
      <p class="muted" style="margin:0 0 14px;font-size:14px">Um de vocês cria o cofre; o outro entra com o código que aparece a seguir.</p>
      <form novalidate>
        ${field('nm','O teu nome','text','maxlength="40" autocomplete="given-name"')}
        <div class="field"><div class="lab" style="font-size:12.5px;font-weight:600;color:var(--ink2);margin-bottom:5px">O que queres fazer?</div>
          <div class="seg"><label><input type="radio" name="op" value="create" checked><span>Criar o cofre</span></label><label><input type="radio" name="op" value="join"><span>Entrar com código</span></label></div></div>
        <div id="codeBox" class="hidden">${field('cd','Código do cofre','text','maxlength="6" autocapitalize="characters" style="letter-spacing:.15em;text-transform:uppercase"')}</div>
        <div class="err"></div>
        <button class="btn primary" type="submit" style="width:100%;padding:12px">Continuar</button>
      </form>
      <div class="gate-links"><a href="#" id="out">Terminar sessão</a></div></div>`);
    const f=G().querySelector('form');
    f.addEventListener('change',()=>G().querySelector('#codeBox').classList.toggle('hidden',f.op.value!=='join'));
    G().querySelector('#out').onclick=ev=>{ev.preventDefault();signOut()};
    form('',async(f,err)=>{
      const name=f.nm.value.trim();if(!name){err.textContent='Escreve o teu nome.';return}
      if(f.op.value==='create'){const{error}=await sb.rpc('create_household',{p_display_name:name});if(error)throw error}
      else{const code=f.cd.value.trim().toUpperCase();if(code.length!==6){err.textContent='O código tem 6 caracteres.';return}
        const{error}=await sb.rpc('join_household',{p_code:code,p_display_name:name});if(error)throw error}
      const{data:{user}}=await sb.auth.getUser();await enter(user);
    });
  }

  /* ---------------- entrar na app ---------------- */
  async function enter(user){
    if(!user)return showAuth();
    loading();
    try{
      const{data:m,error}=await sb.from('members').select('household_id,slot').eq('user_id',user.id).maybeSingle();
      if(error)throw error;
      if(!m)return showOnboarding();
      const{data:h,error:e2}=await sb.from('households').select('id,name,invite_code').eq('id',m.household_id).single();
      if(e2)throw e2;
      S={household:h,viewer:m.slot,email:user.email,users:{}};
      KINDS.forEach(([a])=>S[a]=[]);
      await loadData();
      if(!S.categories.length)S.categories=DEFAULT_CATEGORIES.map((c,i)=>({...c,sort:i}));
      signature=sig();
      generate();genIncome();
      ungate();render();persistSoon();subscribe();
    }catch(e){
      console.error(e);
      gate(`<div class="card"><p>Não foi possível abrir o cofre: ${esc(ptErr(e))}</p><button class="btn primary" onclick="location.reload()">Tentar outra vez</button></div>`);
    }
  }
  async function signOut(){
    try{if(S&&S.household)await persist()}catch(e){}
    if(channel){sb.removeChannel(channel);channel=null}
    S=null;snap=new Map();
    await sb.auth.signOut();
    location.hash='';showAuth();
  }
  async function saveName(v){
    const{data:{user}}=await sb.auth.getUser();
    const{error}=await sb.from('members').update({display_name:v}).eq('user_id',user.id);
    if(error)return toast('Não foi possível guardar o nome');
    S.users[S.viewer]={name:v};render();toast('Nome guardado');
  }

  async function boot(){
    applyTheme();
    if(!configured){gate('<div class="card"><p><b>Falta configurar a ligação ao Supabase.</b></p><p class="muted">Preenche <code>js/config.js</code> com o URL e a chave pública do projeto.</p></div>');return}
    loading();
    sb.auth.onAuthStateChange((ev,session)=>{
      if(ev==='PASSWORD_RECOVERY')setTimeout(showNewPassword,0);
      else if(ev==='SIGNED_OUT'&&S){S=null;showAuth()}
    });
    if(/type=recovery/.test(location.hash))return; // o evento PASSWORD_RECOVERY trata disto
    const{data:{session}}=await sb.auth.getSession();
    if(!session)return showAuth();
    await enter(session.user);
  }

  window.Cloud={sb,persistSoon,persist,refresh,afterSheetClosed,signOut,saveName};
  boot();
})();
