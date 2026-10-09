import {isAmountDiscount,amountDiscountTotal,MODES,BODY_TYPES,PAYMENT_METHODS,normalizePaymentDetails,paymentDetailsMissing,initialState,validateState,validateTruck,validateDiscount,draft,period,periodLabel,dateLabel,days,overlaps,round,money,today,uid,csv,amountLabel,parseAmount,dateRangeError,validDate,periodClosings,farmClosing,openFarmIds,periodRows,closingPreview,saveClosing,reopenClosing,discountLocked,shiftDate,previewTransfer,transferTruck,latestTruck,previewEndActivities,endActivities,applyFixedMonthlyRule,farmHasLinks,removeFarm,setFarmActive} from './engine.js?v=59';
import {createReport,reportMarkup} from './reports.js?v=59';
import {cloud,authErrorMessage} from './cloud-ui.js?v=59';

let state=initialState(),loadError='',currentUser=null,currentCompany=null,serverRevision=0,saving=false,stale=false,farmDraftDirty=false,inviteInfo=null,inviteSignin=false;
let inviteTicket=location.hash.startsWith('#activate=')?location.hash.slice(10):null;
let portalRequests=[],portalPeriod='',portalFarm='',portalSearch='';
let cteDocuments=[],cteTrucks=[],cteFarms=[],cteFarmFilter='',cteColumnFilters={},cteFilterFieldOpen='',cteFilterDraft=[],cteFilterOptions=[],cteFilterSearch='',cteFilterAnchor={top:0,left:0},cteLoading=false,ctePreferences={visibleColumns:[],columnOrder:[]},ctePreferenceDraft=null;
const formatCteDocument=(value,type)=>{const digits=String(value||'').replace(/\D/g,'');if(type==='cnpj'&&digits.length===14)return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5');if(type==='cpf'&&digits.length===11)return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/,'$1.$2.$3-$4');return value||'—';};
const cteParticipant=(doc,party,key)=>key==='cnpj'||key==='cpf'?formatCteDocument(doc.participantDetails?.[party]?.[key],key):doc.participantDetails?.[party]?.[key]||'—';
const cteParticipantDocument=(doc,party)=>{const cnpj=cteParticipant(doc,party,'cnpj');return cnpj==='—'?cteParticipant(doc,party,'cpf'):cnpj;};
const CTE_FILTER_FIELDS={number:{label:'Número do CT-e',get:doc=>doc.number||'—'},shipper:{label:'Remetente',get:doc=>doc.shipper||'—'},recipient:{label:'Destinatário',get:doc=>doc.recipient||'—'},serviceTaker:{label:'Tomador do serviço',get:doc=>doc.serviceTaker||'—'},issuer:{label:'Transportadora',get:doc=>doc.issuer||'—'},totalValue:{label:'Valor do serviço',get:doc=>money(doc.totalValue||0)},issuedOn:{label:'Data de emissão',get:doc=>dateLabel(doc.issuedOn)},plate:{label:'Placa',get:doc=>doc.plate||'—'},manifestedNotes:{label:'Notas fiscais manifestadas',get:doc=>(doc.manifestedNotes||[]).join(', ')||'—'},shipperCity:{label:'Cidade do remetente',get:doc=>cteParticipant(doc,'shipper','city')},shipperStateRegistration:{label:'IE do remetente',get:doc=>cteParticipant(doc,'shipper','stateRegistration')},shipperDocument:{label:'CPF/CNPJ do remetente',get:doc=>cteParticipantDocument(doc,'shipper')},recipientCity:{label:'Cidade do destinatário',get:doc=>cteParticipant(doc,'recipient','city')},recipientStateRegistration:{label:'IE do destinatário',get:doc=>cteParticipant(doc,'recipient','stateRegistration')},recipientDocument:{label:'CPF/CNPJ do destinatário',get:doc=>cteParticipantDocument(doc,'recipient')},serviceTakerCity:{label:'Cidade do tomador',get:doc=>cteParticipant(doc,'serviceTaker','city')},serviceTakerStateRegistration:{label:'IE do tomador',get:doc=>cteParticipant(doc,'serviceTaker','stateRegistration')},serviceTakerDocument:{label:'CPF/CNPJ do tomador',get:doc=>cteParticipantDocument(doc,'serviceTaker')},issuerCity:{label:'Cidade da transportadora',get:doc=>cteParticipant(doc,'issuer','city')},issuerStateRegistration:{label:'IE da transportadora',get:doc=>cteParticipant(doc,'issuer','stateRegistration')},issuerDocument:{label:'CPF/CNPJ da transportadora',get:doc=>cteParticipantDocument(doc,'issuer')}};
const DEFAULT_CTE_COLUMNS=['number','shipper','recipient','serviceTaker','issuer','totalValue','issuedOn','plate'],ALL_CTE_COLUMNS=Object.keys(CTE_FILTER_FIELDS);
const isCarrier=()=>currentUser?.party==='carrier';
const canOperate=()=>['admin','operator'].includes(currentUser?.role);
let currentMonth=today().slice(0,7), currentHalf=Number(today().slice(8))<=15?1:2, farmFilter='',search='',view='overview',toastTimer;
const main=document.querySelector('#main'),modal=document.querySelector('#modal'),modalContent=document.querySelector('#modal-content');
const e=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const opt=(v,label,selected)=>`<option value="${e(v)}" ${String(v)===String(selected)?'selected':''}>${e(label)}</option>`;
function formatPaymentDocument(value){
  const digits=String(value||'').replace(/\D/g,'');
  if(digits.length===11)return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/,'$1.$2.$3-$4');
  if(digits.length===14)return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5');
  return String(value||'');
}
function formatPaymentDocumentInput(value){
  const digits=String(value||'').replace(/\D/g,'').slice(0,14);
  if(digits.length<=11)return digits.replace(/^(\d{3})(\d)/,'$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/,'$1.$2.$3').replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/,'$1.$2.$3-$4');
  return digits.replace(/^(\d{2})(\d)/,'$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/,'$1.$2.$3').replace(/^(\d{2})\.(\d{3})\.(\d{3})(\d)/,'$1.$2.$3/$4').replace(/^(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})(\d)/,'$1.$2.$3/$4-$5');
}
function documentCaret(value,digitCount){
  let position=0,seen=0;
  while(position<value.length&&seen<digitCount){if(/\d/.test(value[position]))seen++;position++;}
  return position;
}
function maskPaymentDocumentInput(input){
  const digitCount=String(input.value).slice(0,input.selectionStart??input.value.length).replace(/\D/g,'').length;
  const formatted=formatPaymentDocumentInput(input.value);
  if(input.value===formatted)return;
  input.value=formatted;
  const position=documentCaret(formatted,Math.min(digitCount,14));
  input.setSelectionRange?.(position,position);
}
// Números-código do Banco Central: https://www.bcb.gov.br/content/estabilidadefinanceira/str1/ParticipantesSTR.pdf
const BANKS=[
  ['001','Banco do Brasil'],['003','Banco da Amazônia'],['004','Banco do Nordeste'],
  ['021','Banestes'],['033','Santander'],['041','Banrisul'],['070','BRB'],
  ['077','Banco Inter'],['104','Caixa Econômica Federal'],['133','Cresol'],
  ['136','Unicred'],['208','BTG Pactual'],['237','Bradesco'],
  ['260','Nubank'],['290','PagBank'],['318','Banco BMG'],['336','C6 Bank'],
  ['341','Itaú Unibanco'],['389','Banco Mercantil'],['413','Banco BV'],
  ['422','Banco Safra'],['623','Banco PAN'],['748','Sicredi'],['756','Sicoob']
];
const farmOptions=(selected,activeOnly=false)=>state.farms.filter(f=>!activeOnly||f.active!==false||f.id===selected).map(f=>opt(f.id,f.name+(f.active===false?' (Inativa)':''),selected)).join('');
const farmField=(farm,index)=>{const saved=state.farms.find(f=>f.id===farm.id),inactive=saved?.active===false,action=inactive?'reactivate-farm':saved&&farmHasLinks(state,farm.id)?'inactivate-farm':'remove-farm',label=inactive?'Reativar':action==='inactivate-farm'?'Inativar':'Remover';return `<div class="farm-input-row"><span class="index">${String(index+1).padStart(2,'0')}</span><input aria-label="Nome da fazenda ${index+1}" name="${e(farm.id)}" data-farm-id="${e(farm.id)}" value="${e(farm.name)}" maxlength="80" required><div class="farm-actions">${inactive?'<span class="badge gray">Inativa</span>':''}<button class="btn small ${action==='remove-farm'?'danger':''}" type="button" data-action="${action}" data-id="${e(farm.id)}" aria-label="${label} ${e(farm.name)||'nova fazenda'}">${label}</button></div></div>`;};
function addFarmInput() {farmDraftDirty=true;
  const form=document.querySelector('#farms-form'),id=uid(),index=form.querySelectorAll('[data-farm-id]').length;
  document.querySelector('#farm-fields').insertAdjacentHTML('beforeend',farmField({id,name:''},index));
  form.querySelector(`[data-farm-id="${id}"]`).focus();
}
function requestFarmAction(id,inactivate=false) {
  const farm=state.farms.find(f=>f.id===id);
  if(!farm){const form=document.querySelector('#farms-form');form?.querySelector(`[data-farm-id="${id}"]`)?.closest('.farm-input-row')?.remove();form?.querySelectorAll('[data-farm-id]').forEach((input,index)=>{const number=input.closest?.('.farm-input-row')?.querySelector('.index');if(number)number.textContent=String(index+1).padStart(2,'0');input.setAttribute?.('aria-label','Nome da fazenda '+(index+1));});return;}
  if(inactivate||farmHasLinks(state,id))confirmation('Inativar '+farm.name+'?','Esta fazenda ficará fora de novos cadastros e transferências. Os contratos, descontos e pagamentos existentes continuam no controle.','confirm-inactivate-farm',id);
  else confirmation('Remover '+farm.name+'?','Esta fazenda não tem caminhões nem fechamentos vinculados e será removida da lista.','confirm-remove-farm',id);
}
async function applyFarmAction(id,action) {
  const form=document.querySelector('#farms-form'),drafts=form?[...form.querySelectorAll('[data-farm-id]')].map(input=>({id:input.dataset.farmId,name:input.value})):[];
  await remoteCommand(action==='remove'?'farm.remove':'farm.status',action==='remove'?{id}:{id,active:action==='reactivate'});
  if(action==='remove'&&farmFilter===id)farmFilter='';modal.close();render();
  if(view==='settings'){
    const list=state.farms.map(f=>({...f,name:drafts.find(d=>d.id===f.id)?.name??f.name}));
    list.push(...drafts.filter(d=>!state.farms.some(f=>f.id===d.id)&&!(action==='remove'&&d.id===id)));
    document.querySelector('#farm-fields').innerHTML=list.map(farmField).join('');
  }
  notify(action==='remove'?'Fazenda removida.':action==='reactivate'?'Fazenda reativada.':'Fazenda inativada. O histórico foi preservado.');
}
const currentPeriod=()=>period(currentMonth,currentHalf);
const selectedClosings=()=>periodClosings(state,currentPeriod()).filter(c=>!farmFilter||c.farmIds.includes(farmFilter));
const closing=()=>{
  if(periodRows(state,currentPeriod()).some(r=>!r.closed&&(!farmFilter||r.farmId===farmFilter)))return null;
  if(farmFilter)return farmClosing(state,currentPeriod(),farmFilter);
  const cs=selectedClosings();
  if(!cs.length)return null;
  return {...cs[0],closedDate:cs.map(c=>c.closedDate).sort().at(-1),rows:cs.flatMap(c=>c.rows)};
};
const rows=()=>periodRows(state,currentPeriod());
const canCloseFarm=id=>openFarmIds(state,currentPeriod()).includes(id);
const rowClosing=id=>periodClosings(state,currentPeriod()).find(c=>c.rows.some(r=>r.truckId===id));
const closingNames=c=>c.farmIds.map(id=>c.rows.find(r=>r.farmId===id)?.farmName||state.farms.find(f=>f.id===id)?.name||'Fazenda').join(' · ');
const rowRules=r=>r.calculationSettings||rowClosing(r.truckId)?.settings||state.settings;
const selectedRules=()=>[...new Set(filteredRows().map(r=>rowRules(r).mode))];
const historyRuleTitle=c=>{const modes=[...new Set(c.rows.map(r=>(r.calculationSettings||c.settings).mode))];return modes.length>1?'Regras preservadas por lançamento':MODES[modes[0]||c.settings.mode];};
const ruleTitle=()=>selectedRules().length>1?'Regras diferentes por fazenda':MODES[selectedRules()[0]||state.settings.mode];
const ruleBody=()=>selectedRules().length>1?'Cada fechamento mantém sua própria regra. Consulte os detalhes de cada caminhão para conferir a diária utilizada.':ruleDescription({...state.settings,mode:selectedRules()[0]||state.settings.mode},currentPeriod());
const filteredRows=()=>rows().filter(r=>!farmFilter||r.farmId===farmFilter);
const uniquePlates=list=>new Set(list.map(r=>r.plate)).size;
const sum=(list,key)=>round(list.reduce((n,r)=>n+(r[key]||0),0));
function notify(message) { const el=document.querySelector('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),4500); }
async function remoteCommand(type,payload) {
  if(!currentUser)throw Error('Faça login antes de alterar os registros.');
  if(saving)throw Error('Aguarde o salvamento em andamento.');
  saving=true;document.body.classList.add('saving');
  try { const saved=await cloud.execute(type,payload,serverRevision);adoptServerData(saved);stale=false; }
  catch(error){if(error.status===409){stale=true;updateCloudStatus();}throw error;}
  finally {saving=false;document.body.classList.remove('saving');}
}
function adoptServerData(data) {
  if(data.user)currentUser=data.user;if(data.company)currentCompany=data.company;
  if(isCarrier()){state=initialState();portalRequests=data.requests||[];}else{state=applyFixedMonthlyRule(validateState(data.state));portalRequests=state.paymentRequests;}
  serverRevision=data.revision;loadError='';updateCloudStatus();
}
function updateCloudStatus() {
  const label=document.querySelector('#cloud-status');if(label)label.textContent=stale?'Há novas alterações. Atualize os dados.':saving?'Salvando no servidor…':'Dados salvos no banco online';
  const company=document.querySelector('#company-label');if(company)company.textContent=currentCompany?.name||'Frota';
  const account=document.querySelector('#account-label');if(account)account.textContent=currentUser?(currentUser.email+' · '+(isCarrier()?'Transportadora':'Grupo das fazendas')):'';
}
async function refreshServerData({automatic=false}={}) {
  if(saving)return false;
  const data=await cloud.load();
  if(automatic&&(saving||modal.open||reportDialog.open||farmDraftDirty)){stale=true;updateCloudStatus();return false;}
  adoptServerData(data);stale=false;farmDraftDirty=false;
  if(!automatic){modal.close();reportDialog.close();}
  render();updateCloudStatus();return true;
}
function renderAccess() {
  document.body.classList.add('logged-out');
  const ready=inviteTicket&&inviteInfo;
  main.innerHTML=`<div class="login-page"><section class="auth-card"><div class="auth-brand">frota<span>.</span></div><h1>${ready?inviteSignin?'Aceitar acesso':'Configurar seu acesso':'Entrar no sistema'}</h1><p>${ready?e(inviteInfo.companyName):'Acesse os registros da empresa, salvos no banco online.'}</p><form id="access-form" class="auth-form">${errBox()}${ready&&inviteInfo.firstAccess?'<div class="field"><label for="access-company">Nome da empresa</label><input id="access-company" name="companyName" maxlength="120" required autocomplete="organization"></div>':''}<div class="field"><label for="access-email">E-mail</label><input id="access-email" name="email" type="email" value="${e(ready?inviteInfo.email:'')}" ${ready&&inviteInfo.email?'readonly':''} required autocomplete="username"></div><div class="field"><label for="access-password">Senha</label><input id="access-password" name="password" type="password" required ${ready&&!inviteSignin?'minlength="6"':''} autocomplete="${ready&&!inviteSignin?'new-password':'current-password'}">${ready&&!inviteSignin?'<small>Use pelo menos 6 caracteres. A senha é definida aqui.</small>':''}</div><button class="btn primary" type="submit" ${inviteTicket&&!ready?'disabled':''}>${ready&&!inviteSignin?'Criar acesso':'Entrar'}</button>${ready?`<button type="button" class="btn ghost" data-action="auth-switch">${inviteSignin?'Criar uma nova conta':'Já tenho uma conta'}</button>`:''}</form>${inviteTicket&&!ready?'<p id="invite-message" class="auth-help">Conferindo o link de acesso…</p>':'<p class="auth-help">O administrador da empresa libera os usuários e seus perfis de acesso.</p>'}</section></div>`;
}
const accessProfiles=[['group:operator','Grupo — cadastros, fechamentos e solicitações'],['carrier:operator','Transportadora — pagamentos com comprovante'],['group:viewer','Grupo — somente consulta'],['carrier:viewer','Transportadora — somente consulta'],['group:admin','Administrador do grupo — equipe e configurações']];
const profileOptions=value=>accessProfiles.map(([key,label])=>opt(key,label,value)).join('');
async function loadTeam() {
  if(currentUser?.role!=='admin'||isCarrier())return;const box=document.querySelector('#team-list');if(!box)return;
  try{const data=await cloud.team();box.innerHTML=data.members.map(member=>`<div class="team-row"><div><strong>${e(member.email)}</strong><span class="secondary">${member.party==='carrier'?'Transportadora':'Grupo das fazendas'} · ${member.active?'Ativo':'Inativo'}</span></div><div class="team-controls"><select aria-label="Acesso de ${e(member.email)}" data-member-profile data-id="${e(member.user_id)}" data-active="${member.active}">${profileOptions((member.party||'group')+':'+member.role)}</select><button type="button" class="btn small" data-action="member-status" data-id="${e(member.user_id)}" data-role="${e(member.role)}" data-party="${e(member.party||'group')}" data-active="${member.active?'false':'true'}">${member.active?'Inativar':'Reativar'}</button></div></div>`).join('');}catch(error){box.textContent=authErrorMessage(error);}
}
function teamSettings(){return currentUser?.role==='admin'&&!isCarrier()?`<section class="card"><div class="card-header"><div><h2>Equipe e acesso</h2><p>O grupo acessa todas as suas fazendas. A transportadora recebe as solicitações e comprova os pagamentos.</p></div></div><div class="form-content"><div id="team-list">Carregando usuários…</div><form id="invite-form" style="margin-top:20px">${errBox()}<div class="field"><label>E-mail do funcionário</label><input name="email" type="email" required></div><div class="field"><label>Perfil de acesso</label><select name="profile">${profileOptions('group:operator')}</select></div><button class="btn primary" type="submit">Enviar convite por e-mail</button></form><div id="invite-result"></div></div></section>`:'';}

function download(data,type,name) {const u=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
function openModal(title,subtitle,body,{wide=false}={}) {modal.classList.toggle('wide-modal',wide);modalContent.innerHTML=`<div class="modal-head"><div><h2 id="modal-title">${e(title)}</h2><p>${e(subtitle)}</p></div><button class="close-modal" data-action="close-modal" aria-label="Fechar janela">×</button></div><div class="modal-body">${body}</div>`;if(!modal.open)modal.showModal();}
const errBox=()=>'<div class="form-error" role="alert"></div>';
function formError(form,message) {const box=form.querySelector('.form-error');if(box){box.textContent=message;box.classList.add('visible');box.scrollIntoView({block:'nearest'});}else notify(message);}
const paymentStatus=row=>row.paid?'Pago':row.closed?'Fechado':'Aberto';
function badge(row) {const status=paymentStatus(row),color=status==='Pago'?'green':status==='Fechado'?'amber':'gray';return `<span class="badge ${color}"><i></i>${status}</span>`;}
function head(title,subtitle,actions='',eyebrow='PAGAMENTOS QUINZENAIS') {return `<div class="page-head"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${subtitle}</p></div><div class="actions">${actions}</div></div>`;}
function periodBar(includeFarm=true,monthAria='Mês do fechamento') {const p=currentPeriod();return `<div class="period-bar"><div class="period-controls"><label for="period-month">Competência</label><input type="month" id="period-month" aria-label="${e(monthAria)}" value="${e(currentMonth)}"><div class="segmented" aria-label="Selecionar quinzena"><button data-action="half" data-half="1" class="${currentHalf===1?'selected':''}" aria-pressed="${currentHalf===1}">1ª quinzena</button><button data-action="half" data-half="2" class="${currentHalf===2?'selected':''}" aria-pressed="${currentHalf===2}">2ª quinzena</button></div>${includeFarm?`<select id="farm-filter" aria-label="Filtrar por fazenda">${opt('','Todas as fazendas',farmFilter)}${farmOptions(farmFilter)}</select>`:''}</div><div class="period-caption">${e(periodLabel(p))}</div></div>`;}
function ruleNotice() {
  if(loadError)return `<div class="notice">${e(loadError)}<a href="#settings">Recuperar registros</a></div>`;
  if(!state.settings.confirmed && !closing())return `<div class="notice"><span><strong>Regra provisória para o teste:</strong> mensal ÷ 30, contando os dias de entrada e saída. Confira antes de fechar.</span><a href="#settings">Definir regra de cálculo</a></div>`;
  if(filteredRows().some(r=>r.paid&&rowRules(r).mode!=='half'))return `<div class="notice neutral"><span><strong>Regra mensal fixa ativa.</strong> Os pagamentos já registrados com a regra anterior permanecem no histórico. Os cálculos sem pagamento usam metade do mensal por quinzena completa.</span></div>`;
  const cs=selectedClosings(),late=filteredRows().filter(r=>!r.closed&&r.complementary);
  if(late.length)return `<div class="notice neutral"><span><strong>${late.length} placa(s) pendente(s) de fechamento complementar.</strong> Os fechamentos e pagamentos anteriores estão preservados. Feche somente as novas placas.</span><a href="#closings">Fechar pendências</a></div>`;
  if(!farmFilter&&cs.length&&!closing())return `<div class="notice neutral"><span><strong>Fechamento por fazenda:</strong> ${periodClosings(state,currentPeriod()).reduce((ids,c)=>{c.farmIds.forEach(id=>ids.add(id));return ids;},new Set()).size} fazenda(s) fechada(s), ${openFarmIds(state,currentPeriod()).length} em aberto. As prévias das demais continuam atualizando.</span><a href="#closings">Ver fechamentos</a></div>`;
  return '';
}
function truckTable(list) {
  if(!list.length)return `<div class="empty"><div class="empty-icon">▤</div><h3>${state.trucks.length?'Nenhum caminhão neste período':'Sua primeira quinzena começa aqui'}</h3><p>${state.trucks.length?'Ajuste o mês ou a fazenda para ver os caminhões contratados.':'Cadastre uma placa, informe o valor mensal e a data de início. Ou use os exemplos para conhecer o controle.'}</p><div class="actions" style="justify-content:center"><button class="btn primary" data-action="new-truck">+ Cadastrar caminhão</button>${!state.trucks.length?'<button class="btn" data-action="demo">Testar com exemplos</button>':''}</div></div>`;
  return `<div class="table-wrap"><table><thead><tr><th>CAMINHÃO / MOTORISTA</th><th>FAZENDA</th><th class="num">DIAS NO PERÍODO</th><th class="num">DESCONTOS</th><th class="num">VALOR LÍQUIDO</th><th>SITUAÇÃO</th><th></th></tr></thead><tbody>${list.map(r=>`<tr><td><span class="plate">${e(r.plate)}</span><span class="secondary">${e(r.driver)}</span></td><td>${e(r.farmName)}<span class="secondary">${e(r.carrier)}</span></td><td class="num">${r.eligibleDays}<span class="secondary">${dateLabel(r.start).slice(0,5)} a ${dateLabel(r.end).slice(0,5)}</span></td><td class="num discount-color">${r.discount?money(r.discount):'—'}<span class="secondary">${r.discount?[r.discountDays?r.discountDays+' dia(s)':'',amountDiscountTotal(r)?'Por valor':''].filter(Boolean).join(' + '):'Sem desconto'}</span></td><td class="num value">${money(r.net)}<span class="secondary">${r.payableDays} dia(s) a pagar</span></td><td>${badge(r)}${r.requestId&&!r.paid?'<span class="secondary">Solicitado à transportadora</span>':''}</td><td><button class="btn small ghost" data-action="detail" data-id="${e(r.truckId)}">Detalhes</button></td></tr>`).join('')}</tbody></table></div>`;
}
function overviewData(month=currentMonth,selectedFarm=farmFilter,now=today(),half=currentHalf) {
  const selectedPeriod=period(month,half),start=selectedPeriod.start,end=selectedPeriod.end,reference=now<start?start:now>end?end:now;
  const assignments=state.trucks.filter(t=>(!selectedFarm||t.farmId===selectedFarm)&&overlaps(t.start,t.end||'9999-12-31',start,end));
  const active=assignments.filter(t=>t.start<=reference&&(!t.end||t.end>=reference));
  const entries=assignments.filter(t=>!t.transferIn&&t.start>=start&&t.start<=end);
  const endings=assignments.filter(t=>!t.transferOut&&t.end&&t.end>=start&&t.end<=end);
  const transfers=assignments.filter(t=>t.transferOut&&t.transferOut.date>=start&&t.transferOut.date<=end);
  const rows=periodRows(state,selectedPeriod).filter(r=>!selectedFarm||r.farmId===selectedFarm);
  const fleet=[...new Map(assignments.slice().sort((a,b)=>a.start.localeCompare(b.start)).map(t=>[t.plate,t])).values()];
  const types={Caçamba:0,Graneleiro:0,'A informar':0},axles={7:0,9:0,other:0};
  for(const t of fleet){types[BODY_TYPES.includes(t.bodyType)?t.bodyType:'A informar']++;axles[t.axles===7?7:t.axles===9?9:'other']++;}
  const events=[...entries.map(t=>({plate:t.plate,date:t.start,label:'Entrada',text:state.farms.find(f=>f.id===t.farmId)?.name||'Fazenda'})),...endings.map(t=>({plate:t.plate,date:t.end,label:'Encerramento',text:state.farms.find(f=>f.id===t.farmId)?.name||'Fazenda'})),...transfers.map(t=>({plate:t.plate,date:t.transferOut.date,label:'Transferência',text:(state.farms.find(f=>f.id===t.farmId)?.name||'Fazenda')+' para '+t.transferOut.toFarmName}))];
  events.sort((a,b)=>Number(a.date>now)-Number(b.date>now)||(a.date>now?a.date.localeCompare(b.date):b.date.localeCompare(a.date))||a.plate.localeCompare(b.plate));
  const paid=sum(rows.filter(r=>r.paid),'net'),waiting=sum(rows.filter(r=>r.closed&&!r.paid),'net'),open=sum(rows.filter(r=>!r.closed),'net');
  const farms=state.farms.filter(f=>(!selectedFarm||f.id===selectedFarm)&&(f.active!==false||assignments.some(t=>t.farmId===f.id)||rows.some(r=>r.farmId===f.id)||f.id===selectedFarm)).map(f=>({...f,activeTrucks:uniquePlates(active.filter(t=>t.farmId===f.id)),periodTrucks:uniquePlates(assignments.filter(t=>t.farmId===f.id))}));
  return {start,end,reference,referenceLabel:now<start?'Previstos no início da quinzena':now>end?'Ativos no fim da quinzena':'Em atividade hoje',periodTrucks:fleet.length,activeTrucks:uniquePlates(active),entries:entries.length,scheduledEntries:entries.filter(t=>t.start>now).length,endings:endings.length,scheduledEndings:endings.filter(t=>t.end>now).length,types,axles,events,farms,paid,waiting,open,gross:sum(rows,'gross'),total:sum(rows,'net'),discounts:sum(rows,'discount')};
}
function overview() {
  const d=overviewData(),eventList=d.events.slice(0,8);
  const recovery=loadError?`<div class="notice"><span>${e(loadError)}</span><a href="#settings">Recuperar registros</a></div>`:'';
  const metrics=[['Caminhões na quinzena',d.periodTrucks,'Placas com contrato nesta quinzena'],[d.referenceLabel,d.activeTrucks,'Situação em '+dateLabel(d.reference)],['Entradas na quinzena',d.entries,d.scheduledEntries?d.scheduledEntries+' entrada(s) agendada(s)':'Novos períodos de serviço'],['Encerramentos na quinzena',d.endings,d.scheduledEndings?d.scheduledEndings+' encerramento(s) agendado(s)':'Serviços concluídos na quinzena']];
  return head('Visão geral','O resumo da sua frota e dos pagamentos da quinzena.','<a class="btn" href="#trucks">Ver caminhões</a><button class="btn primary" data-action="new-truck">+ Cadastrar caminhão</button>','RESUMO DA FROTA')+
    periodBar(true,'Mês da visão geral')+recovery+
    `<div class="metric-grid overview-metrics">${metrics.map(([label,value,note],index)=>`<div class="metric ${index===0?'featured':''}"><div class="metric-label">${index===0?'<span class="dot"></span>':''}${e(label)}</div><div class="metric-value">${value}</div><div class="metric-note">${e(note)}</div></div>`).join('')}</div>`+
    `<section class="card"><div class="card-header"><div><h2>Resumo financeiro da quinzena</h2><p>Prévia dos valores em aberto e fechamentos salvos nesta quinzena.</p></div><a class="btn small" href="#closings">Ir para Fechamentos →</a></div><div class="overview-finance"><div class="overview-finance-total"><span class="finance-dot spacer" aria-hidden="true"></span><span>Total bruto</span><strong>${money(d.gross)}</strong></div><div class="overview-finance-item overview-finance-net"><span class="finance-dot spacer" aria-hidden="true"></span><span>Líquido após descontos</span><strong>${money(d.total)}</strong></div><div class="overview-finance-item"><span class="finance-dot paid"></span><span>Pago</span><strong>${money(d.paid)}</strong></div><div class="overview-finance-item"><span class="finance-dot waiting"></span><span>Fechado, aguardando pagamento</span><strong>${money(d.waiting)}</strong></div><div class="overview-finance-item"><span class="finance-dot open"></span><span>Em aberto</span><strong>${money(d.open)}</strong></div><a class="overview-finance-item overview-discounts-link" href="#discounts" aria-label="Ver descontos totais da quinzena: ${e(money(d.discounts))}"><span class="finance-dot discount"></span><span>Descontos totais</span><strong>${money(d.discounts)}</strong><small>Ver descontos →</small></a></div></section>`+
    `<div class="overview-columns"><section class="card"><div class="card-header"><div><h2>Caminhões por fazenda</h2><p>Situação em ${dateLabel(d.reference)} · ${d.activeTrucks} caminhão(ões) em atividade</p></div></div><div class="overview-farms">${d.farms.length?d.farms.map(f=>`<div class="overview-farm-row"><div class="overview-farm-label"><strong>${e(f.name)}${f.active===false?' <span class="badge gray">Inativa</span>':''}</strong><span>${f.activeTrucks} em atividade</span></div><div class="overview-bar" aria-hidden="true"><span style="width:${d.activeTrucks?Math.round(f.activeTrucks/d.activeTrucks*100):0}%"></span></div><p>${f.periodTrucks} placa(s) com passagem nesta quinzena</p></div>`).join(''):'<div class="overview-no-events">Nenhuma fazenda nesta seleção.</div>'}</div></section><section class="card"><div class="card-header"><div><h2>Perfil dos caminhões</h2><p>Uma contagem por placa na quinzena selecionada.</p></div></div><div class="overview-profile">${Object.entries(d.types).map(([type,count])=>`<div class="overview-type"><span>${e(type)}</span><strong>${count}</strong></div>`).join('')}<div class="overview-axles"><strong>Quantidade de eixos</strong><div><span>7 eixos <b>${d.axles[7]}</b></span><span>9 eixos <b>${d.axles[9]}</b></span><span>Outros / a informar <b>${d.axles.other}</b></span></div></div></div></section></div>`+
    `<section class="card"><div class="card-header"><div><h2>Movimentações na quinzena <span class="count-pill">${d.events.length}</span></h2><p>Entradas, transferências e encerramentos${d.events.length>8?' · mostrando '+eventList.length+' de '+d.events.length:''}.</p></div><a class="btn small" href="#trucks">Ver cadastros</a></div>${eventList.length?`<div class="overview-events">${eventList.map(event=>`<div class="overview-event"><div class="overview-event-date">${dateLabel(event.date).slice(0,5)}</div><div><strong>${e(event.plate)}</strong><p>${e(event.text)}</p></div><span class="badge ${event.label==='Encerramento'?'gray':event.label==='Transferência'?'amber':'green'}">${event.label}${event.date>today()?' · agendado':''}</span></div>`).join('')}</div>`:`<div class="overview-no-events"><h3>${state.trucks.length?'Nenhuma movimentação nesta quinzena':'Comece cadastrando sua frota'}</h3><p>${state.trucks.length?'Os caminhões que continuam trabalhando aparecem no resumo acima.':'Cadastre os caminhões ou use os exemplos para conhecer o controle.'}</p>${!state.trucks.length?'<button class="btn" data-action="demo">Testar com exemplos</button>':''}</div>`}</section>`;
}
function closingMetrics(list) {
  const paid=list.filter(r=>r.paid),pending=list.filter(r=>!r.paid);
  return `<div class="metric-grid"><div class="metric featured"><div class="metric-label"><span class="dot"></span>Total líquido da quinzena</div><div class="metric-value money">${money(sum(list,'net'))}</div><div class="metric-note">${uniquePlates(list)} placa(s) no período</div></div><div class="metric"><div class="metric-label">Saldo a pagar</div><div class="metric-value money">${money(sum(pending,'net'))}</div><div class="metric-note">${pending.filter(r=>!r.closed).length?'Inclui placas em aberto':'Valores fechados sem pagamento'}</div></div><div class="metric"><div class="metric-label">Pagamentos realizados</div><div class="metric-value money">${money(sum(paid,'net'))}</div><div class="metric-note">${paid.length} pagamento(s) registrado(s)</div></div><div class="metric"><div class="metric-label">Descontos da quinzena</div><div class="metric-value money">${money(sum(list,'discount'))}</div><div class="metric-note">${list.reduce((n,r)=>n+r.discountDays,0)} dia(s) descontado(s)</div></div></div>`;
}

function ruleDescription(s,p) {return s.mode==='half'?`O mês completo sem descontos soma exatamente o valor mensal cadastrado. Cada quinzena completa paga metade do mensal. Nesta quinzena, o proporcional e os descontos usam mensal ÷ 2 ÷ ${days(p.start,p.end)} dias.`:s.mode==='calendar'?`Este registro usou a divisão pelos ${p.monthDays} dias do mês. A regra atual usa metade do mensal por quinzena completa.`:'Este pagamento foi registrado com a antiga diária mensal ÷ 30. O histórico pago é preservado; os novos cálculos usam o mensal fixo em duas quinzenas.';}
function trucksView() {
  const list=state.trucks.filter(t=>(!farmFilter||t.farmId===farmFilter)&&(!search||[t.plate,t.driver,t.carrier].some(x=>x.toLocaleLowerCase().includes(search.toLocaleLowerCase())))).sort((a,b)=>a.plate.localeCompare(b.plate)||b.start.localeCompare(a.start));
  return head('Caminhões','Cadastre as placas e acompanhe os períodos de trabalho em cada fazenda.','<button class="btn primary" data-action="new-truck">+ Cadastrar caminhão</button>','CADASTRO DA FROTA')+`<div class="toolbar"><input id="truck-search" type="search" placeholder="Buscar placa, motorista ou transportador" aria-label="Buscar caminhão" value="${e(search)}"><select id="farm-filter" aria-label="Filtrar caminhões por fazenda">${opt('','Todas as fazendas',farmFilter)}${farmOptions(farmFilter)}</select><span class="period-caption">${uniquePlates(list)} placa(s) · ${list.length} período(s)</span></div><section class="card"><div class="table-wrap">${list.length?`<table><thead><tr><th>PLACA / MOTORISTA</th><th>TRANSPORTADOR</th><th>FAZENDA</th><th>TIPO / EIXOS</th><th class="num">VALOR MENSAL</th><th>PERÍODO NA FAZENDA</th><th>SITUAÇÃO</th><th>AÇÕES</th></tr></thead><tbody>${list.map(t=>`<tr><td><span class="plate">${e(t.plate)}</span>${t.sample?'<span class="sample-mark">EXEMPLO</span>':''}<span class="secondary">${e(t.driver)}</span></td><td>${e(t.carrier)}</td><td>${e(state.farms.find(f=>f.id===t.farmId)?.name)}${t.transferIn?`<span class="secondary">Veio de ${e(t.transferIn.fromFarmName||state.farms.find(f=>f.id===t.transferIn.fromFarmId)?.name)} em ${dateLabel(t.transferIn.date)}</span>`:''}</td><td>${e(t.bodyType)||'A informar'}<span class="secondary">${t.axles?t.axles+' eixos':'Eixos a informar'}</span></td><td class="num value">${money(t.monthly)}</td><td>${dateLabel(t.start)}<span class="secondary">${t.end?'Até '+dateLabel(t.end):'Em aberto'}</span>${t.transferOut?`<span class="secondary">Destino: ${e(t.transferOut.toFarmName)} · ${dateLabel(t.transferOut.date)}</span>`:''}</td><td><span class="badge ${t.start>today()||t.serviceEnded?'gray':t.end&&t.end<today()?'gray':'green'}">${t.serviceEnded?(t.serviceEnded.date>today()?'Encerramento agendado':'Encerrado'):t.transferOut?(t.transferOut.date>today()?'Transferência agendada':'Transferido'):t.start>today()?'Agendado':t.end&&t.end<today()?'Encerrado':'Em serviço'}</span></td><td><div class="actions"><button class="btn small ghost" data-action="edit-truck" data-id="${e(t.id)}">Editar</button>${!t.transferOut?`<button class="btn small" data-action="transfer-truck" data-id="${e(t.id)}">Transferir fazenda</button>`:''}<button class="btn small ghost" data-action="truck-history" data-id="${e(t.id)}">Histórico</button></div></td></tr>`).join('')}</tbody></table>`:`<div class="empty"><div class="empty-icon">▤</div><h3>${state.trucks.length?'Nenhum resultado':'Cadastre o primeiro caminhão'}</h3><p>Placa, motorista, fazenda, valor mensal e início são suficientes para começar.</p><button class="btn primary" data-action="new-truck">+ Cadastrar caminhão</button></div>`}</div></section><div class="notice neutral"><span>Para mudar de fazenda a partir de uma data, use <strong>Transferir fazenda</strong>. Os dias e descontos serão divididos entre a origem e o destino, com o mesmo valor mensal combinado.</span></div>`;
}
function discountsView() {
  const p=currentPeriod(),list=state.discounts.filter(d=>overlaps(d.start,d.end,p.start,p.end)&&(!farmFilter||state.trucks.find(t=>t.id===d.truckId)?.farmId===farmFilter)).sort((a,b)=>b.start.localeCompare(a.start));
  return head('Descontos','Registre descontos por dias ou por valor, com data e motivo.','<button class="btn primary" data-action="new-discount" '+(!state.trucks.length?'disabled':'')+'>+ Lançar desconto</button>','OCORRÊNCIAS DO PERÍODO')+periodBar()+`<section class="card"><div class="card-header"><div><h2>Ocorrências <span class="count-pill">${list.length}</span></h2><p>Dias são calculados pelo período; valores entram na quinzena da data informada.</p></div></div>${list.length?`<div class="table-wrap"><table><thead><tr><th>CAMINHÃO</th><th>MOTIVO</th><th>PERÍODO</th><th class="num">DIAS / VALOR</th><th>OBSERVAÇÃO</th><th>AÇÕES</th></tr></thead><tbody>${list.map(d=>{const t=state.trucks.find(t=>t.id===d.truckId),locked=discountLocked(d,state);return `<tr><td><span class="plate">${e(t?.plate)}</span><span class="secondary">${e(t?.driver)}</span></td><td><span class="badge amber">${isAmountDiscount(d)?'Por valor':e(d.reason)}</span></td><td>${dateLabel(d.start)}${isAmountDiscount(d)?'':' a '+dateLabel(d.end)}</td><td class="num">${isAmountDiscount(d)?money(d.amount):days(d.start>p.start?d.start:p.start,d.end<p.end?d.end:p.end)+' dia(s)'}</td><td style="white-space:normal;max-width:260px">${e(d.note)||'—'}</td><td><div class="actions"><button class="btn small ghost" data-action="edit-discount" data-id="${e(d.id)}">Editar</button><button class="btn small danger" data-action="delete-discount" data-id="${e(d.id)}">Excluir</button></div>${locked?'<span class="badge gray" style="margin-top:7px">Período fechado</span>':''}</td></tr>`;}).join('')}</tbody></table></div>`:`<div class="empty"><div class="empty-icon">−</div><h3>Nenhum desconto nesta quinzena</h3><p>Escolha a placa e lance dias de falta ou oficina, ou um valor em reais com motivo obrigatório.</p><button class="btn" data-action="new-discount" ${!state.trucks.length?'disabled':''}>Lançar desconto</button></div>`}</section>`;
}
function historyReopenBlock(closing,row) {
  if(row.paid)return 'Pagamento já registrado; corrija o pagamento antes de reabrir.';
  if(row.requestId||state.paymentRequests.some(request=>request.period.key===closing.period.key&&request.snapshot.truckId===row.truckId&&request.snapshot.farmId===row.farmId&&['pending','paid'].includes(request.status)))return 'Há uma solicitação de pagamento; cancele ou corrija antes de reabrir.';
  if(state.fundingTransfers.some(transfer=>transfer.period.key===closing.period.key&&transfer.farmId===row.farmId&&transfer.status!=='cancelled'))return 'Há uma solicitação/transferência desta fazenda; resolva antes de reabrir.';
  return '';
}
function historyDetails(id) {
  const h=state.closings.find(item=>item.id===id);if(!h)throw Error('Este fechamento não está mais disponível.');
  const blocked=h.rows.map(row=>historyReopenBlock(h,row)).find(Boolean)||'';
  const rows=h.rows.slice().sort((a,b)=>a.farmName.localeCompare(b.farmName,'pt-BR')||a.plate.localeCompare(b.plate));
  openModal('Detalhes do fechamento',periodLabel(h.period)+' · fechado em '+dateLabel(h.closedDate),`<div class="form-note"><strong>${e(closingNames(h))}</strong><br>${e(historyRuleTitle(h))} · ${h.rows.length} caminhão(ões)</div><div class="detail-grid"><div><small>Valor bruto</small><strong>${money(sum(h.rows,'gross'))}</strong></div><div><small>Descontos</small><strong>${money(sum(h.rows,'discount'))}</strong></div><div><small>Já pago</small><strong>${money(sum(h.rows.filter(row=>row.paid),'net'))}</strong></div><div><small>Saldo aguardando</small><strong>${money(sum(h.rows.filter(row=>!row.paid),'net'))}</strong></div></div><div class="calculation" style="margin-bottom:18px"><div class="calc-row total"><span>Total líquido da quinzena</span><span>${money(sum(h.rows,'net'))}</span></div></div><section class="card" style="margin-bottom:0"><div class="card-header"><div><h3>Placas deste fechamento</h3><p>Você pode reabrir uma placa sem mexer nas demais.</p></div></div><div class="table-wrap"><table><thead><tr><th>CAMINHÃO / MOTORISTA</th><th>FAZENDA</th><th class="num">DIAS</th><th class="num">DESCONTOS</th><th class="num">VALOR LÍQUIDO</th><th>SITUAÇÃO</th><th>AÇÃO</th></tr></thead><tbody>${rows.map(row=>{const reason=historyReopenBlock(h,row),request=row.requestId?state.paymentRequests.find(item=>item.id===row.requestId):state.paymentRequests.find(item=>item.period.key===h.period.key&&item.snapshot.truckId===row.truckId&&item.snapshot.farmId===row.farmId&&['pending','paid'].includes(item.status));const status=row.paid?'Pago':request?.status==='pending'?'Solicitado':request?.status==='paid'?'Pago':'Fechado';return `<tr><td><span class="plate">${e(row.plate)}</span><span class="secondary">${e(row.driver)}</span></td><td>${e(row.farmName)}</td><td class="num">${row.eligibleDays}</td><td class="num">${row.discount?money(row.discount):'—'}<span class="secondary">${row.discount?row.discountDays+' dia(s) descontado(s)':'Sem desconto'}</span></td><td class="num value">${money(row.net)}</td><td><span class="badge ${status==='Pago'?'green':status==='Solicitado'?'amber':'gray'}">${status}</span></td><td>${reason?`<span class="secondary" title="${e(reason)}">Indisponível</span>`:`<button class="btn small" data-action="history-reopen-truck" data-closing="${e(h.id)}" data-truck="${e(row.truckId)}">Reabrir placa</button>`}</td></tr>`;}).join('')}</tbody></table></div></section>${blocked?`<div class="form-note warn" style="margin-top:16px">${e(blocked)} Para reabrir a quinzena toda, todas as placas precisam estar livres de pagamento e solicitação.</div>`:'<div class="form-note" style="margin-top:16px">Ao reabrir, os dados e descontos atuais serão usados no próximo cálculo. Pagamentos e solicitações ficam preservados e precisam ser resolvidos antes da reabertura.</div>'}<div class="form-actions"><button class="btn" data-action="close-modal">Fechar</button><button class="btn danger" data-action="history-reopen-closing" data-id="${e(h.id)}" ${blocked?'disabled':''}>Reabrir quinzena inteira</button></div>`,{wide:true});
}
function confirmHistoryReopen(closingId,truckId='') {
  const h=state.closings.find(item=>item.id===closingId);if(!h)throw Error('Este fechamento não está mais disponível.');
  const row=truckId?h.rows.find(item=>item.truckId===truckId):null;if(truckId&&!row)throw Error('Esta placa não faz parte do fechamento selecionado.');
  const title=row?'Reabrir somente esta placa?':'Reabrir a quinzena inteira?';
  const text=row?`${row.plate} · ${row.driver} · ${row.farmName}. Somente esta placa voltará para ajuste; as demais placas e o histórico serão mantidos.`:`${periodLabel(h.period)} · ${closingNames(h)}. Todas as placas deste fechamento voltarão para ajuste.`;
  openModal(title,'Confira antes de continuar.',`<p style="font-size:13px;line-height:1.8;color:var(--ink)">${e(text)}</p><div class="form-note warn">A reabertura mantém o fechamento anterior das outras placas. Pagamentos, solicitações e transferências financeiras impedem esta ação.</div><div class="form-actions"><button class="btn" data-action="close-modal">Cancelar</button><button class="btn danger" data-action="${row?'confirm-history-reopen-truck':'confirm-history-reopen-closing'}" data-closing="${e(h.id)}" ${row?`data-truck="${e(row.truckId)}"`:''}>Confirmar reabertura</button></div>`);
}
function closingsView() {
  const c=closing(),list=filteredRows(),pending=list.filter(r=>!r.closed),p=currentPeriod(),groups=new Map();for(const r of list){if(!groups.has(r.carrier))groups.set(r.carrier,[]);groups.get(r.carrier).push(r);}
  return head('Fechamentos','Confira o demonstrativo, feche o período e solicite os pagamentos à transportadora.',requestPaymentsButton()+'<button class="btn" data-action="report" '+(!list.length?'disabled':'')+'>Relatório</button><button class="btn primary" data-action="'+(c?'show-closing':'close-period')+'" '+(!rows().length?'disabled':'')+'>'+(c?'Resumo do fechamento':selectedClosings().length?'Fechar pendências':'Fechar quinzena')+'</button>','CONFERÊNCIA E PAGAMENTO')+periodBar()+ruleNotice()+portalClosingNotice(list)+closingMetrics(list)+
    `<div class="notice ${c?'neutral':''}"><span>${c?`<strong>Quinzena fechada em ${dateLabel(c.closedDate)}.</strong> Consulte os detalhes de cada fechamento para revisar ou reabrir placas.`:'<strong>Prévia em aberto.</strong> Cadastros e descontos atualizam os valores até você fechar a quinzena.'}</span></div>${pending.length?`<section class="card"><div class="card-header"><div><h2>Placas em aberto para ajuste</h2><p>${e(ruleTitle())} · valores ainda não fechados</p></div><button class="btn small" data-action="export-csv" ${!pending.length?'disabled':''}>Exportar CSV</button></div>${truckTable(pending)}<div class="card-footer"><span>Bruto: ${money(sum(pending,'gross'))} · Descontos: ${money(sum(pending,'discount'))}</span><strong style="color:var(--ink)">Líquido: ${money(sum(pending,'net'))}</strong></div></section>`:''}`+
    `<section class="card"><div class="card-header"><h2>Totais por transportador</h2><span class="badge gray">${groups.size} transportador(es)</span></div>${groups.size?`<div class="table-wrap"><table><thead><tr><th>TRANSPORTADOR</th><th class="num">CAMINHÕES</th><th class="num">TOTAL LÍQUIDO</th><th class="num">PAGO</th><th class="num">SALDO</th></tr></thead><tbody>${[...groups].map(([name,rr])=>`<tr><td>${e(name)}</td><td class="num">${uniquePlates(rr)}</td><td class="num value">${money(sum(rr,'net'))}</td><td class="num">${money(sum(rr.filter(r=>r.paid),'net'))}</td><td class="num value">${money(sum(rr.filter(r=>!r.paid),'net'))}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty"><p>Os transportadores aparecerão quando houver caminhões neste período.</p></div>'}</section>`+
    `<h2 style="margin:30px 0 15px">Histórico de quinzenas</h2>${state.closings.length?state.closings.slice().sort((a,b)=>b.period.key.localeCompare(a.period.key)||b.closedDate.localeCompare(a.closedDate)).map(h=>`<section class="card history-card"><div><h3>${e(periodLabel(h.period))} </h3><p style="font-weight:600;color:var(--ink);margin-bottom:5px">${e(closingNames(h))}</p><p>Fechado em ${dateLabel(h.closedDate)} · ${h.rows.length} caminhão(ões) · ${e(historyRuleTitle(h))}</p><button class="btn small primary" style="margin-top:10px" data-action="history-details" data-id="${e(h.id)}">Detalhes</button><button class="btn small" style="margin:10px 0 0 7px" data-action="report" data-id="${e(h.id)}" ${!h.rows.length?'disabled':''}>Relatório</button></div><div class="history-total"><strong>${money(sum(h.rows,'net'))}</strong><span class="badge ${h.rows.some(r=>!r.paid&&r.net>0)?'amber':h.rows.some(r=>r.paid)?'green':'gray'}">${h.rows.some(r=>!r.paid&&r.net>0)?'Fechados, aguardando pagamento':h.rows.some(r=>r.paid)?'Pagos':'Fechados'}</span><span class="secondary">${h.rows.filter(r=>r.paid).length} de ${h.rows.length} pagamento(s) registrado(s)</span></div></section>`).join(''):'<section class="card empty"><p>Seus fechamentos salvos aparecerão aqui.</p></section>'}`;
}
function settingsView() {
  return head('Configurações','Consulte o cálculo, cadastre suas fazendas e cuide dos seus registros.','','AJUSTES DO CONTROLE')+`<div class="settings-grid"><section class="card"><div class="card-header"><div><h2>Regras de pagamento</h2><p>O pagamento é calculado com o valor mensal cadastrado por placa.</p></div></div><div class="form-content"><div class="field"><label>Cálculo do valor proporcional</label><div class="form-note"><strong>Mensal fixo: duas quinzenas de metade do valor</strong><br>Um mês completo de 28, 29, 30 ou 31 dias sempre soma o valor mensal cadastrado, antes dos descontos.</div><small>O valor mensal é sempre informado no cadastro de cada placa.</small></div><div class="form-note" id="mode-explanation">${ruleDescription(state.settings,currentPeriod())}</div><div class="form-note">Quinzenas fixas: 1 a 15 e 16 ao último dia do mês. Faltas e oficina descontam dias inteiros. Descontos por valor exigem data e motivo, sem reduzir os dias trabalhados. O cálculo mantém a precisão da diária e arredonda o valor final para centavos.</div></div></section><section class="card"><div class="card-header"><h2>Backup dos registros</h2></div><div class="form-content"><p style="font-size:12px;line-height:1.8;margin-bottom:18px">Os registros da empresa ficam no banco online. Você pode baixar uma cópia para guardar um backup ou importar um arquivo autorizado.</p><div class="backup-actions"><button class="btn" data-action="backup">↓ Baixar backup completo</button><button class="btn" data-action="import-backup">↑ Restaurar backup</button><input type="file" id="backup-file" accept=".json,application/json" hidden></div><div class="form-note" style="margin-top:20px;margin-bottom:0">O backup inclui cadastros, descontos, regras e fechamentos. Restaurar substitui os registros da empresa no banco online e exige um administrador. Os recibos e repasses já registrados permanecem guardados separadamente.</div><p class="secondary" style="margin-top:15px">${state.updatedAt?'Última gravação: '+e(new Date(state.updatedAt).toLocaleString('pt-BR',{timeZone:'America/Cuiaba'})):'Nenhum registro salvo ainda.'}</p></div></section><section class="card"><div class="card-header"><div><h2>Fazendas</h2><p>Adicione fazendas, remova as que não têm vínculos ou inative preservando o histórico.</p></div></div><form id="farms-form" class="form-content">${errBox()}<div id="farm-fields">${state.farms.map(farmField).join('')}</div><div class="actions" style="margin-top:15px"><button class="btn" type="button" data-action="add-farm">+ Adicionar fazenda</button><button class="btn primary" type="submit">Salvar fazendas</button></div></form></section><section class="card"><div class="card-header"><h2>Conheça o controle</h2></div><div class="form-content"><p style="font-size:12px;line-height:1.8;margin-bottom:18px">Você pode testar com três placas fictícias, valores mensais diferentes e dois descontos. Os exemplos usam o mês selecionado e ficam identificados no cadastro.</p><button class="btn" data-action="demo" ${state.trucks.length?'disabled':''}>Carregar dados de exemplo</button>${state.trucks.some(t=>t.sample)?'<button class="btn danger" style="margin:10px 0 0" data-action="remove-demo">Remover exemplos</button>':''}<div class="form-note" style="margin-top:18px;margin-bottom:0">Esta etapa controla o pagamento mensal dos caminhões. Produção, remuneração pelo CT-e ou nota fiscal e combustível serão acrescentados nas etapas seguintes.</div></div></section></div>`;
}
function render() {
  if(!currentUser){renderAccess();return;}document.body.classList.remove('logged-out');
  view=location.hash.replace('#','') || 'overview';if(!['overview','trucks','discounts','closings','settings','requests','ctes'].includes(view))view='overview';if(isCarrier()&&!['requests','ctes'].includes(view))view='requests';
  const labels={overview:'Visão geral',trucks:'Caminhões',discounts:'Descontos',closings:'Fechamentos',settings:'Configurações',requests:'Solicitações de pagamento',ctes:'CT-e'};
  document.querySelector('#breadcrumb-current').textContent=labels[view];document.querySelectorAll('[data-nav]').forEach(a=>{a.hidden=isCarrier()&&!['requests','ctes'].includes(a.dataset.nav);a.classList.toggle('active',a.dataset.nav===view);a.setAttribute('aria-current',a.dataset.nav===view?'page':'false');});
  main.innerHTML=({overview,trucks:trucksView,discounts:discountsView,closings:closingsView,settings:settingsView,requests:requestsView,ctes:ctesView}[view])();
  if(view==='ctes')loadCteData();
  if(view==='settings'){main.insertAdjacentHTML('beforeend',teamSettings());loadTeam();}
  const writeActions=new Set(['new-truck','edit-truck','transfer-truck','end-activities','new-discount','edit-discount','delete-discount','close-period','reopen-period','reopen-batch','history-reopen-truck','history-reopen-closing','confirm-history-reopen-truck','confirm-history-reopen-closing','pay','undo-payment','demo','remove-demo','import-backup','request-payments','request-one','cancel-request','legacy-undo','pay-request']);
  document.querySelectorAll('[data-action]').forEach(button=>{if(currentUser.role==='viewer'&&writeActions.has(button.dataset.action))button.disabled=true;if(currentUser.role!=='admin'&&['add-farm','remove-farm','inactivate-farm','reactivate-farm','import-backup','demo','remove-demo'].includes(button.dataset.action))button.disabled=true;});
  if(currentUser.role!=='admin')document.querySelectorAll('#farms-form input,#farms-form button').forEach(element=>element.disabled=true);
  updateCloudStatus();
}

function normalizeCtePreferences(value){if(!value)return {visibleColumns:[],columnOrder:[]};const legacy={shipperCnpj:['shipperDocument'],shipperCpf:['shipperDocument'],recipientCnpj:['recipientDocument'],recipientCpf:['recipientDocument'],serviceTakerCnpj:['serviceTakerDocument'],serviceTakerCpf:['serviceTakerDocument'],issuerCnpj:['issuerDocument'],issuerCpf:['issuerDocument']},expand=fields=>[...new Set((fields||[]).flatMap(field=>legacy[field]|| (CTE_FILTER_FIELDS[field]?[field]:[])))],visibleColumns=expand(value.visibleColumns),columnOrder=expand(value.columnOrder);return {visibleColumns,columnOrder:[...columnOrder,...ALL_CTE_COLUMNS.filter(field=>!columnOrder.includes(field))]};}
function cteFieldOptions(field){return [...new Set(cteDocuments.filter(doc=>!cteFarmFilter||doc.farmId===cteFarmFilter).map(doc=>CTE_FILTER_FIELDS[field]?.get(doc)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR',{numeric:true}));}
function closeCteFilter(){cteFilterFieldOpen='';cteFilterDraft=[];cteFilterOptions=[];cteFilterSearch='';}
function ctesView(){
 const farms=isCarrier()?cteFarms:state.farms;
 const records=cteDocuments.filter(doc=>{
  if(cteFarmFilter&&doc.farmId!==cteFarmFilter)return false;
  return Object.entries(cteColumnFilters).every(([field,selected])=>!selected||selected.includes(CTE_FILTER_FIELDS[field]?.get(doc)));
 });
 const farmOptionsHtml=[...new Map([...farms.map(f=>[f.id,f.name]),...cteDocuments.map(d=>[d.farmId,d.farmName])]).entries()].map(([id,name])=>opt(id,name,cteFarmFilter)).join('');
 const filterOptions=cteFilterFieldOpen?cteFieldOptions(cteFilterFieldOpen):[];
 cteFilterOptions=filterOptions;
 const visibleColumns=ctePreferences.visibleColumns.length?ctePreferences.visibleColumns:DEFAULT_CTE_COLUMNS,orderedColumns=(ctePreferences.columnOrder.length?ctePreferences.columnOrder:ALL_CTE_COLUMNS).filter(field=>visibleColumns.includes(field));
 const tableHeaders=orderedColumns.map(field=>{const {label}=CTE_FILTER_FIELDS[field];return `<th class="cte-filter-heading"><span>${e(label.toLocaleUpperCase('pt-BR'))}</span><button class="cte-filter-button ${cteColumnFilters[field]?'active':''}" data-action="cte-column-filter" data-field="${field}" aria-label="Filtrar por ${e(label)}" aria-expanded="${cteFilterFieldOpen===field}">▾</button></th>`;}).join('');
 const anchorLeft=Math.max(8,Math.min(cteFilterAnchor.left,window.innerWidth-300)),anchorTop=Math.max(8,Math.min(cteFilterAnchor.top,window.innerHeight-360));
 const popover=cteFilterFieldOpen?`<div class="cte-filter-popover" role="dialog" aria-label="Filtrar por ${e(CTE_FILTER_FIELDS[cteFilterFieldOpen]?.label||'campo')}" style="top:${anchorTop}px;left:${anchorLeft}px"><strong>Filtrar por ${e(CTE_FILTER_FIELDS[cteFilterFieldOpen]?.label||'campo')}</strong><input id="cte-filter-search" type="search" value="${e(cteFilterSearch)}" placeholder="Pesquisar valores"><div class="cte-filter-tools"><button type="button" data-action="cte-filter-select-all">Selecionar todos</button><button type="button" data-action="cte-filter-clear-all">Desmarcar todos</button></div><div class="cte-filter-options">${filterOptions.map(value=>`<label data-cte-option-row><input type="checkbox" data-cte-filter-option value="${e(value)}" ${cteFilterDraft.includes(value)?'checked':''}><span>${e(value)}</span></label>`).join('')||'<small>Nenhum valor nesta seleção.</small>'}</div><div class="cte-filter-actions">${cteColumnFilters[cteFilterFieldOpen]?'<button class="btn small" data-action="cte-filter-reset">Limpar filtro</button>':''}<button class="btn small" data-action="cte-filter-cancel">Cancelar</button><button class="btn primary small" data-action="cte-filter-apply">Aplicar</button></div></div>`:'';
 const farmLabel=cteFarmFilter?(farms.find(farm=>farm.id===cteFarmFilter)?.name||cteDocuments.find(doc=>doc.farmId===cteFarmFilter)?.farmName||'Fazenda selecionada'):'Todas as fazendas';
 const tableMarkup=cteDocuments.length?`<div class="table-wrap"><table><thead><tr>${tableHeaders}<th class="cte-action-column">AÇÃO</th></tr></thead><tbody>${records.length?records.map(doc=>`<tr>${orderedColumns.map(field=>`<td>${field==='number'?`<strong>${e(CTE_FILTER_FIELDS[field].get(doc))}</strong>`:field==='totalValue'?`<strong>${e(CTE_FILTER_FIELDS[field].get(doc))}</strong>`:field==='plate'?`<strong class="plate">${e(CTE_FILTER_FIELDS[field].get(doc))}</strong>`:e(CTE_FILTER_FIELDS[field].get(doc))}</td>`).join('')}<td class="cte-action-column"><button class="btn small" data-action="cte-download" data-id="${e(doc.id)}">Baixar</button></td></tr>`).join(''):`<tr><td colspan="${orderedColumns.length+1}" class="cte-filter-empty">Nenhum CT-e corresponde aos filtros selecionados.</td></tr>`}</tbody></table></div>`:`<div class="empty"><h3>Ainda não há CT-es enviados</h3><p>${isCarrier()?'Envie o PDF do DACTE para o sistema preencher os dados e disponibilizar o documento ao grupo.':'Os CT-es enviados pela transportadora aparecerão aqui para consulta e download.'}</p>${isCarrier()&&canOperate()?'<button class="btn primary" data-action="cte-upload">+ Enviar primeiro CT-e</button>':''}</div>`;
 return head('CT-e','Use os filtros nos títulos das colunas para localizar documentos.',isCarrier()&&canOperate()?'<button class="btn primary" data-action="cte-upload">+ Enviar CT-e</button>':'','DOCUMENTOS FISCAIS')+
 `<div class="toolbar"><select id="cte-farm-filter" aria-label="Filtrar CT-e por fazenda">${opt('','Todas as fazendas',cteFarmFilter)}${farmOptionsHtml}</select><button class="btn small" data-action="cte-refresh">Atualizar</button><button class="btn small" data-action="cte-customize">Personalizar relatório</button><button class="btn small" data-action="cte-print">Imprimir / Salvar PDF</button><span class="period-caption">${records.length} documento(s)</span></div><section class="card cte-report-card"><div class="cte-print-heading"><h1>Relatório de CT-e</h1><p>Fazenda: ${e(farmLabel)} · ${records.length} documento(s)</p></div><div class="card-header"><div><h2>Documentos enviados</h2><p>${isCarrier()?'CT-es lidos e enviados pela transportadora para o grupo.':'CT-es enviados pela transportadora para consulta e download.'}</p></div></div>${tableMarkup}<div class="card-footer"><span>${records.length} documento(s) nesta seleção</span><span>Arquivos privados da empresa</span></div></section>${popover}`;
}

function ctePreferencesForm(){
 const current=ctePreferences.visibleColumns.length?ctePreferences.visibleColumns:DEFAULT_CTE_COLUMNS,order=ctePreferences.columnOrder.length?ctePreferences.columnOrder:ALL_CTE_COLUMNS;
 ctePreferenceDraft={visibleColumns:[...current],columnOrder:[...order]};
 const rows=()=>ctePreferenceDraft.columnOrder.map((field,index)=>`<div class="cte-preference-row"><label><input type="checkbox" data-cte-pref-column="${field}" ${ctePreferenceDraft.visibleColumns.includes(field)?'checked':''}><span>${e(CTE_FILTER_FIELDS[field].label)}</span></label><span><button class="btn small" type="button" data-action="cte-pref-up" data-field="${field}" aria-label="Mover ${e(CTE_FILTER_FIELDS[field].label)} para cima" ${index===0?'disabled':''}>↑</button> <button class="btn small" type="button" data-action="cte-pref-down" data-field="${field}" aria-label="Mover ${e(CTE_FILTER_FIELDS[field].label)} para baixo" ${index===ctePreferenceDraft.columnOrder.length-1?'disabled':''}>↓</button></span></div>`).join('');
 openModal('Personalizar relatório','Escolha as colunas, ajuste a ordem e salve sua visualização pessoal.',`<form id="cte-preferences-form"><div class="cte-preference-list">${rows()}</div><div class="form-note">A preferência fica salva na sua conta. Os CT-es e os filtros continuam compartilhados com a empresa.</div><div class="form-actions"><button class="btn" type="button" data-action="close-modal">Cancelar</button><button class="btn primary" type="submit">Salvar personalização</button></div></form>`);
}
function renderCtePreferenceRows(){const list=modalContent.querySelector('.cte-preference-list');if(!list||!ctePreferenceDraft)return;list.innerHTML=ctePreferenceDraft.columnOrder.map((field,index)=>`<div class="cte-preference-row"><label><input type="checkbox" data-cte-pref-column="${field}" ${ctePreferenceDraft.visibleColumns.includes(field)?'checked':''}><span>${e(CTE_FILTER_FIELDS[field].label)}</span></label><span><button class="btn small" type="button" data-action="cte-pref-up" data-field="${field}" aria-label="Mover ${e(CTE_FILTER_FIELDS[field].label)} para cima" ${index===0?'disabled':''}>↑</button> <button class="btn small" type="button" data-action="cte-pref-down" data-field="${field}" aria-label="Mover ${e(CTE_FILTER_FIELDS[field].label)} para baixo" ${index===ctePreferenceDraft.columnOrder.length-1?'disabled':''}>↓</button></span></div>`).join('');}

async function loadCteData(){
 if(cteLoading)return;cteLoading=true;
 try{const data=await cloud.ctes();cteDocuments=data.documents||[];cteTrucks=data.trucks||[];cteFarms=data.farms||[];ctePreferences=normalizeCtePreferences(data.preferences);if(view==='ctes')main.innerHTML=ctesView();}
 catch(error){if(view==='ctes'){main.innerHTML=head('CT-e','Não foi possível carregar os documentos.','<button class="btn" data-action="cte-refresh">Tentar novamente</button>','DOCUMENTOS FISCAIS')+`<section class="card empty"><p>${e(authErrorMessage(error))}</p></section>`;}}
 finally{cteLoading=false;}
}

function cteUploadForm(){
 if(!isCarrier()||!canOperate())throw Error('Somente a transportadora pode enviar CT-es.');
 openModal('Enviar CT-e','O sistema lê automaticamente remetente, destinatário, tomador do serviço, transportadora, valor do serviço, emissão e placa do PDF ou XML. A fazenda continua identificada pelo cadastro da placa.',`<form id="cte-upload-form">${errBox()}<div class="field"><label for="cte-file">PDF do DACTE *</label><input id="cte-file" name="file" type="file" accept=".pdf,application/pdf,.xml,application/xml,text/xml" required><small>Envie o PDF original do DACTE, com texto selecionável, ou o XML do CT-e. Arquivo de até 20 MB.</small></div><div class="form-note">Após a leitura, os dados ficam disponíveis para consulta e download do grupo.</div><div class="form-actions"><button class="btn" type="button" data-action="close-modal">Cancelar</button><button class="btn primary" type="submit">Ler e enviar CT-e</button></div></form>`);
}

async function showCteDownload(id){const doc=await cloud.cteLink(id);openModal('Baixar CT-e',doc.name,`<div class="form-note">O arquivo fica disponível em um link privado por até 2 minutos.</div><div class="form-actions"><a class="btn primary" href="${e(doc.signedUrl)}" target="_blank" rel="noopener noreferrer">Baixar arquivo</a><button class="btn" data-action="close-modal">Fechar</button></div>`);}
function truckForm(id) {
  const saved=state.trucks.find(t=>t.id===id),activeFarm=state.farms.find(f=>f.active!==false);
  if(!saved&&!activeFarm)throw Error('Cadastre ou reative uma fazenda antes de cadastrar o caminhão.');
  const t=saved||{plate:'',driver:'',carrier:'',farmId:activeFarm.id,bodyType:'',axles:null,monthly:null,start:today(),end:''};
  const payment=t.paymentDetails||{},paymentMethod=payment.method||'';
  const savedBank=payment.bankName||'',bankSelection=BANKS.some(([,name])=>name===savedBank)?savedBank:savedBank?'other':'';
  const axes=t.axles==null?'':[7,9].includes(t.axles)?String(t.axles):'other';
  openModal(id?'Editar caminhão':'Cadastrar caminhão','Informe o contrato desta placa.',`<form id="truck-form" data-id="${e(id||'')}">${errBox()}
    <div class="fields-two"><div class="field"><label for="truck-plate">Placa *</label><input id="truck-plate" name="plate" value="${e(t.plate)}" placeholder="ABC1D23" maxlength="8" required style="text-transform:uppercase"></div><div class="field"><label for="truck-farm">Fazenda *</label><select id="truck-farm" name="farmId" ${t.transferIn||t.transferOut?'disabled':''}>${farmOptions(t.farmId,true)}</select></div></div>
    <div class="fields-two"><div class="field"><label for="truck-type">Tipo de caminhão *</label><select id="truck-type" name="bodyType" required>${opt('','Selecione o tipo',t.bodyType)}${BODY_TYPES.map(v=>opt(v,v,t.bodyType)).join('')}</select></div><div class="field"><label for="truck-axles">Quantidade de eixos *</label><select id="truck-axles" name="axles" required>${opt('','Selecione os eixos',axes)}${opt('7','7 eixos',axes)}${opt('9','9 eixos',axes)}${opt('other','Outra quantidade',axes)}</select></div></div>
    <div class="field" id="other-axles-field" ${axes==='other'?'':'hidden'}><label for="truck-other-axles">Informe a quantidade de eixos *</label><input id="truck-other-axles" name="otherAxles" type="number" min="1" max="99" step="1" value="${axes==='other'?e(t.axles):''}" ${axes==='other'?'required':''}></div>
    <div class="field"><label for="truck-driver">Motorista *</label><input id="truck-driver" name="driver" value="${e(t.driver)}" maxlength="100" placeholder="Nome do motorista" required></div>
    <div class="field"><label for="truck-carrier">Transportador / contratado *</label><input id="truck-carrier" name="carrier" value="${e(t.carrier)}" maxlength="100" placeholder="Pessoa ou empresa que recebe o pagamento" required><small>Pode ser o próprio motorista. Várias placas podem pertencer ao mesmo transportador.</small></div>
    <div class="field"><label for="truck-monthly">Valor mensal combinado (R$) *</label><input id="truck-monthly" name="monthly" type="text" inputmode="decimal" maxlength="24" value="${e(amountLabel(t.monthly))}" placeholder="40.000,00" required autocomplete="off"><small>Informe o valor acordado. Exemplo: 40.000,00.</small></div>
    <div class="fields-two"><div class="field"><label for="truck-start">${t.transferIn?'Entrada nesta fazenda':'Data de início'} *</label><input id="truck-start" name="start" type="date" value="${e(t.start)}" ${t.transferIn?'readonly':''} required></div><div class="field"><label for="truck-end">${t.transferOut?'Último dia nesta fazenda':'Encerramento'}</label><input id="truck-end" name="end" type="date" value="${e(t.end)}" min="${e(t.start)}" ${t.transferOut||t.serviceEnded?'readonly':''}><small>${t.transferOut?'Data definida pela transferência para '+e(t.transferOut.toFarmName)+'.':t.serviceEnded?'Data registrada pelo encerramento de atividades.':'Deixe vazio enquanto o serviço continuar.'}</small></div></div>
    <div class="form-error range-error" role="alert"></div>
    <div class="form-note"><strong>Dados para pagamento</strong><br>Você pode cadastrar a placa sem preencher esta parte. Antes de solicitar o pagamento, será preciso completá-la.</div>
    <div class="field"><label for="truck-payment-method">Forma de pagamento</label><select id="truck-payment-method" name="paymentMethod">${opt('','Preencher depois',paymentMethod)}${opt('pix','Pix',paymentMethod)}${opt('bank','Transferência bancária',paymentMethod)}</select></div>
    <div id="truck-payment-fields" ${paymentMethod?'':'hidden'}>
      <div class="fields-two"><div class="field"><label for="truck-payment-holder">Nome do titular</label><input id="truck-payment-holder" name="paymentHolder" value="${e(payment.holder||'')}" maxlength="100" autocomplete="off"></div><div class="field"><label for="truck-payment-document">CPF ou CNPJ do titular</label><input id="truck-payment-document" name="paymentDocument" value="${e(formatPaymentDocumentInput(payment.document||''))}" maxlength="18" inputmode="numeric" autocomplete="off"></div></div>
      <div id="truck-pix-fields" ${paymentMethod==='pix'?'':'hidden'}><div class="field"><label for="truck-payment-pix">Chave Pix</label><input id="truck-payment-pix" name="paymentPixKey" value="${e(payment.pixKey||'')}" maxlength="120" autocomplete="off"></div></div>
      <div id="truck-bank-fields" ${paymentMethod==='bank'?'':'hidden'}><div class="field"><label for="truck-payment-bank">Banco</label><select id="truck-payment-bank" name="paymentBankSelection">${opt('','Selecione o banco',bankSelection)}${BANKS.map(([code,name])=>opt(name,`${code} - ${name}`,bankSelection)).join('')}${opt('other','Outro banco',bankSelection)}</select></div><div class="field" id="truck-other-bank-field" ${bankSelection==='other'?'':'hidden'}><label for="truck-other-bank">Nome do outro banco</label><input id="truck-other-bank" name="paymentOtherBankName" value="${bankSelection==='other'?e(savedBank):''}" maxlength="100" autocomplete="off"></div><div class="fields-two"><div class="field"><label for="truck-payment-agency">Agência</label><input id="truck-payment-agency" name="paymentAgency" value="${e(payment.agency||'')}" maxlength="20" autocomplete="off"></div><div class="field"><label for="truck-payment-account">Conta com dígito</label><input id="truck-payment-account" name="paymentAccount" value="${e(payment.account||'')}" maxlength="30" autocomplete="off"></div></div><div class="field"><label for="truck-payment-account-type">Tipo de conta</label><select id="truck-payment-account-type" name="paymentAccountType">${opt('','Selecione',payment.accountType||'')}${opt('corrente','Conta corrente',payment.accountType||'')}${opt('poupanca','Poupança',payment.accountType||'')}${opt('pagamento','Conta de pagamento',payment.accountType||'')}</select></div></div>
    </div>
    ${id?'<div class="form-note">Esta edição atualiza as prévias. Os valores dos fechamentos salvos permanecem preservados. Solicitações já enviadas guardam os dados de pagamento anteriores; para corrigi-las, cancele e envie novamente.</div>':''}
    <div class="form-actions"><button class="btn" type="button" data-action="close-modal">Cancelar</button><button class="btn primary" type="submit">Salvar caminhão</button></div></form>`);
  updateDateRange(document.querySelector('#truck-form'));
}

function updateTruckPaymentFields(form){
  if(!form||form.id!=='truck-form')return;
  const method=form.elements.paymentMethod.value;
  form.querySelector('#truck-payment-fields').hidden=!method;
  form.querySelector('#truck-pix-fields').hidden=method!=='pix';
  form.querySelector('#truck-bank-fields').hidden=method!=='bank';
  updateOtherBankField(form);
}
function updateOtherBankField(form){
  if(!form||form.id!=='truck-form')return;
  form.querySelector('#truck-other-bank-field').hidden=form.elements.paymentBankSelection.value!=='other';
}


function endActivitiesForm(id) {
  const t=latestTruck(state,id),date=t.serviceEnded?.date||t.end||(today()<t.start?t.start:today());
  openModal(t.serviceEnded?'Revisar encerramento':'Encerrar atividades',t.plate+' · '+t.driver+' · '+state.farms.find(f=>f.id===t.farmId)?.name,`<form id="end-activities-form" data-id="${e(t.id)}">${errBox()}<div class="field"><label for="activity-end-date">Último dia de serviço *</label><input id="activity-end-date" name="date" type="date" value="${e(date)}" min="${e(t.start)}" required><small>O pagamento considera essa data conforme a regra de entrada e encerramento configurada.</small></div><div id="activity-end-preview"></div><div class="field"><label for="activity-end-note">Observação</label><textarea id="activity-end-note" name="note" maxlength="300" placeholder="Ex.: serviço finalizado ou caminhão dispensado">${e(t.serviceEnded?.note||'')}</textarea></div><div class="form-note">A confirmação registra a saída e fecha somente a quinzena final desta placa, incluindo seus períodos nas fazendas. Os registros das outras placas e das quinzenas anteriores serão preservados.</div><div class="form-actions"><button class="btn" type="button" data-action="close-modal">Cancelar</button><button class="btn primary" type="submit">Encerrar e fechar esta placa</button></div></form>`);
  updateActivityEndPreview();
}
function updateActivityEndPreview() {
  const form=document.querySelector('#end-activities-form'),box=document.querySelector('#activity-end-preview');if(!form||!box)return;
  const button=form.querySelector('[type="submit"]');
  try {
    const plan=previewEndActivities(state,form.dataset.id,document.querySelector('#activity-end-date').value);
    if(!plan.canEnd){box.innerHTML=`<div class="form-note warn"><strong>A data altera um período com pagamento registrado.</strong><br>Revise o pagamento antes de encerrar com essa data.</div>${plan.conflicts.map(c=>`<p style="margin-bottom:12px">${e(c.farmName)} · ${e(periodLabel(c.period))}<br><button class="btn small" type="button" data-action="end-review-closing" data-id="${e(c.truckId)}" data-closing="${e(c.closingId)}" data-farm="${e(c.farmId)}">Ver pagamento registrado</button></p>`).join('')}`;button.disabled=true;return;}
    box.innerHTML=`<div class="form-note"><strong>Encerramento em ${dateLabel(plan.date)}</strong><br>Quinzena: ${e(periodLabel(plan.period))}.${plan.alreadyEnded?'<br>Este encerramento já está registrado.':''}</div><div class="table-wrap"><table><thead><tr><th>FAZENDA / DIAS</th><th class="num">DESCONTOS</th><th class="num">LÍQUIDO</th></tr></thead><tbody>${plan.rows.map(r=>`<tr><td>${e(r.farmName)}<span class="secondary">${r.eligibleDays?dateLabel(r.start)+' a '+dateLabel(r.end):'Sem dias a pagar nesta quinzena'} · ${r.payableDays} dia(s) a pagar</span></td><td class="num">${money(r.discount)}</td><td class="num value">${money(r.net)}${r.paid?'<span class="secondary">Pagamento preservado</span>':''}</td></tr>`).join('')}</tbody></table></div><div class="calculation" style="margin-top:16px"><div class="calc-row"><span>Total final da placa nesta quinzena</span><strong>${money(plan.total)}</strong></div><div class="calc-row"><span>Já pago, preservado</span><strong>${money(plan.paid)}</strong></div><div class="calc-row total"><span>Saldo a pagar</span><strong>${money(plan.balance)}</strong></div></div>${plan.revisions.length?'<div class="form-note warn" style="margin-top:15px">Os valores sem pagamento desta placa serão revisados. Os valores anteriores ficarão registrados no histórico. O novo fechamento usa a regra atual de cálculo.</div>':''}${plan.cancelled.length?'<div class="form-note" style="margin-top:12px">Descontos depois da data de encerramento ficam fora do cálculo e são guardados no histórico.</div>':''}`;
    button.disabled=false;
  } catch(err) {box.innerHTML=`<div class="form-note warn">${e(err.message)}</div>`;button.disabled=true;}
}

function transferForm(id) {
  const t=state.trucks.find(t=>t.id===id);if(!t)throw Error('Selecione um caminhão.');
  if(t.transferOut)throw Error('Use o período da fazenda de destino para uma nova transferência.');
  const first=shiftDate(t.start,1),defaultDate=t.end&&today()>t.end?t.end:today()<first?first:today();
  const target=state.farms.find(f=>f.active!==false&&f.id!==t.farmId)?.id;
  if(!target)throw Error('Cadastre uma fazenda de destino.');
  openModal('Transferir de fazenda',t.plate+' · '+t.driver,`<form id="transfer-form" data-id="${e(id)}">${errBox()}<div class="detail-grid"><div><small>Fazenda de origem</small><strong>${e(state.farms.find(f=>f.id===t.farmId)?.name)}</strong></div><div><small>Valor mensal mantido</small><strong>${money(t.monthly)}</strong></div></div><div class="field"><label for="transfer-farm">Fazenda de destino *</label><select id="transfer-farm" name="toFarmId">${state.farms.filter(f=>f.active!==false&&f.id!==t.farmId).map(f=>opt(f.id,f.name,target)).join('')}</select></div><div class="field"><label for="transfer-date">Primeiro dia na fazenda de destino *</label><input id="transfer-date" name="date" type="date" value="${defaultDate}" min="${first}" ${t.end?`max="${e(t.end)}"`:''} required><small>Esse dia será considerado somente na fazenda de destino.</small></div><div id="transfer-preview"></div><div class="field"><label for="transfer-note">Observação</label><textarea id="transfer-note" name="note" maxlength="300" placeholder="Ex.: remanejamento para outra frente de trabalho"></textarea></div><div class="form-note">A placa, o motorista, o transportador e o valor mensal serão mantidos. Os descontos que atravessam a transferência serão separados pelas datas. O histórico já fechado ou pago será preservado.</div><div class="form-actions"><button class="btn" type="button" data-action="close-modal">Cancelar</button><button class="btn primary" type="submit">Confirmar transferência</button></div></form>`);
  updateTransferPreview();
}
function updateTransferPreview() {
  const form=document.querySelector('#transfer-form'),box=document.querySelector('#transfer-preview');if(!form||!box)return;
  const button=form.querySelector('[type="submit"]');
  try {
    const plan=previewTransfer(state,form.dataset.id,document.querySelector('#transfer-farm').value,document.querySelector('#transfer-date').value);
    if(plan.conflicts.length){
      box.innerHTML=`<div class="form-note warn"><strong>A data afeta fechamento(s) já salvo(s).</strong><br>Revise e reabra os períodos abaixo antes de transferir. Os valores anteriores serão preservados até essa revisão.</div>${plan.conflicts.map(c=>`<div style="margin-bottom:12px"><span class="badge ${c.paid?'green':'amber'}">${c.paid?'Pago':'Fechado'}</span> <span class="secondary">${e(c.farmName)} · ${e(periodLabel(c.period))}</span><button class="btn small" type="button" style="margin-top:7px" data-action="transfer-review-closing" data-id="${e(plan.truckId)}" data-closing="${e(c.closingId)}" data-farm="${e(c.farmId)}">Ver fechamento</button></div>`).join('')}`;
      button.disabled=true;return;
    }
    box.innerHTML=`<div class="form-note"><strong>${e(plan.fromFarmName)}</strong> até ${dateLabel(plan.lastOldDay)}.<br><strong>${e(plan.toFarmName)}</strong> a partir de ${dateLabel(plan.date)}.</div>`;
    button.disabled=false;
  } catch(err) {box.innerHTML=`<div class="form-note warn">${e(err.message)}</div>`;button.disabled=true;}
}
function truckHistory(id) {
  const t=state.trucks.find(t=>t.id===id);if(!t)return;
  const entries=state.trucks.filter(x=>x.plate===t.plate).sort((a,b)=>a.start.localeCompare(b.start)),ids=new Set(entries.map(x=>x.id));
  const saved=state.closings.flatMap(c=>c.rows.filter(r=>ids.has(r.truckId)).map(r=>({closing:c,row:r}))).sort((a,b)=>b.closing.period.key.localeCompare(a.closing.period.key));
  openModal('Histórico · '+t.plate,'Períodos por fazenda e valores dos fechamentos salvos.',`<div class="event-list"><h3>Períodos de trabalho</h3>${entries.map(x=>`<p><strong>${e(state.farms.find(f=>f.id===x.farmId)?.name)}</strong> · ${dateLabel(x.start)} a ${x.end?dateLabel(x.end):'em aberto'}${x.transferOut?`<br><span class="secondary">Transferência para ${e(x.transferOut.toFarmName)} em ${dateLabel(x.transferOut.date)}${x.transferOut.note?' · '+e(x.transferOut.note):''}</span>`:''}</p>`).join('')}</div>${entries.filter(x=>x.serviceEnded).map(x=>`<div class="form-note" style="margin-top:18px"><strong>Encerramento registrado para ${dateLabel(x.serviceEnded.date)}</strong>${x.serviceEnded.note?'<br>'+e(x.serviceEnded.note):''}${x.serviceEnded.revisions?.length?'<br><strong>Valores anteriores revisados:</strong><br>'+x.serviceEnded.revisions.map(v=>e(v.row.farmName)+' · '+e(periodLabel(v.period))+' · Líquido '+money(v.row.net)+' · Descontos '+money(v.row.discount)).join('<br>'):''}${x.serviceEnded.cancelledDiscounts?.length?'<br><strong>Descontos fora do período encerrado:</strong><br>'+x.serviceEnded.cancelledDiscounts.map(d=>e(d.reason)+' · '+dateLabel(d.start)+' a '+dateLabel(d.end)).join('<br>'):''}</div>`).join('')}${state.closings.flatMap(c=>(c.calculationRevisions||[]).flatMap(v=>(v.previousRows||[]).filter(r=>ids.has(r.truckId)).map(r=>({period:c.period,row:r})))).map(v=>`<div class="form-note" style="margin-top:12px"><strong>Cálculo anterior à regra mensal fixa</strong><br>${e(v.row.farmName)} · ${e(periodLabel(v.period))}<br>Líquido anterior: ${money(v.row.net)} · Descontos anteriores: ${money(v.row.discount)}</div>`).join('')}<div class="event-list"><h3>Pagamentos e descontos registrados</h3>${saved.length?saved.map(({closing:c,row:r})=>`<div style="margin-bottom:14px"><p><strong>${e(r.farmName)}</strong> · ${e(periodLabel(c.period))}<br>Líquido: ${money(r.net)} · Descontos: ${money(r.discount)} · ${r.discountDays} dia(s)${r.paid?'<br>Pago em '+dateLabel(r.paid.date):''}</p><div class="actions" style="margin-top:8px">${badge({...r,closed:true})}<button class="btn small" data-action="view-history-payment" data-id="${e(r.truckId)}" data-closing="${e(c.id)}" data-farm="${e(r.farmId)}">Ver detalhes</button></div></div>`).join(''):'<p>Esta placa ainda não tem fechamentos salvos.</p>'}</div><div class="form-actions"><button class="btn" data-action="close-modal">Fechar</button></div>`);
}

function discountForm(id,truckId) {
  if(!state.trucks.length){notify('Cadastre um caminhão primeiro.');return;}
  const d=state.discounts.find(d=>d.id===id)||{truckId:truckId||state.trucks[0].id,start:today(),end:today(),reason:'Falta',note:''},byAmount=isAmountDiscount(d);
  openModal(id?'Editar desconto':'Lançar desconto','Escolha desconto por dias ou informe um valor em reais.',`<form id="discount-form" data-id="${e(id||'')}">${errBox()}<div class="field"><label for="discount-truck">Caminhão *</label><select id="discount-truck" name="truckId" required>${state.trucks.slice().sort((a,b)=>a.plate.localeCompare(b.plate)).map(t=>opt(t.id,t.plate+' · '+t.driver,d.truckId)).join('')}</select></div><div class="field"><label for="discount-kind">Tipo de desconto *</label><select id="discount-kind" name="kind">${opt('days','Desconto por dias',byAmount?'amount':'days')}${opt('amount','Desconto por valor (R$)',byAmount?'amount':'days')}</select></div><div id="discount-day-fields" ${byAmount?'hidden':''}><div class="field"><label for="discount-reason">Motivo *</label><select id="discount-reason" name="reason" ${byAmount?'disabled':''}>${['Falta','Oficina','Outro'].map(r=>opt(r,r,d.reason)).join('')}</select></div><div class="fields-two"><div class="field"><label for="discount-start">Primeiro dia *</label><input id="discount-start" name="start" type="date" value="${e(d.start)}" ${byAmount?'disabled':'required'}></div><div class="field"><label for="discount-end">Último dia *</label><input id="discount-end" name="end" type="date" value="${e(d.end)}" ${byAmount?'disabled':'required'}></div></div><div class="form-error range-error" role="alert"></div><div class="form-note" id="discount-length">${days(d.start,d.end)} dia(s) de desconto, incluindo o primeiro e o último dia.</div></div><div id="discount-amount-fields" ${byAmount?'':'hidden'}><div class="fields-two"><div class="field"><label for="discount-date">Data do desconto *</label><input id="discount-date" name="date" type="date" value="${e(d.start)}" ${byAmount?'required':'disabled'}><small>A data define a quinzena do desconto.</small></div><div class="field"><label for="discount-amount">Valor do desconto (R$) *</label><input id="discount-amount" name="amount" type="text" inputmode="decimal" placeholder="Ex.: 500,00" value="${byAmount?e(amountLabel(d.amount)):''}" ${byAmount?'required':'disabled'}></div></div><div class="form-note">O valor informado será descontado uma única vez nessa quinzena, sem reduzir os dias trabalhados.</div></div><div class="field"><label id="discount-note-label" for="discount-note">${byAmount?'Motivo do desconto *':'Observação'}</label><textarea id="discount-note" name="note" maxlength="300" ${byAmount||d.reason==='Outro'?'required':''} placeholder="${byAmount?'Explique por que este valor está sendo descontado':'Ex.: caminhão na oficina para manutenção'}">${e(d.note)}</textarea><small id="discount-note-help">${byAmount?'O motivo é obrigatório para desconto por valor.':'Obrigatória quando o motivo for “Outro”.'}</small></div><div class="form-actions"><button class="btn" type="button" data-action="close-modal">Cancelar</button><button class="btn primary" type="submit">Salvar desconto</button></div></form>`);
  updateDiscountKind(document.querySelector('#discount-form'));
}
function updateDiscountKind(form) {
  const byAmount=form.elements.kind.value==='amount';
  form.querySelector('#discount-day-fields').hidden=byAmount;form.querySelector('#discount-amount-fields').hidden=!byAmount;
  for(const name of ['start','end','reason']){form.elements[name].disabled=byAmount;form.elements[name].required=!byAmount;if(name==='end')form.elements[name].setCustomValidity('');}
  for(const name of ['date','amount']){form.elements[name].disabled=!byAmount;form.elements[name].required=byAmount;form.elements[name].setCustomValidity('');}
  form.elements.note.required=byAmount||form.elements.reason.value==='Outro';
  form.querySelector('#discount-note-label').textContent=byAmount?'Motivo do desconto *':form.elements.note.required?'Observação *':'Observação';
  form.querySelector('#discount-note-help').textContent=byAmount?'O motivo é obrigatório para desconto por valor.':'Obrigatória quando o motivo for “Outro”.';
  form.elements.note.placeholder=byAmount?'Explique por que este valor está sendo descontado':'Ex.: caminhão na oficina para manutenção';
  form.querySelector('[type="submit"]').disabled=false;
  if(!byAmount)updateDateRange(form);
}

function discountReopenPlan(d) {
  return state.closings.filter(c=>overlaps(c.period.start,c.period.end,d.start,d.end)&&c.rows.some(r=>r.truckId===d.truckId)).map(c=>{
    const own=c.rows.find(r=>r.truckId===d.truckId);
    return {closingId:c.id,period:c.period,farmId:own.farmId,farmName:own.farmName,rows:c.rows.filter(r=>r.farmId===own.farmId)};
  });
}
function requestDiscountAction(id,operation) {
  const d=state.discounts.find(d=>d.id===id);if(!d)throw Error('O desconto selecionado não está mais disponível.');
  if(!discountLocked(d,state)){
    if(operation==='edit')discountForm(id);
    else confirmation('Excluir desconto?','Este lançamento será removido e a prévia será recalculada.','confirm-delete-discount',id);
    return;
  }
  const plan=discountReopenPlan(d),paid=plan.flatMap(scope=>scope.rows.filter(r=>r.paid).map(r=>({scope,row:r}))),truck=state.trucks.find(t=>t.id===d.truckId);
  const summary=`<div class="form-note"><strong>${e(truck?.plate)} · ${e(d.reason)}</strong><br>${dateLabel(d.start)} a ${dateLabel(d.end)}</div>`;
  if(paid.length){
    openModal('Este fechamento tem pagamento registrado','Revise o pagamento para liberar a correção do desconto.',`${summary}<div class="form-note warn">O desconto faz parte de um fechamento com pagamento registrado. A alteração precisa ser liberada antes de editar ou excluir. Abra os detalhes do pagamento para conferir o registro.</div><div class="event-list">${paid.map(({scope,row})=>`<div style="margin-bottom:12px"><p><strong>${e(row.plate)}</strong> · ${e(row.farmName)}<br>Pago em ${dateLabel(row.paid.date)} · ${money(row.net)}</p><button class="btn small" style="margin-top:8px" data-action="review-discount-payment" data-id="${e(row.truckId)}" data-closing="${e(scope.closingId)}" data-farm="${e(scope.farmId)}">Ver pagamento registrado</button></div>`).join('')}</div><div class="form-actions"><button class="btn" data-action="close-modal">Voltar aos descontos</button></div>`);
    return;
  }
  openModal(operation==='edit'?'Liberar edição do desconto?':'Liberar exclusão do desconto?','O desconto está em período fechado.',`${summary}<div class="form-note">Será reaberta a parte desta fazenda nos seguintes fechamentos:<br>${plan.map(scope=>`<strong>${e(scope.farmName)}</strong> · ${e(periodLabel(scope.period))}`).join('<br>')}</div><p style="font-size:12px;line-height:1.8">As prévias serão recalculadas com os cadastros e regras atuais. Depois da correção, feche novamente as placas pendentes. Os fechamentos das outras fazendas serão preservados.</p><div class="form-actions"><button class="btn" data-action="close-modal">Cancelar</button><button class="btn ${operation==='edit'?'primary':'danger'}" data-action="confirm-discount-reopen-${operation}" data-id="${e(id)}">${operation==='edit'?'Reabrir e editar':'Reabrir e excluir'}</button></div>`);
}
async function applyDiscountReopen(id,operation) {
  const d=state.discounts.find(d=>d.id===id);if(!d)throw Error('O desconto selecionado não está mais disponível.');
  const plan=discountReopenPlan(d);
  if(plan.some(scope=>scope.rows.some(r=>r.paid)))throw Error('Há pagamento registrado neste fechamento. Revise o pagamento primeiro.');
  await remoteCommand('discount.reopen',{id,operation});
  modal.close();render();
  if(operation==='edit'){discountForm(id);notify('A edição foi liberada. Confira e salve o desconto.');}
  else notify('Desconto excluído. Confira os valores e feche novamente as placas pendentes.');
}

function detail(id) {
  const r=rows().find(r=>r.truckId===id);if(!r)return;const c=rowClosing(id),settings=r.calculationSettings||c?.settings||state.settings;
  const rate=new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:4}).format(r.rate);
  openModal(r.plate,r.driver+' · '+r.farmName,`<div class="detail-grid"><div><small>Transportador</small><strong>${e(r.carrier)}</strong></div><div><small>Valor mensal</small><strong>${money(r.monthly)}</strong></div><div><small>Tipo de caminhão</small><strong>${e(r.bodyType)||'A informar'}</strong></div><div><small>Quantidade de eixos</small><strong>${r.axles?r.axles+' eixos':'A informar'}</strong></div><div><small>Período na fazenda</small><strong>${dateLabel(r.contractStart)} a ${r.contractEnd?dateLabel(r.contractEnd):'em aberto'}</strong></div><div><small>Período considerado</small><strong>${dateLabel(r.start)} a ${dateLabel(r.end)}</strong></div></div><div class="form-note">${e(MODES[settings.mode])}<br>Diária de cálculo: R$ ${rate}. O arredondamento é feito no valor final.${r.roundingAdjusted?' Os centavos foram distribuídos entre os períodos da placa para manter o total.':''}</div><div class="calculation"><div class="calc-row"><span>${r.eligibleDays} dia(s) no período</span><span>${money(r.gross)}</span></div><div class="calc-row discount-color"><span>Descontos${r.discountDays?' · '+r.discountDays+' dia(s)':''}${amountDiscountTotal(r)?' + '+money(amountDiscountTotal(r))+' por valor':''}</span><span>− ${money(r.discount)}</span></div><div class="calc-row total"><span>${r.payableDays} dia(s) a pagar</span><span>${money(r.net)}</span></div></div><div class="event-list"><h3>Descontos considerados</h3>${r.events.length?r.events.map(d=>`<p><strong>${isAmountDiscount(d)?'Desconto por valor':e(d.reason)}</strong> · ${isAmountDiscount(d)?money(d.amount)+' · '+dateLabel(d.start):d.count+' dia(s) · '+dateLabel(d.start)+' a '+dateLabel(d.end)}${d.note?'<br><span class="secondary">'+e(d.note)+'</span>':''}</p>`).join(''):'<p>Nenhum desconto neste período.</p>'}</div>${r.paid?`<div class="notice neutral" style="margin:20px 0 0"><span>Pago em ${dateLabel(r.paid.date)}${r.paid.note?' · '+e(r.paid.note):''}</span></div>`:''}${state.trucks.find(t=>t.id===id)?.serviceEnded?`<div class="notice neutral" style="margin-top:18px"><span>Encerramento registrado para <strong>${dateLabel(state.trucks.find(t=>t.id===id).serviceEnded.date)}</strong>.</span></div>`:''}<div class="form-actions"><button class="btn orange" data-action="end-activities" data-id="${e(id)}">${latestTruck(state,id).serviceEnded?'Revisar encerramento':'Encerrar atividades'}</button>${c?(r.requestId?`<button class="btn primary" data-action="request-detail" data-id="${e(r.requestId)}">Ver solicitação${r.paid?' e comprovante':''}</button>`:r.paid?`${r.paid.receipt?`<button class="btn" data-action="receipt-view" data-id="${e(r.paid.receipt.id)}">Comprovante</button>`:currentUser.role==='admin'?`<button class="btn danger" data-action="legacy-undo" data-id="${e(id)}">Corrigir registro anterior</button>`:''}`:r.net>0?`<button class="btn primary" data-action="request-one" data-id="${e(id)}" ${!canOperate()?'disabled':''}>Solicitar pagamento</button>`:'<span class="badge gray">Sem valor a pagar</span>'):`<button class="btn" data-action="new-discount" data-id="${e(id)}">Lançar desconto</button>`}<button class="btn" data-action="close-modal">Fechar</button></div>`);
}
function closePeriodModal() {
  if(!state.settings.confirmed){location.hash='settings';render();notify('Confira e salve a regra de cálculo antes de fechar a quinzena.');return;}
  if(!openFarmIds(state,currentPeriod()).length){closingSummary();return;}
  const selected=farmFilter&&canCloseFarm(farmFilter)?farmFilter:'';
  openModal(selectedClosings().length?'Fechar pendências da quinzena?':'Fechar esta quinzena?',periodLabel(currentPeriod()),`<div class="field"><label for="closing-farm">Quais fazendas deseja fechar?</label><select id="closing-farm">${opt('','Todas as fazendas com fechamento pendente',selected)}${state.farms.map(f=>`<option value="${e(f.id)}" ${canCloseFarm(f.id)?'':'disabled'} ${f.id===selected?'selected':''}>${e(f.name)}${farmClosing(state,currentPeriod(),f.id)?canCloseFarm(f.id)?' · novas placas pendentes':' · já fechada':''}</option>`).join('')}</select></div><div id="closing-preview"></div><div class="form-actions"><button class="btn" data-action="close-modal">Conferir novamente</button><button class="btn primary" data-action="confirm-close">Confirmar fechamento</button></div>`);
  updateClosingPreview();
}
function updateClosingPreview() {
  const field=document.querySelector('#closing-farm'),box=document.querySelector('#closing-preview'),button=modal.querySelector('[data-action="confirm-close"]');
  if(!field||!box)return;
  try {
    const result=closingPreview(state,currentPeriod(),field.value),list=result.rows,names=result.farmIds.map(id=>state.farms.find(f=>f.id===id).name);
    box.innerHTML=`<div class="detail-grid"><div><small>Caminhões</small><strong>${list.length} placa(s)</strong></div><div><small>Regra de cálculo</small><strong>${e(MODES[state.settings.mode])}</strong></div></div><div class="form-note"><strong>Fazendas deste fechamento:</strong> ${names.map(e).join(', ')}.</div><div class="calculation"><div class="calc-row"><span>Valor bruto</span><strong>${money(sum(list,'gross'))}</strong></div><div class="calc-row"><span>Descontos</span><strong>− ${money(sum(list,'discount'))}</strong></div><div class="calc-row total"><span>Total líquido</span><span>${money(sum(list,'net'))}</span></div></div><div class="form-note" style="margin-top:18px">${result.complementFarmIds.length?'Este fechamento complementar inclui somente as placas que ainda não foram fechadas. Os valores e pagamentos anteriores permanecem preservados.':field.value?'Somente as placas pendentes da fazenda selecionada serão fechadas. As outras fazendas continuam disponíveis.':'Serão fechadas somente as placas pendentes das fazendas selecionadas. Os fechamentos anteriores permanecem preservados.'}</div>`;
    button.disabled=false;
  } catch(err) {box.innerHTML=`<div class="form-note warn">${e(err.message)}</div>`;button.disabled=true;}
}
function reopenPeriodModal() {
  const ids=[...new Set(selectedClosings().flatMap(c=>c.farmIds))];
  if(!ids.length){notify('Não há fechamento salvo nesta seleção.');return;}
  const selected=farmFilter&&ids.includes(farmFilter)?farmFilter:'';
  openModal('Reabrir quinzena',periodLabel(currentPeriod()),`<div class="field"><label for="reopening-farm">Quais fazendas deseja reabrir?</label><select id="reopening-farm">${opt('','Todas as fazendas fechadas',selected)}${ids.map(id=>opt(id,state.farms.find(f=>f.id===id)?.name,selected)).join('')}</select></div><div id="reopening-preview"></div><div class="form-actions"><button class="btn" data-action="close-modal">Cancelar</button><button class="btn danger" data-action="confirm-reopen">Confirmar reabertura</button></div>`);
  updateReopeningPreview();
}
function updateReopeningPreview() {
  const field=document.querySelector('#reopening-farm'),box=document.querySelector('#reopening-preview');if(!field||!box)return;
  const selected=periodClosings(state,currentPeriod()).flatMap(c=>c.rows).filter(r=>!field.value||r.farmId===field.value),paid=selected.some(r=>r.paid),requested=selected.some(r=>r.requestId);
  box.innerHTML=`<div class="form-note ${paid?'warn':''}">${requested?'Cancele as solicitações pendentes antes de reabrir. Pagamentos registrados precisam ser corrigidos pela transportadora.':paid?'Há pagamentos registrados nesta seleção. Revise os registros antes de reabrir.':'A seleção será recalculada com os cadastros, descontos e regras atuais. Os fechamentos das outras fazendas serão preservados.'}</div>`;
  modal.querySelector('[data-action="confirm-reopen"]').disabled=paid||requested;
}
function closingSummary() {
  const cs=selectedClosings();if(!cs.length)return;
  const list=cs.flatMap(c=>c.rows).filter(r=>!farmFilter||r.farmId===farmFilter);
  const names=[...new Set(cs.flatMap(c=>c.farmIds))].filter(id=>!farmFilter||id===farmFilter).map(id=>state.farms.find(f=>f.id===id)?.name);
  openModal('Resumo dos fechamentos',periodLabel(currentPeriod()),`<div class="form-note"><strong>Fazendas fechadas:</strong> ${names.map(e).join(', ')}.</div><div class="detail-grid"><div><small>Fechamento(s) salvo(s)</small><strong>${cs.length}</strong></div><div><small>Pagamentos registrados</small><strong>${list.filter(r=>r.paid).length} de ${list.filter(r=>r.net>0).length}</strong></div></div><div class="calculation"><div class="calc-row"><span>Total líquido fechado</span><strong>${money(sum(list,'net'))}</strong></div><div class="calc-row"><span>Já pago</span><strong>${money(sum(list.filter(r=>r.paid),'net'))}</strong></div><div class="calc-row total"><span>Saldo a pagar</span><span>${money(sum(list.filter(r=>!r.paid),'net'))}</span></div></div><div class="form-actions"><button class="btn" data-action="close-modal">Fechar</button><button class="btn primary" data-action="go-closings">Ver demonstrativo</button></div>`);
}
function paymentForm(requestId){
 const request=portalRequests.find(r=>r.id===requestId);if(!request||request.status!=='pending'||!isCarrier()||!canOperate())throw Error('Acesse como transportadora para registrar este pagamento.');
 const row=request.snapshot;if(paymentDetailsMissing(row.paymentDetails).length)throw Error('Esta solicitação não tem dados de pagamento completos. Peça ao grupo que a cancele e envie novamente.');
 modal.close();openModal('Registrar pagamento e comprovante',row.plate+' · '+row.driver,`<form id="payment-form" data-request-id="${e(request.id)}">${errBox()}<div class="form-note">${e(row.farmName)} · ${e(periodLabel(request.period))}<br>Valor solicitado: <strong>${money(row.net)}</strong>. Confira o destino abaixo antes de realizar a transferência.</div>${paymentDetailsMarkup(row.paymentDetails)}<div class="field"><label for="paid-date">Data do pagamento *</label><input id="paid-date" name="date" type="date" value="${today()}" max="${today()}" required></div><div class="field"><label for="paid-receipt">Comprovante de pagamento *</label><input id="paid-receipt" name="receipt" type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" required><small>PDF, JPG ou PNG, até 10 MB. O arquivo fica disponível para o grupo e a transportadora.</small></div><div class="field"><label for="paid-note">Observação</label><input id="paid-note" name="note" maxlength="300" placeholder="Ex.: referência da transferência"></div><div class="form-actions"><button class="btn" type="button" data-action="close-modal">Cancelar</button><button class="btn primary" type="submit">Registrar pagamento com comprovante</button></div></form>`);
}
function confirmation(title,text,action,id='') {if(modal.open)modal.close();openModal(title,'Confira antes de continuar.',`<p style="font-size:13px;line-height:1.8;color:var(--ink)">${e(text)}</p><div class="form-actions"><button class="btn" data-action="close-modal">Cancelar</button><button class="btn danger" data-action="${e(action)}" data-id="${e(id)}">Confirmar</button></div>`);}
async function addDemo() {await remoteCommand('examples.load',{month:currentMonth});currentHalf=1;render();notify('Exemplos carregados no banco da empresa.');}
function exportCsv() {
  const p=currentPeriod(),c=closing(),list=filteredRows();if(!list.length)return;
  const matrix=[['Período','Placa','Motorista','Transportador','Fazenda','Tipo de caminhão','Eixos','Mensal R$','Início considerado','Fim considerado','Dias no período','Dias descontados','Dias a pagar','Bruto R$','Descontos R$','Líquido R$','Situação','Data pagamento','Regra']];
  for(const r of list)matrix.push([periodLabel(p),r.plate,r.driver,r.carrier,r.farmName,r.bodyType||'',r.axles||'',r.monthly.toFixed(2).replace('.',','),dateLabel(r.start),dateLabel(r.end),r.eligibleDays,r.discountDays,r.payableDays,r.gross.toFixed(2).replace('.',','),r.discount.toFixed(2).replace('.',','),r.net.toFixed(2).replace('.',','),paymentStatus(r),r.paid?dateLabel(r.paid.date):'',MODES[rowRules(r).mode]]);
  download(csv(matrix),'text/csv;charset=utf-8',`frota-${p.key}${c?'':'-previa'}.csv`);notify('Demonstrativo exportado.');
}
let reportContext=null,reportInvoker=null;
const reportDialog=document.querySelector('#report-dialog');
function renderReportPreview(farmId='',onlyPaid=false,plate='') {
  if(!reportContext)return;
  reportContext.plate=plate;
  const report=createReport(state,reportContext.period,{farmId,onlyPaid,plate,closingId:reportContext.closingId});
  document.querySelector('#report-preview').innerHTML=report.pages.length?reportMarkup(report):`<div class="report-empty"><h2>${onlyPaid?'Nenhum pagamento registrado nesta seleção':'Nenhum caminhão nesta seleção'}</h2><p>Selecione outra competência, quinzena, fazenda, placa ou conteúdo do relatório.</p></div>`;
  document.querySelector('#report-print').disabled=!report.pages.length;
  document.querySelector('#report-page-count').textContent=`${report.truckCount} caminhão(ões) · ${report.pages.length} página(s)`;
  document.querySelector('#report-period-caption').textContent=periodLabel(reportContext.period)+(reportContext.closingId?' · Fechamento salvo':'');
}
function updateReportPeriod() {
  if(!reportContext)return;
  try {
    const p=period(document.querySelector('#report-month').value,Number(document.querySelector('#report-half').value));
    if(p.key!==reportContext.period.key)reportContext.closingId='';
    reportContext.period=p;
    renderReportPreview(document.querySelector('#report-farm').value||'',document.querySelector('#report-scope').value==='paid',document.querySelector('#report-plate').value||'');
  }catch{
    document.querySelector('#report-print').disabled=true;
    document.querySelector('#report-preview').innerHTML='<div class="report-empty"><h2>Selecione a competência e a quinzena</h2><p>Informe o mês e escolha a primeira ou a segunda quinzena para gerar o relatório.</p></div>';
    document.querySelector('#report-period-caption').textContent='Selecione a competência e a quinzena';
    document.querySelector('#report-page-count').textContent='';
  }
}
function openReport(closingId='',invoker=null) {
  if(loadError)throw Error('Recupere os registros antes de gerar o relatório.');
  const batch=closingId?state.closings.find(item=>item.id===closingId):null;
  if(closingId&&!batch)throw Error('Este fechamento não está disponível.');
  const p=batch?.period||currentPeriod(),available=periodRows(state,p).filter(row=>!closingId||row.closingId===closingId);
  const farms=[...new Map([...state.farms.map(farm=>[farm.id,farm.name]),...available.map(row=>[row.farmId,row.farmName])]).entries()];
  const plates=[...new Set([...state.trucks,...state.closings.flatMap(closing=>closing.rows)].map(row=>row.plate))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  const farmId=batch?.farmIds.length===1?batch.farmIds[0]:batch?'':farmFilter;
  reportContext={period:p,closingId};reportInvoker=invoker;
  document.querySelector('#report-content').innerHTML=`<div class="report-toolbar"><div class="report-toolbar-head"><div><h2 id="report-title">Relatório quinzenal</h2><p id="report-period-caption">${e(periodLabel(p))}${batch?' · Fechamento salvo':''}</p></div><div class="actions"><button class="btn primary" id="report-print" data-action="print-report">Imprimir / Salvar PDF</button><button class="btn" data-action="close-report">Voltar</button></div></div><div class="report-period-controls"><label>Competência<input type="month" id="report-month" value="${e(p.month)}" required></label><label>Quinzena<select id="report-half">${opt(1,'1ª quinzena · 1 a 15',p.half)}${opt(2,'2ª quinzena · 16 ao fim do mês',p.half)}</select></label></div><div class="report-controls"><label>Fazenda<select id="report-farm">${opt('','Todas as fazendas',farmId)}${farms.map(([id,name])=>opt(id,name,farmId)).join('')}</select></label><label>Placa<select id="report-plate">${opt('','Todas as placas','')}${plates.map(plate=>opt(plate,plate,'')).join('')}</select></label><label>Conteúdo<select id="report-scope">${opt('all','Todos os caminhões','all')}${opt('paid','Somente pagos','all')}</select></label><span id="report-page-count"></span></div><p class="report-print-help">Para salvar em PDF, escolha “Salvar como PDF” na janela de impressão. Use papel A4, orientação retrato e desative os cabeçalhos e rodapés do navegador.</p></div><div id="report-preview"></div>`;
  document.querySelector('#report-month').value=p.month;document.querySelector('#report-half').value=String(p.half);document.querySelector('#report-farm').value=farmId;document.querySelector('#report-plate').value='';document.querySelector('#report-scope').value='all';
  renderReportPreview(farmId,false);document.body.classList.add('report-open');if(!reportDialog.open)reportDialog.showModal();
}
function closeReport() {reportDialog.close();document.body.classList.remove('report-open');reportInvoker?.focus?.();}
function printReport() {if(!reportDialog.open||document.querySelector('#report-print').disabled)return;const title=document.title;document.title=`Frota - Relatório ${reportContext.period.key}${reportContext.plate?' - '+reportContext.plate:''}`;try{window.print();}finally{document.title=title;}}
reportDialog.addEventListener('close',()=>{document.body.classList.remove('report-open');reportInvoker?.focus?.();});
let pendingBackup=null;
document.addEventListener('click',async ev=>{
  const b=ev.target.closest('[data-action]');if(!b||b.disabled)return;const a=b.dataset.action,id=b.dataset.id;
  try {
    if(a==='cloud-refresh')await refreshServerData();
    else if(a==='restore-session')await restoreSession();
    else if(a==='forget-session'){cloud.forgetSession();render();}
    else if(a==='auth-switch'){inviteSignin=!inviteSignin;renderAccess();}
    else if(a==='cloud-logout'){try{await cloud.logout();}finally{currentUser=null;currentCompany=null;state=initialState();portalRequests=[];modal.close();reportDialog.close();modalContent.innerHTML='';document.querySelector('#report-content').innerHTML='';render();}}
    else if(a==='member-status'){await cloud.updateMember(id,b.dataset.role,b.dataset.active==='true',b.dataset.party||null);await loadTeam();}
    else if(a==='request-payments')requestPaymentsForm();
    else if(a==='request-one')requestPaymentsForm(id);
    else if(a==='request-detail')requestDetail(id);
    else if(a==='cte-column-filter'){const field=b.dataset.field;if(!CTE_FILTER_FIELDS[field])return;const rect=b.getBoundingClientRect();cteFilterFieldOpen=field;cteFilterSearch='';cteFilterAnchor={top:rect.bottom+4,left:rect.left};cteFilterOptions=cteFieldOptions(field);cteFilterDraft=cteColumnFilters[field]?[...cteColumnFilters[field]].filter(value=>cteFilterOptions.includes(value)):[...cteFilterOptions];render();document.querySelector('#cte-filter-search')?.focus();}
    else if(a==='cte-customize')ctePreferencesForm();
    else if(a==='cte-pref-up'||a==='cte-pref-down'){if(!ctePreferenceDraft)return;ctePreferenceDraft.visibleColumns=[...modalContent.querySelectorAll('[data-cte-pref-column]:checked')].map(input=>input.dataset.ctePrefColumn);const index=ctePreferenceDraft.columnOrder.indexOf(b.dataset.field),next=index+(a==='cte-pref-up'?-1:1);if(index<0||next<0||next>=ctePreferenceDraft.columnOrder.length)return;[ctePreferenceDraft.columnOrder[index],ctePreferenceDraft.columnOrder[next]]=[ctePreferenceDraft.columnOrder[next],ctePreferenceDraft.columnOrder[index]];renderCtePreferenceRows();}
    else if(a==='cte-filter-select-all'){cteFilterDraft=[...cteFilterOptions];render();document.querySelector('#cte-filter-search')?.focus();}
    else if(a==='cte-filter-clear-all'){cteFilterDraft=[];render();document.querySelector('#cte-filter-search')?.focus();}
    else if(a==='cte-filter-cancel'){closeCteFilter();render();}
    else if(a==='cte-filter-reset'){delete cteColumnFilters[cteFilterFieldOpen];closeCteFilter();render();}
    else if(a==='cte-filter-apply'){if(cteFilterDraft.length===cteFilterOptions.length)delete cteColumnFilters[cteFilterFieldOpen];else cteColumnFilters[cteFilterFieldOpen]=[...cteFilterDraft];closeCteFilter();render();}
    else if(a==='cte-upload')cteUploadForm();
    else if(a==='cte-refresh')await loadCteData();
    else if(a==='cte-print')window.print();
    else if(a==='cte-download')await showCteDownload(id);
    else if(a==='pay-request')paymentForm(id);
    else if(a==='cancel-request')requestReasonForm(id,'cancel');
        else if(a==='legacy-undo')requestReasonForm(id,'legacy');
    else if(a==='receipt-view')await showReceipt(id);
    else if(a==='close-modal')modal.close();
    else if(a==='new-truck'){if(modal.open)modal.close();truckForm();}
    else if(a==='edit-truck')truckForm(id);
    else if(a==='add-farm')addFarmInput();
    else if(a==='remove-farm')requestFarmAction(id);
    else if(a==='inactivate-farm')requestFarmAction(id,true);
    else if(a==='confirm-remove-farm')await applyFarmAction(id,'remove');
    else if(a==='confirm-inactivate-farm')await applyFarmAction(id,'inactivate');
    else if(a==='reactivate-farm')await applyFarmAction(id,'reactivate');
    else if(a==='transfer-truck')transferForm(id);
    else if(a==='end-activities'){if(modal.open)modal.close();endActivitiesForm(id);}
    else if(a==='truck-history')truckHistory(id);
    else if(a==='transfer-review-closing'||a==='end-review-closing'){const c=state.closings.find(x=>x.id===b.dataset.closing);if(!c)throw Error('Este fechamento não está disponível.');currentMonth=c.period.month;currentHalf=c.period.half;farmFilter=b.dataset.farm||'';modal.close();location.hash='closings';render();detail(id);}
    else if(a==='new-discount'){if(modal.open)modal.close();discountForm(null,id);}
    else if(a==='edit-discount')requestDiscountAction(id,'edit');
    else if(a==='half'){currentHalf=Number(b.dataset.half);render();}
    else if(a==='detail')detail(id);
    else if(a==='close-period')closePeriodModal();
    else if(a==='confirm-close'){const farm=document.querySelector('#closing-farm')?.value||'';await remoteCommand('period.close',{month:currentMonth,half:currentHalf,farmId:farm});modal.close();render();notify('Fechamento salvo somente para as placas pendentes.');}
    else if(a==='show-closing')closingSummary();
    else if(a==='go-closings'){modal.close();location.hash='closings';render();}
    else if(a==='reopen-period')reopenPeriodModal();
    else if(a==='confirm-reopen'){const farm=document.querySelector('#reopening-farm')?.value||'';await remoteCommand('period.reopen',{month:currentMonth,half:currentHalf,farmId:farm});modal.close();render();notify('A seleção foi reaberta para ajustes.');}
    else if(a==='reopen-batch'){const batch=state.closings.find(c=>c.id===id);if(!batch||batch.kind!=='complement')throw Error('Selecione um fechamento complementar.');if(batch.rows.some(r=>r.paid))throw Error('Há pagamentos registrados neste complemento.');confirmation('Reabrir somente este complemento?',periodLabel(batch.period)+' · Os outros fechamentos e pagamentos serão preservados.','confirm-reopen-batch',id);}
    else if(a==='confirm-reopen-batch'){const batch=state.closings.find(c=>c.id===id);if(!batch||batch.kind!=='complement')throw Error('Confira o complemento selecionado.');await remoteCommand('period.reopen',{month:batch.period.month,half:batch.period.half,closingId:batch.id});currentMonth=batch.period.month;currentHalf=batch.period.half;modal.close();render();notify('Somente o complemento foi reaberto.');}
    else if(a==='history-details')historyDetails(id);
    else if(a==='history-reopen-truck')confirmHistoryReopen(b.dataset.closing,b.dataset.truck);
    else if(a==='history-reopen-closing'){const h=state.closings.find(item=>item.id===id);if(!h)throw Error('Este fechamento não está mais disponível.');const blocked=h.rows.map(row=>historyReopenBlock(h,row)).find(Boolean);if(blocked)throw Error(blocked);confirmHistoryReopen(id);}
    else if(a==='confirm-history-reopen-truck'){const h=state.closings.find(item=>item.id===b.dataset.closing),row=h?.rows.find(item=>item.truckId===b.dataset.truck);if(!h||!row)throw Error('Confira novamente a placa selecionada.');const blocked=historyReopenBlock(h,row);if(blocked)throw Error(blocked);await remoteCommand('period.reopen-truck',{month:h.period.month,half:h.period.half,closingId:h.id,truckId:row.truckId});currentMonth=h.period.month;currentHalf=h.period.half;farmFilter=row.farmId;modal.close();render();notify('Somente esta placa foi reaberta para ajustes.');}
    else if(a==='confirm-history-reopen-closing'){const h=state.closings.find(item=>item.id===b.dataset.closing);if(!h)throw Error('Este fechamento não está mais disponível.');const blocked=h.rows.map(row=>historyReopenBlock(h,row)).find(Boolean);if(blocked)throw Error(blocked);await remoteCommand('period.reopen',{month:h.period.month,half:h.period.half,closingId:h.id});currentMonth=h.period.month;currentHalf=h.period.half;farmFilter='';modal.close();render();notify('A quinzena inteira foi reaberta para ajustes.');}
    else if(a==='pay')paymentForm(id);
    else if(a==='undo-payment')confirmation('Desfazer registro de pagamento?','O caminhão voltará a aparecer como “Fechado”. Isso altera somente o registro no controle.','confirm-undo-payment',id);
    else if(a==='confirm-undo-payment'){await remoteCommand('payment.undo',{closingId:rowClosing(id).id,truckId:id});modal.close();render();notify('Registro desfeito. O valor voltou ao saldo a pagar.');}
    else if(a==='delete-discount')requestDiscountAction(id,'delete');
    else if(a==='confirm-discount-reopen-edit')await applyDiscountReopen(id,'edit');
    else if(a==='confirm-discount-reopen-delete')await applyDiscountReopen(id,'delete');
    else if(a==='review-discount-payment'||a==='view-history-payment'){const batch=state.closings.find(c=>c.id===b.dataset.closing);if(!batch)throw Error('O fechamento selecionado não está mais disponível.');currentMonth=batch.period.month;currentHalf=batch.period.half;farmFilter=b.dataset.farm||'';modal.close();location.hash='closings';render();detail(id);}
    else if(a==='confirm-delete-discount'){const d=state.discounts.find(d=>d.id===id);if(!d)return;if(discountLocked(d,state))throw Error('Reabra a quinzena antes de excluir este desconto.');await remoteCommand('discount.remove',{id});modal.close();render();notify('Desconto excluído.');}
    else if(a==='view-period'){currentMonth=b.dataset.month;currentHalf=Number(b.dataset.half);farmFilter=b.dataset.farm||'';render();window.scrollTo({top:0,behavior:'smooth'});}
    else if(a==='export-csv')exportCsv();
    else if(a==='report'||a==='print')openReport(a==='report'?id||'':'',b);
    else if(a==='print-report')printReport();
    else if(a==='close-report')closeReport();
    else if(a==='demo')await addDemo();
    else if(a==='remove-demo'){if(state.closings.some(c=>c.rows.some(r=>state.trucks.find(t=>t.id===r.truckId)?.sample)))throw Error('Reabra os fechamentos dos exemplos antes de removê-los.');confirmation('Remover dados de exemplo?','Somente as placas marcadas como exemplo e seus descontos serão removidos. Cadastros criados por você serão preservados.','confirm-remove-demo');}
    else if(a==='confirm-remove-demo'){const ids=state.trucks.filter(t=>t.sample).map(t=>t.id);if(state.closings.some(c=>c.rows.some(r=>ids.includes(r.truckId))))throw Error('Reabra os fechamentos dos exemplos primeiro.');await remoteCommand('examples.remove',{});modal.close();render();notify('Exemplos removidos.');}
    else if(a==='backup'){if(loadError)throw Error('Os registros precisam ser recuperados antes de exportar.');download(JSON.stringify(state,null,2),'application/json',`frota-backup-${today()}.json`);notify('Backup completo baixado.');}
    else if(a==='import-backup')document.querySelector('#backup-file').click();
    else if(a==='confirm-import'){if(!pendingBackup)return;await remoteCommand('backup.import',{state:pendingBackup});pendingBackup=null;loadError='';modal.close();farmFilter='';render();notify('Backup restaurado.');}
  }catch(err){notify(err.message||'Não foi possível salvar. Atualize os dados para conferir o salvamento no servidor.');}
});
document.addEventListener('submit',async ev=>{
  const f=ev.target;
  if(f.id==='access-form'){
    ev.preventDefault();const values=new FormData(f),button=f.querySelector('[type="submit"]');button.disabled=true;
    try{
      const email=String(values.get('email')),password=String(values.get('password')),companyName=String(values.get('companyName')||'');
      if(inviteTicket&&inviteInfo&&!inviteSignin)await cloud.register(inviteTicket,email,password,companyName);
      const data=await cloud.login(email,password,inviteTicket&&inviteSignin?inviteTicket:null,companyName);
      adoptServerData(data);farmDraftDirty=false;stale=false;inviteTicket=null;inviteInfo=null;inviteSignin=false;location.hash=isCarrier()?'#requests':'#overview';render();
    }catch(error){if(error.code==='ACCOUNT_EXISTS'){inviteSignin=true;renderAccess();formError(document.querySelector('#access-form'),authErrorMessage(error));}else formError(f,authErrorMessage(error));}
    finally{button.disabled=false;}return;
  }
  if(f.id==='invite-form'){
    ev.preventDefault();const values=new FormData(f),button=f.querySelector('[type="submit"]');button.disabled=true;
    try{const profile=String(values.get('profile')||'group:'+String(values.get('role')||'operator')).split(':'),result=await cloud.invite(String(values.get('email')),profile[1],profile[0]),link=location.origin+location.pathname+'#activate='+result.ticket;document.querySelector('#invite-result').innerHTML=`<div class="form-note" style="margin-top:15px"><strong>${result.emailSent ? 'Convite enviado para ' + e(result.email) : 'Convite criado para ' + e(result.email)}</strong><p>${result.emailSent ? 'O e-mail foi enviado. O funcionário pode criar a própria senha pelo convite.' : e(result.emailMessage)}</p><p>O link individual também fica disponível para copiar. Validade: 72 horas.</p><input aria-label="Link de acesso" readonly value="${e(link)}" style="margin-top:10px" onclick="this.select()"></div>`;}
    catch(error){formError(f,authErrorMessage(error));}finally{button.disabled=false;}return;
  }
  if(f.id==='cte-upload-form'){
    ev.preventDefault();const values=new FormData(f),file=values.get('file'),button=f.querySelector('[type="submit"]');button.disabled=true;
    try{if(!file||!file.size||file.size>20*1024*1024)throw Error('Anexe o PDF ou XML do CT-e, de até 20 MB.');await cloud.uploadCte({file});modal.close();await loadCteData();notify('CT-e lido automaticamente e disponível para o grupo.');}
    catch(error){formError(f,authErrorMessage(error));}finally{button.disabled=false;}return;
  }
  if(f.id==='cte-preferences-form'){
    ev.preventDefault();const visibleColumns=[...f.querySelectorAll('[data-cte-pref-column]:checked')].map(input=>input.dataset.ctePrefColumn),button=f.querySelector('[type="submit"]');button.disabled=true;
    try{if(!visibleColumns.length)throw Error('Mantenha pelo menos uma coluna visível.');const saved=await cloud.saveCtePreferences({visibleColumns,columnOrder:ctePreferenceDraft.columnOrder});ctePreferences=saved.preferences;ctePreferenceDraft=null;modal.close();if(view==='ctes')main.innerHTML=ctesView();notify('Personalização salva na sua conta.');}
    catch(error){formError(f,authErrorMessage(error));}finally{button.disabled=false;}return;
  }
  if(['request-payments-form','request-reason-form'].includes(f.id)){
    ev.preventDefault();const data=new FormData(f),button=f.querySelector('[type="submit"]');button.disabled=true;
    try{if(f.id==='request-payments-form'){await remoteCommand('payment.request',{month:currentMonth,half:currentHalf,farmId:farmFilter,truckId:f.dataset.truckId||''});portalPeriod=currentPeriod().key;portalFarm=farmFilter;modal.close();location.hash='#requests';render();notify('Solicitações enviadas à transportadora.');}
    else{const note=String(data.get('note')||'').trim();if(!note)throw Error('Informe o motivo.');await remoteCommand(f.dataset.operation==='cancel'?'payment.cancel':'payment.undo',f.dataset.operation==='legacy'?{closingId:rowClosing(f.dataset.id).id,truckId:f.dataset.id,note}:{requestId:f.dataset.id,note});modal.close();render();notify(f.dataset.operation==='cancel'?'Solicitação cancelada. O fechamento pode ser reaberto.':'Correção registrada. O histórico e os comprovantes anteriores foram preservados.');}}
    catch(error){formError(f,error.message);}finally{button.disabled=false;}return;
  }
  if(!['truck-form','discount-form','payment-form','farms-form','transfer-form','end-activities-form'].includes(f.id))return;ev.preventDefault();const data=new FormData(f);
  try {
    if(f.id==='truck-form'){
      const id=f.dataset.id||uid(),prior=state.trucks.find(t=>t.id===id),method=String(data.get('paymentMethod')||'');
      const selectedBank=String(data.get('paymentBankSelection')||'');
      const paymentDetails=normalizePaymentDetails({method,holder:String(data.get('paymentHolder')||''),document:formatPaymentDocument(data.get('paymentDocument')),pixKey:method==='pix'?String(data.get('paymentPixKey')||''):'',bankName:method==='bank'?(selectedBank==='other'?String(data.get('paymentOtherBankName')||''):selectedBank):'',agency:method==='bank'?String(data.get('paymentAgency')||''):'',account:method==='bank'?String(data.get('paymentAccount')||''):'',accountType:method==='bank'?String(data.get('paymentAccountType')||''):''});
      const t={id,plate:String(data.get('plate')).toUpperCase().replace(/[^A-Z0-9]/g,''),driver:String(data.get('driver')).trim(),carrier:String(data.get('carrier')).trim(),farmId:data.get('farmId')||prior?.farmId,bodyType:data.get('bodyType'),axles:Number(data.get('axles')==='other'?data.get('otherAxles'):data.get('axles')),monthly:parseAmount(data.get('monthly')),start:data.get('start'),end:data.get('end')||'',paymentDetails,...(prior?.sample?{sample:true}:{}),...(prior?.transferIn?{transferIn:structuredClone(prior.transferIn)}:{}),...(prior?.transferOut?{transferOut:structuredClone(prior.transferOut)}:{}),...(prior?.serviceEnded?{serviceEnded:structuredClone(prior.serviceEnded)}:{})};
      validateTruck(t,state,true);await remoteCommand('truck.save',t);modal.close();render();notify('Cadastro salvo.');
    }
    else if(f.id==='end-activities-form'){const date=String(data.get('date'));await remoteCommand('truck.end',{id:f.dataset.id,date,note:String(data.get('note')||'')});currentMonth=date.slice(0,7);currentHalf=Number(date.slice(8))<=15?1:2;farmFilter='';modal.close();location.hash='closings';render();notify('Atividades encerradas e quinzena desta placa fechada.');}
    else if(f.id==='transfer-form'){await remoteCommand('truck.transfer',{id:f.dataset.id,toFarmId:String(data.get('toFarmId')),date:String(data.get('date')),note:String(data.get('note')||'')});farmFilter='';modal.close();render();notify('Transferência registrada. Confira os períodos e valores por fazenda.');}
    else if(f.id==='discount-form'){const byAmount=data.get('kind')==='amount',d={id:f.dataset.id||uid(),truckId:data.get('truckId'),start:byAmount?data.get('date'):data.get('start'),end:byAmount?data.get('date'):data.get('end'),reason:byAmount?'Valor':data.get('reason'),note:String(data.get('note')||'').trim(),...(byAmount?{kind:'amount',amount:parseAmount(data.get('amount'))}:{})};validateDiscount(d,state);await remoteCommand('discount.save',d);modal.close();render();notify('Desconto salvo e prévia atualizada.');}
    else if(f.id==='payment-form'){
      if(!isCarrier()||!canOperate())throw Error('O pagamento exige acesso da transportadora.');
      const date=data.get('date'),file=data.get('receipt'),requestId=f.dataset.requestId;if(!validDate(date)||date>today())throw Error('Informe uma data de pagamento válida, até hoje.');
      if(!file||!file.size||file.size>10*1024*1024)throw Error('Anexe um comprovante em PDF, JPG ou PNG de até 10 MB.');
      const button=f.querySelector('[type="submit"]');button.disabled=true;try{const receipt=await cloud.uploadReceipt(requestId,file);await remoteCommand('payment.record',{requestId,date,note:String(data.get('note')||'').trim(),receiptId:receipt.id});modal.close();render();notify('Pagamento registrado com comprovante.');}finally{button.disabled=false;}
    }
    else if(f.id==='farms-form'){const farms=[...f.querySelectorAll('[data-farm-id]')].map(input=>({...state.farms.find(farm=>farm.id===input.dataset.farmId),id:input.dataset.farmId,name:input.value.trim()}));if(!farms.length||farms.some(farm=>!farm.name))throw Error('Preencha o nome de cada fazenda.');if(farms.some(farm=>farm.name.length>80))throw Error('Use até 80 caracteres para o nome da fazenda.');if(new Set(farms.map(farm=>farm.name.toLocaleLowerCase('pt-BR'))).size!==farms.length)throw Error('Use nomes diferentes para identificar cada fazenda.');await remoteCommand('farms.save',{farms});farmDraftDirty=false;render();notify('Fazendas salvas.');}
  }catch(err){formError(f,err.message||'Não foi possível salvar. Atualize os dados para conferir o salvamento no servidor.');}
});
document.addEventListener('change',async ev=>{
  const el=ev.target;
  if(el.matches?.('[data-member-profile]')){try{const [party,role]=el.value.split(':');await cloud.updateMember(el.dataset.id,role,el.dataset.active==='true',party);await loadTeam();notify('Perfil de acesso atualizado.');}catch(error){notify(error.message);await loadTeam();}return;}
  if(el.id==='request-period'){portalPeriod=el.value;render();return;}
  if(el.id==='request-farm'){portalFarm=el.value;render();return;}
  if(el.id==='cte-farm-filter'){cteFarmFilter=el.value;render();return;}
  if(el.matches?.('[data-cte-filter-option]')){const value=el.value;cteFilterDraft=el.checked?[...new Set([...cteFilterDraft,value])]:cteFilterDraft.filter(item=>item!==value);return;}
  if(['report-month','report-half','report-farm','report-scope','report-plate'].includes(el.id)){updateReportPeriod();return;}
  if(el.id==='period-month'){if(/^\d{4}-\d{2}$/.test(el.value)){currentMonth=el.value;render();}}
  else if(el.id==='farm-filter'){farmFilter=el.value;render();}
  else if(['discount-kind','discount-reason'].includes(el.id))updateDiscountKind(el.form);
  else if(['discount-start','discount-end','truck-start','truck-end'].includes(el.id))updateDateRange(el.form);
  else if(el.id==='truck-axles'){const other=el.value==='other',field=document.querySelector('#other-axles-field'),input=document.querySelector('#truck-other-axles');field.hidden=!other;input.required=other;if(!other)input.value='';}
  else if(el.id==='truck-payment-method')updateTruckPaymentFields(el.form);
  else if(el.id==='truck-payment-bank')updateOtherBankField(el.form);
  else if(el.id==='activity-end-date')updateActivityEndPreview();
  else if(el.id==='transfer-farm'||el.id==='transfer-date')updateTransferPreview();
  else if(el.id==='closing-farm')updateClosingPreview();
  else if(el.id==='reopening-farm')updateReopeningPreview();
  else if(el.id==='backup-file'&&el.files[0]){try{const file=el.files[0];if(file.size>10000000)throw Error('O arquivo é grande demais para este controle.');pendingBackup=applyFixedMonthlyRule(validateState(JSON.parse(await file.text())));confirmation('Restaurar este backup?',`O arquivo contém ${pendingBackup.trucks.length} caminhão(ões), ${pendingBackup.discounts.length} desconto(s) e ${pendingBackup.closings.length} fechamento(s). Os registros atuais da empresa serão substituídos no banco online. Baixe um backup dos registros atuais antes de continuar, se precisar preservá-los.`,'confirm-import');}catch(err){pendingBackup=null;notify(err.message||'Não foi possível ler o backup.');}el.value='';}
});
document.addEventListener('input',ev=>{if(ev.target.id==='request-search'){portalSearch=ev.target.value;const pos=ev.target.selectionStart;render();const el=document.querySelector('#request-search');el.focus();el.setSelectionRange(pos,pos);}if(ev.target.id==='truck-search'){search=ev.target.value;const pos=ev.target.selectionStart;render();const el=document.querySelector('#truck-search');el.focus();el.setSelectionRange(pos,pos);}});
modal.addEventListener('click',ev=>{if(ev.target===modal){const r=modal.getBoundingClientRect();if(ev.clientX<r.left||ev.clientX>r.right||ev.clientY<r.top||ev.clientY>r.bottom)modal.close();}});

function updateDateRange(form) {
  if(!form||!['truck-form','discount-form'].includes(form.id))return;
  if(form.id==='discount-form'&&form.elements.kind?.value==='amount')return;
  const start=form.elements.start,end=form.elements.end,error=dateRangeError(start.value,end.value,form.id==='discount-form');
  end.min=start.value||'';end.setCustomValidity(error);end.setAttribute('aria-invalid',error?'true':'false');
  const box=form.querySelector('.range-error');box.textContent=error;box.classList.toggle('visible',!!error);
  form.querySelector('[type="submit"]').disabled=!!error;
  if(form.id==='discount-form') {
    const length=form.querySelector('#discount-length');
    length.textContent=error?'Corrija as datas para calcular o desconto.':!start.value||!end.value?'Informe as duas datas para calcular os dias.':days(start.value,end.value)+' dia(s) de desconto, incluindo o primeiro e o último dia.';
  }
}
document.addEventListener('input',ev=>{
  if(ev.target.id==='truck-payment-document')maskPaymentDocumentInput(ev.target);
  if(['discount-start','discount-end','truck-start','truck-end'].includes(ev.target.id))updateDateRange(ev.target.form);
  if(['truck-monthly','discount-amount'].includes(ev.target.id))ev.target.setCustomValidity('');
  if(ev.target.id==='transfer-date')updateTransferPreview();
  if(ev.target.id==='activity-end-date')updateActivityEndPreview();
});
document.addEventListener('keydown',ev=>{
  if(ev.key==='Escape'&&cteFilterFieldOpen){closeCteFilter();render();return;}
  const input=ev.target;
  if(input.id!=='truck-payment-document'||!['Backspace','Delete'].includes(ev.key)||input.selectionStart!==input.selectionEnd)return;
  const position=input.selectionStart,backward=ev.key==='Backspace',separator=input.value[position-(backward?1:0)];
  if(!separator||/\d/.test(separator))return;
  ev.preventDefault();
  const digitCount=input.value.slice(0,position).replace(/\D/g,'').length;
  const digits=input.value.replace(/\D/g,'');
  const removedIndex=backward?digitCount-1:digitCount;
  if(removedIndex<0||removedIndex>=digits.length)return;
  const formatted=formatPaymentDocumentInput(digits.slice(0,removedIndex)+digits.slice(removedIndex+1));
  input.value=formatted;
  const nextPosition=documentCaret(formatted,backward?removedIndex:digitCount);
  input.setSelectionRange?.(nextPosition,nextPosition);
});
document.addEventListener('focusout',ev=>{
  if(ev.target.id==='truck-payment-document'){ev.target.value=formatPaymentDocumentInput(ev.target.value);return;}
  if(!['truck-monthly','discount-amount'].includes(ev.target.id))return;
  const n=parseAmount(ev.target.value);
  if(Number.isFinite(n)&&n>0){ev.target.value=amountLabel(n);ev.target.setCustomValidity('');}
  else if(ev.target.value.trim())ev.target.setCustomValidity('Informe um valor válido. Exemplo: 40.000,00.');
});

document.addEventListener('input',event=>{if(event.target.matches?.('[data-farm-id]'))farmDraftDirty=true;if(event.target.id==='cte-filter-search'){cteFilterSearch=event.target.value;const query=cteFilterSearch.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');document.querySelectorAll('[data-cte-option-row]').forEach(row=>row.hidden=!row.textContent.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').includes(query));}});
window.addEventListener('hashchange',()=>{render();window.scrollTo(0,0);});
async function restoreSession(){
  if(!cloud.hasSession()){render();return;}
  document.body.classList.add('logged-out');
  main.innerHTML='<div class="login-page"><section class="auth-card"><div class="auth-brand">frota<span>.</span></div><h1>Restaurando acesso</h1><p>Conferindo sua sessão com o servidor…</p></section></div>';
  try{adoptServerData(await cloud.load());render();}
  catch(error){
    if(error.status===400||error.status===401||error.status===403){cloud.forgetSession();render();return;}
    main.innerHTML=`<div class="login-page"><section class="auth-card"><div class="auth-brand">frota<span>.</span></div><h1>Não foi possível conectar</h1><p>${e(authErrorMessage(error))}</p><div class="actions" style="margin-top:20px"><button class="btn primary" data-action="restore-session">Tentar novamente</button><button class="btn" data-action="forget-session">Entrar novamente</button></div></section></div>`;
  }
}
if(inviteTicket)render();else restoreSession();
if(inviteTicket){cloud.inspectInvite(inviteTicket).then(info=>{inviteInfo=info;renderAccess();}).catch(error=>{const message=document.querySelector('#invite-message');if(message)message.textContent=authErrorMessage(error);});}
let checkingUpdates=false,nextGroupCheck=0,nextCteCheck=0;
async function checkForUpdates(force=false){
  if(!currentUser||saving||checkingUpdates||document.visibilityState==='hidden')return;
  if(view==='ctes'&&!modal.open&&Date.now()>=nextCteCheck){nextCteCheck=Date.now()+30000;await loadCteData();}
  if(!force&&!isCarrier()&&Date.now()<nextGroupCheck)return;
  if(!isCarrier())nextGroupCheck=Date.now()+60000;
  const userId=currentUser.id;checkingUpdates=true;
  try{
    const next=await cloud.version();
    if(!currentUser||currentUser.id!==userId||saving)return;
    if(stale||next.revision!==serverRevision||next.role&&next.role!==currentUser.role||next.party&&next.party!==currentUser.party){
      if(modal.open||reportDialog.open||farmDraftDirty){stale=true;updateCloudStatus();}
      else{
        const knownRequests=new Set(portalRequests.map(request=>request.id));
        if(!await refreshServerData({automatic:true}))return;
        if(isCarrier()){
          const added=portalRequests.filter(request=>request.status==='pending'&&!knownRequests.has(request.id)).length;
          if(added)notify(added===1?'Nova solicitação de pagamento recebida.':`${added} novas solicitações de pagamento recebidas.`);
        }
      }
    }
  }catch(error){
    if(error.status===401||error.status===403){cloud.forgetSession();currentUser=null;state=initialState();modal.close();reportDialog.close();render();}
    else{stale=true;updateCloudStatus();}
  }finally{checkingUpdates=false;}
}
setInterval(checkForUpdates,15000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')checkForUpdates(true);});
window.addEventListener('focus',()=>checkForUpdates(true));
modal.addEventListener('close',()=>{if(stale&&currentUser)checkForUpdates(true);});
reportDialog.addEventListener('close',()=>{if(stale&&currentUser)checkForUpdates(true);});

function requestPaymentsButton(){const list=filteredRows().filter(r=>r.closed&&!r.paid&&!r.requestId&&r.net>0);return `<button class="btn primary" data-action="request-payments" ${!list.length||!canOperate()?'disabled':''}>Solicitar pagamentos</button>`;}
function portalClosingNotice(list){const count=list.filter(r=>r.requestId&&!r.paid).length;return `<div class="notice neutral"><span>${count?count+' placa(s) já solicitada(s) à transportadora.':'Depois do fechamento, solicite os pagamentos à transportadora. O grupo acompanha os comprovantes pelo portal.'}</span><a href="#requests">Acompanhar solicitações →</a></div>`;}
function paymentDetailsMarkup(input,status='pending'){
 const missing=paymentDetailsMissing(input);
 if(missing.length)return `<div class="form-note warn"><strong>Dados de pagamento não registrados nesta solicitação.</strong>${status==='pending'?'<br>O grupo precisa cancelar a solicitação, preencher o cadastro da placa e enviar novamente.':''}</div>`;
 const details=normalizePaymentDetails(input);
 const destination=details.method==='pix'?`Chave Pix: <strong>${e(details.pixKey)}</strong>`:`Banco: <strong>${e(details.bankName)}</strong><br>Agência: <strong>${e(details.agency)}</strong> · Conta: <strong>${e(details.account)}</strong> · Tipo: <strong>${e({corrente:'Corrente',poupanca:'Poupança',pagamento:'Pagamento'}[details.accountType])}</strong>`;
 return `<div class="form-note"><strong>Dados para pagamento</strong><br>${e(PAYMENT_METHODS[details.method])} · Titular: <strong>${e(details.holder)}</strong><br>CPF/CNPJ: <strong>${e(formatPaymentDocument(details.document))}</strong><br>${destination}</div>`;
}
function requestPaymentsForm(truckId=''){
 if(isCarrier()||!canOperate())throw Error('A solicitação exige acesso do grupo.');const list=filteredRows().filter(r=>r.closed&&!r.paid&&!r.requestId&&r.net>0&&(!truckId||r.truckId===truckId));if(!list.length)throw Error('Não há placas fechadas e sem solicitação nesta seleção.');
 const entries=list.map(row=>({row,missing:paymentDetailsMissing(state.trucks.find(t=>t.id===row.truckId)?.paymentDetails)})),blocked=entries.filter(item=>item.missing.length);
 openModal('Solicitar pagamentos à transportadora',periodLabel(currentPeriod()),`<form id="request-payments-form" data-truck-id="${e(truckId)}">${errBox()}<div class="form-note">${list.length} pagamento(s) · ${e(farmFilter?state.farms.find(f=>f.id===farmFilter)?.name:'Todas as fazendas selecionadas')}<br>Total solicitado: <strong>${money(sum(list,'net'))}</strong></div>${blocked.length?`<div class="form-note warn"><strong>${blocked.length} placa(s) sem dados de pagamento completos.</strong><br>Edite cada cadastro abaixo antes de enviar a solicitação.</div>`:''}<div class="request-preview">${entries.map(({row,missing})=>`<div><span><strong>${e(row.plate)}</strong> · ${e(row.driver)}<small>${e(row.farmName)}</small>${missing.length?`<small>Faltam: ${e(missing.join(', '))}</small>`:'<small>Dados de pagamento completos</small>'}</span><span class="request-preview-actions"><strong>${money(row.net)}</strong>${missing.length?`<button class="btn small" type="button" data-action="edit-truck" data-id="${e(row.truckId)}">Preencher dados</button>`:''}</span></div>`).join('')}</div><p class="secondary">Cada placa será enviada com o valor fechado e os dados de pagamento. Para corrigir uma solicitação pendente, cancele-a e envie novamente.</p><div class="form-actions"><button class="btn" type="button" data-action="close-modal">Conferir novamente</button><button class="btn primary" type="submit" ${blocked.length?'disabled':''}>Enviar solicitações</button></div></form>`);
}
function requestReasonForm(id,operation){const title=operation==='cancel'?'Cancelar solicitação':operation==='legacy'?'Corrigir registro anterior ao portal':'Corrigir registro de pagamento';openModal(title,'O motivo e o histórico serão preservados.',`<form id="request-reason-form" data-id="${e(id)}" data-operation="${e(operation)}">${errBox()}<div class="field"><label>Motivo *</label><textarea name="note" required maxlength="300" placeholder="Explique por que o registro precisa ser corrigido"></textarea></div><div class="form-note">${operation==='cancel'?'O pagamento ainda não foi registrado no portal. Confira com a transportadora antes de cancelar. O cancelamento libera o fechamento para ajustes.':'Esta ação corrige o controle no portal. Confirme a situação da transferência antes de continuar.'}</div><div class="form-actions"><button class="btn" type="button" data-action="close-modal">Voltar</button><button class="btn danger" type="submit">Confirmar com motivo</button></div></form>`);}
const requestStatus=r=>r.status==='paid'?'Pago':r.status==='cancelled'?'Solicitação cancelada':'Fechado, aguardando pagamento';
const timeLabel=value=>value?new Date(value).toLocaleString('pt-BR',{timeZone:'America/Cuiaba'}):'—';
function requestsView(){
 const periods=[...new Map(portalRequests.map(r=>[r.period.key,r.period])).values()].sort((a,b)=>b.key.localeCompare(a.key));
 const farms=isCarrier()?[...new Map(portalRequests.map(r=>({id:r.snapshot.farmId,name:r.snapshot.farmName})).map(f=>[f.id,f])).values()]:state.farms;
 const base=portalRequests.filter(r=>(!portalPeriod||r.period.key===portalPeriod)&&(!portalFarm||r.snapshot.farmId===portalFarm)&&(!portalSearch||(r.snapshot.plate+' '+r.snapshot.driver).toLocaleLowerCase('pt-BR').includes(portalSearch.toLocaleLowerCase('pt-BR')))).sort((a,b)=>b.requestedAt.localeCompare(a.requestedAt)||a.snapshot.farmName.localeCompare(b.snapshot.farmName));
 const pendingRows=base.filter(r=>r.status==='pending'),historyRows=base.filter(r=>r.status!=='pending');
 const paid=round(base.filter(r=>r.status==='paid').reduce((n,r)=>n+r.snapshot.net,0)),pending=round(pendingRows.reduce((n,r)=>n+r.snapshot.net,0));
 const rowsMarkup=list=>list.map(r=>`<tr><td><strong class="plate">${e(r.snapshot.plate)}</strong><span class="secondary">${e(r.snapshot.driver)}</span></td><td>${e(r.snapshot.farmName)}<span class="secondary">${e(periodLabel(r.period))}</span></td><td class="num value">${money(r.snapshot.net)}</td><td><span class="badge ${r.status==='paid'?'green':r.status==='cancelled'?'gray':'amber'}">${requestStatus(r)}</span>${r.status==='paid'&&r.payment?`<span class="secondary">Pago em ${dateLabel(r.payment.date)}</span>`:r.status==='cancelled'?`<span class="secondary">Cancelada em ${dateLabel((r.cancelledAt||r.requestedAt).slice(0,10))}</span>`:`<span class="secondary">Solicitado em ${dateLabel(r.requestedAt.slice(0,10))}</span>`}${r.status==='pending'&&paymentDetailsMissing(r.snapshot.paymentDetails).length?'<span class="secondary">Faltam dados de pagamento</span>':''}</td><td><div class="actions">${r.status==='pending'&&isCarrier()&&canOperate()&&!paymentDetailsMissing(r.snapshot.paymentDetails).length?`<button class="btn primary small" data-action="pay-request" data-id="${e(r.id)}">Registrar pagamento</button>`:''}${r.payment?.receipt?`<button class="btn small" data-action="receipt-view" data-id="${e(r.payment.receipt.id)}">Comprovante</button>`:''}<button class="btn small" data-action="request-detail" data-id="${e(r.id)}">Detalhes</button></div></td></tr>`).join('');
 const table=list=>`<div class="table-wrap"><table><thead><tr><th>PLACA / MOTORISTA</th><th>FAZENDA / QUINZENA</th><th class="num">VALOR SOLICITADO</th><th>SITUAÇÃO / DATA</th><th>AÇÕES</th></tr></thead><tbody>${rowsMarkup(list)}</tbody></table></div>`;
 return head(isCarrier()?'Pagamentos da transportadora':'Solicitações de pagamento',isCarrier()?'Receba as solicitações do grupo e registre cada pagamento com comprovante.':'Acompanhe os pagamentos por placa e consulte o histórico.','','GRUPO E TRANSPORTADORA')+`<div class="period-bar"><div class="period-controls"><select id="request-period" aria-label="Filtrar quinzena">${opt('','Todas as quinzenas',portalPeriod)}${periods.map(p=>opt(p.key,periodLabel(p),portalPeriod)).join('')}</select><select id="request-farm" aria-label="Filtrar fazenda">${opt('','Todas as fazendas',portalFarm)}${farms.map(f=>opt(f.id,f.name,portalFarm)).join('')}</select><input id="request-search" type="search" value="${e(portalSearch)}" placeholder="Buscar placa ou motorista" aria-label="Buscar placa ou motorista"></div></div><div class="metric-grid request-metrics"><div class="metric"><div class="metric-label">Solicitações nesta seleção</div><div class="metric-value">${base.length}</div></div><div class="metric featured"><div class="metric-label">Aguardando pagamento</div><div class="metric-value money">${money(pending)}</div></div><div class="metric"><div class="metric-label">Pagamentos registrados</div><div class="metric-value money">${money(paid)}</div></div></div><section class="card"><div class="card-header"><div><h2>Aguardando pagamento</h2><p>Solicitações abertas por motorista e placa.</p></div><span class="badge amber">${pendingRows.length}</span></div>${pendingRows.length?table(pendingRows):`<div class="empty"><h3>Nenhum pagamento pendente nesta seleção</h3><p>Solicitações pagas ou canceladas ficam no histórico abaixo.</p></div>`}<div class="card-footer"><span>${pendingRows.length} solicitação(ões) aguardando pagamento</span><strong>Total: ${money(pending)}</strong></div></section><section class="card" style="margin-top:24px"><div class="card-header"><div><h2>Histórico de solicitações</h2><p>Pagamentos concluídos e solicitações canceladas.</p></div><span class="badge gray">${historyRows.length}</span></div>${historyRows.length?table(historyRows):'<div class="empty"><h3>Nenhuma solicitação no histórico desta seleção</h3><p>Pagamentos registrados e solicitações canceladas aparecerão aqui.</p></div>'}<div class="card-footer"><span>${historyRows.length} registro(s) no histórico</span><strong>Total pago: ${money(paid)}</strong></div></section>`;
}function requestDetail(id){
  const request=portalRequests.find(item=>item.id===id);if(!request)throw Error('Solicitação não encontrada.');
  const row=request.snapshot;
  const paymentActions=request.status==='pending'&&canOperate()?(isCarrier()?(paymentDetailsMissing(row.paymentDetails).length?'':`<button class="btn primary" data-action="pay-request" data-id="${e(id)}">Registrar pagamento com comprovante</button>`):`<button class="btn danger" data-action="cancel-request" data-id="${e(id)}">Cancelar solicitação</button>`):'';
  openModal(row.plate+' · '+row.driver,row.farmName+' · '+periodLabel(request.period),`<div class="form-note"><strong>${requestStatus(request)}</strong><br>Valor solicitado: <strong>${money(row.net)}</strong><br>Solicitado em ${e(timeLabel(request.requestedAt))}${request.requestedEmail?' por '+e(request.requestedEmail):''}</div><div class="detail-grid"><div><small>Valor bruto</small><strong>${money(row.gross)}</strong></div><div><small>Descontos</small><strong>${money(row.discount)}</strong></div><div><small>Dias a pagar</small><strong>${row.payableDays}</strong></div><div><small>Transportador contratado</small><strong>${e(row.carrier)}</strong></div></div>${paymentDetailsMarkup(row.paymentDetails,request.status)}${request.payment?`<div class="form-note">Pago em ${dateLabel(request.payment.date)}${request.payment.recordedEmail?' por '+e(request.payment.recordedEmail):''}<br>${e(request.payment.receipt.name)}<br><button class="btn small" data-action="receipt-view" data-id="${e(request.payment.receipt.id)}">Abrir comprovante</button></div>`:''}${request.status==='cancelled'?`<div class="form-note">Cancelada em ${e(timeLabel(request.cancelledAt))}<br>Motivo: ${e(request.cancelReason)}</div>`:''}${request.paymentHistory.length?`<div class="event-list"><h3>Correções anteriores</h3>${request.paymentHistory.map(item=>`<p>${e(timeLabel(item.at))} · ${e(item.reason)}<br>Pagamento anterior em ${dateLabel(item.payment.date)} · <button class="btn small" data-action="receipt-view" data-id="${e(item.payment.receipt.id)}">Comprovante anterior</button></p>`).join('')}</div>`:''}<div class="form-actions">${paymentActions}<button class="btn" data-action="close-modal">Fechar</button></div>`);
}async function showReceipt(id){const receipt=await cloud.receiptLink(id);openModal('Documento anexado',receipt.name,`<div class="form-note">Arquivo privado. O link de acesso vale por um minuto.</div><div class="form-actions"><a class="btn primary" href="${e(receipt.signedUrl)}" target="_blank" rel="noopener noreferrer">Abrir documento</a><button class="btn" data-action="close-modal">Fechar</button></div>`);}
