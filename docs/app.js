Warning: truncated output (original token count: 70085)
Total output lines: 1262

import {isAmountDiscount,amountDiscountTotal,MODES,BODY_TYPES,PAYMENT_METHODS,normalizePaymentDetails,paymentDetailsMissing,initialState,validateState,validateTruck,validateDiscount,draft,period,periodLabel,dateLabel,days,overlaps,round,money,today,uid,csv,amountLabel,parseAmount,dateRangeError,validDate,periodClosings,farmClosing,openFarmIds,periodRows,closingPreview,saveClosing,reopenClosing,discountLocked,shiftDate,previewTransfer,undoTransferBlockReason,transferTruck,latestTruck,previewEndActivities,endActivities,applyFixedMonthlyRule,farmHasLinks,removeFarm,setFarmActive} from './engine.js?v=123';
import {createReport,reportMarkup} from './reports.js?v=158';
import {cloud,authErrorMessage} from './cloud-ui.js?v=127';

let state=initialState(),loadError='',currentUser=null,currentCompany=null,serverRevision=0,saving=false,stale=false,inviteInfo=null,inviteSignin=false;
let teamMembers=[],teamSelectedFarmId='',farmEditSnapshots=new Map();
let inviteTicket=location.hash.startsWith('#activate=')?location.hash.slice(10):null;
let portalRequests=[],portalPeriod='',portalFarm='',portalInvoice='',portalSearch='',selectedPaymentRequests=new Set();
let cteDocuments=[],cteRequests=[],cteTrucks=[],cteFarms=[],billingInvoices=[],cteFarmFilter='',cteSearch='',ctePage=1,cteQueueSearch='',cteQueuePage=1,cteBillingSearch='',cteBillingPage=1,cteFarmRequestSearch='',cteFarmRequestPage=1,cteColumnFilters={},cteFilterFieldOpen='',cteFilterDraft=[],cteFilterOptions=[],cteFilterSearch='',cteFilterAnchor={top:0,left:0},cteLoading=false,cteSummaryLoaded=false,ctePreferences={visibleColumns:[],columnOrder:[]},ctePreferenceDraft=null,cteRequestForUpload='',farmCteTab='request';
let selectedBillingCteIds=new Set(),cteBillingMonth='';
const formatCteDocument=(value,type)=>{const digits=String(value||'').replace(/\D/g,'');if(type==='cnpj'&&digits.length===14)return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5');if(type==='cpf'&&digits.length===11)return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/,'$1.$2.$3-$4');return value||'—';};
const cteParticipant=(doc,party,key)=>key==='cnpj'||key==='cpf'?formatCteDocument(doc.participantDetails?.[party]?.[key],key):doc.participantDetails?.[party]?.[key]||'—';
const cteParticipantDocument=(doc,party)=>{const cnpj=cteParticipant(doc,party,'cnpj');return cnpj==='—'?cteParticipant(doc,party,'cpf'):cnpj;};
const CTE_FILTER_FIELDS={number:{label:'Número do CT-e',get:doc=>doc.number||'—'},farm:{label:'Fazenda',get:doc=>doc.farmName||'Fazenda não identificada'},shipper:{label:'Remetente',get:doc=>doc.shipper||'—'},recipient:{label:'Destinatário',get:doc=>doc.recipient||'—'},serviceTaker:{label:'Tomador do serviço',get:doc=>doc.serviceTaker||'—'},issuer:{label:'Transportadora',get:doc=>doc.issuer||'—'},totalValue:{label:'Valor do serviço',get:doc=>money(doc.totalValue||0)},issuedOn:{label:'Data de emissão',get:doc=>dateLabel(doc.issuedOn)},plate:{label:'Placa',get:doc=>doc.plate||'—'},cargoWeight:{label:'Peso da carga',get:doc=>doc.cargoWeight==null?'—':`${Number(doc.cargoWeight).toLocaleString('pt-BR',{maximumFractionDigits:3})}${doc.cargoWeightUnit?' '+doc.cargoWeightUnit:' (unidade não informada)'}`},manifestedNotes:{label:'Notas fiscais manifestadas',get:doc=>(doc.manifestedNotes||[]).join(', ')||'—'},shipperCity:{label:'Cidade do remetente',get:doc=>cteParticipant(doc,'shipper','city')},shipperStateRegistration:{label:'IE do remetente',get:doc=>cteParticipant(doc,'shipper','stateRegistration')},shipperDocument:{label:'CPF/CNPJ do remetente',get:doc=>cteParticipantDocument(doc,'shipper')},recipientCity:{label:'Cidade do destinatário',get:doc=>cteParticipant(doc,'recipient','city')},recipientStateRegistration:{label:'IE do destinatário',get:doc=>cteParticipant(doc,'recipient','stateRegistration')},recipientDocument:{label:'CPF/CNPJ do destinatário',get:doc=>cteParticipantDocument(doc,'recipient')},serviceTakerCity:{label:'Cidade do tomador',get:doc=>cteParticipant(doc,'serviceTaker','city')},serviceTakerStateRegistration:{label:'IE do tomador',get:doc=>cteParticipant(doc,'serviceTaker','stateRegistration')},serviceTakerDocument:{label:'CPF/CNPJ do tomador',get:doc=>cteParticipantDocument(doc,'serviceTaker')},issuerCity:{label:'Cidade da transportadora',get:doc=>cteParticipant(doc,'issuer','city')},issuerStateRegistration:{label:'IE da transportadora',get:doc=>cteParticipant(doc,'issuer','stateRegistration')},issuerDocument:{label:'CPF/CNPJ da transportadora',get:doc=>cteParticipantDocument(doc,'issuer')}};
const DEFAULT_CTE_COLUMNS=['number','shipper','recipient','serviceTaker','issuer','totalValue','issuedOn','plate','cargoWeight'],ALL_CTE_COLUMNS=Object.keys(CTE_FILTER_FIELDS);
const isCarrier=()=>currentUser?.party==='carrier';
const isFarmEmployee=()=>currentUser?.party==='farm';
const canOperate=()=>['admin','operator'].includes(currentUser?.role);
let currentMonth=today().slice(0,7), currentHalf=Number(today().slice(8))<=15?1:2, farmFilter='',search='',closingSearch='',view='overview',toastTimer,invoiceSplitAttempted=false,invoiceSplitInProgress=false;
const main=document.querySelector('#main'),modal=document.querySelector('#modal'),modalContent=document.querySelector('#modal-content');
// Mantém o modal anterior disponível quando uma tela de detalhes é aberta por cima dele.
let modalStack=[];
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
function formatStateRegistration(value){
  const text=String(value||'').trim().toLocaleUpperCase('pt-BR'),digits=text.replace(/\D/g,'').slice(0,9);
  if(digits.length===9)return `${digits.slice(0,2)}.${digits.slice(2,5)}.${digits.slice(5,8)}-${digits.slice(8)}`;
  return text;
}
function formatStateRegistrationInput(value){
  const text=String(value||'').trim().toLocaleUpperCase('pt-BR');
  if(/[A-Z]/.test(text))return text.slice(0,30);
  const digits=text.replace(/\D/g,'').slice(0,9);
  if(digits.length<=2)return digits;
  if(digits.length<=5)return `${digits.slice(0,2)}.${digits.slice(2)}`;
  if(digits.length<=8)return `${digits.slice(0,2)}.${digits.slice(2,5)}.${digits.slice(5)}`;
  return `${digits.slice(0,2)}.${digits.slice(2,5)}.${digits.slice(5,8)}-${digits.slice(8)}`;
}
function formatFarmPhoneInput(value){const digits=String(value||'').replace(/\D/g,'').slice(0,11);if(!digits)return '';if(digits.length<=2)return `(${digits}`;const ddd=digits.slice(0,2),local=digits.slice(2),mobile=digits.length>10,prefix=local.slice(0,mobile?5:4),suffix=local.slice(mobile?5:4);return `(${ddd}) ${prefix}${suffix?'-'+suffix:''}`;}
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
function maskStateRegistrationInput(input){
  const digitCount=String(input.value).slice(0,input.selectionStart??input.value.length).replace(/\D/g,'').length;
  const formatted=formatStateRegistrationInput(input.value);
  if(input.value===formatted)return;
  input.value=formatted;
  const position=documentCaret(formatted,Math.min(digitCount,9));
  input.setSelectionRange?.(position,position);
}
function maskFarmPhoneInput(input){
  const digitCount=String(input.value).slice(0,input.selectionStart??input.value.length).replace(/\D/g,'').length;
  const formatted=formatFarmPhoneInput(input.value);
  if(input.value===formatted)return;
  input.value=formatted;
  const position=documentCaret(formatted,Math.min(digitCount,11));
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
const farmField=(farm,index)=>{
 const saved=state.farms.find(item=>item.id===farm.id),inactive=saved?.active===false,action=inactive?'reactivate-farm':saved&&farmHasLinks(state,farm.id)?'inactivate-farm':'remove-farm',label=inactive?'Reativar':action==='inactivate-farm'?'Inativar':'Remover';
 const truckCount=state.trucks.filter(truck=>truck.farmId===farm.id&&truck.start<=today()&&(!truck.end||truck.end>=today())).length,closings=state.closings.filter(closing=>(closing.farmIds||[]).includes(farm.id)),openRows=closings.flatMap(closing=>closing.rows.filter(row=>row.farmId===farm.id&&!row.paid)),openAmount=round(openRows.reduce((total,row)=>total+row.net,0)),requests=cteRequests.filter(request=>request.farmId===farm.id),pendingCte=requests.filter(request=>request.status==='pending').length,receivedCte=requests.filter(request=>request.status==='issued').length,staffCount=teamMembers.filter(member=>member.party==='farm'&&member.farm_id===farm.id&&member.active).length;
 const farmDocument=farm.cnpj&&String(farm.cnpj).replace(/\D/g,'').length===14?farm.cnpj:farm.cpf||farm.cnpj||'',documentType=String(farmDocument).replace(/\D/g,'').length===14?'CNPJ':'CPF',stateRegistration=formatStateRegistration(farm.stateRegistration);
 return `<article class="farm-profile-card"><div class="farm-profile-heading"><div><span class="farm-index">FAZENDA ${String(index+1).padStart(2,'0')}</span><h2>${e(farm.name)}</h2><p>${e(farm.legalName||'Dados do titular ainda não cadastrados')}${farmDocument?' · '+documentType+' '+e(formatPaymentDocument(farmDocument)):''}${stateRegistration?' · IE '+e(stateRegistration):''}</p>${inactive?'<span class="badge gray">Inativa</span>':''}</div><div class="farm-actions">${currentUser?.role==='admin'?`<button class="btn small" type="button" data-action="edit-farm" data-id="${e(farm.id)}">Editar cadastro</button><button class="btn small" type="button" data-action="${action}" data-id="${e(farm.id)}">${label}</button>`:''}</div></div><div class="farm-profile-summary"><span><strong>${truckCount}</strong> placas ativas</span><span><strong>${closings.length}</strong> faturas no histórico</span><span><strong>${money(openAmount)}</strong> em faturas a pagar</span><span><strong>${pendingCte}</strong> CT-e aguardando · <strong>${receivedCte}</strong> recebidos</span>${currentUser?.role==='admin'?`<span><strong>${staffCount}</strong> funcionário(s) ativo(s)`:''}</div><div class="farm-profile-links"><button class="btn small" type="button" data-action="farm-open-trucks" data-id="${e(farm.id)}">Ver placas</button><button class="btn small" type="button" data-action="farm-open-finance" data-id="${e(farm.id)}">Ver faturas</button><button class="btn small" type="button" data-action="farm-open-ctes" data-id="${e(farm.id)}">Ver CT-es</button>${currentUser?.role==='admin'?'<button class="btn small" type="button" data-action="farm-open-team">Equipe</button>':''}</div></article>`;
};
function farmForm(id='') {
 const saved=state.farms.find(farm=>farm.id===id),farm=saved||{id:uid(),name:''},farmDocument=farm.cnpj&&String(farm.cnpj).replace(/\D/g,'').length===14?farm.cnpj:farm.cpf||farm.cnpj||'',profile=(key,label,type='text',placeholder='',max=120,value=farm[key]||'')=>`<div class="field"><label for="farm-${key}">${label}</label><input id="farm-${key}" name="${key}" type="${type}" value="${e(key==='stateRegistration'?formatStateRegistrationInput(value):value)}" maxlength="${max}" placeholder="${placeholder}" ${key==='document'?'inputmode="numeric" autocomplete="off"':''}></div>`;
 openModal(saved?'Editar fazenda':'Cadastrar fazenda','Informe os dados desta unidade.',`<form id="farm-form" data-id="${e(farm.id)}">${errBox()}<div class="field"><label for="farm-name">Nome para identificar *</label><input id="farm-name" name="name" value="${e(farm.name)}" maxlength="80" placeholder="Ex.: Fazenda Santa Clara" required></div><div class="farm-profile-fields">${profile('legalName','Nome ou razão social do titular','text','Nome ou razão social')}${profile('document','CPF ou CNPJ do titular','text','CPF ou CNPJ',18,formatPaymentDocumentInput(farmDocument))}${profile('stateRegistration','Inscrição estadual','text','Inscrição estadual',30)}${profile('address','Endereço','text','Endereço da unidade',180)}${profile('contactName','Pessoa de contato','text','Nome do responsável',100)}${profile('contactEmail','E-mail de contato','email','contato@fazenda.com.br',160)}${profile('contactPhone','Telefone de contato','tel','(00) 00000-0000',30,formatFarmPhoneInput(farm.contactPhone||''))}</div><div class="form-note">Os caminhões, faturas, funcionários e pedidos de CT-e serão vinculados a esta fazenda.</div><div class="form-actions"><button class="btn" type="button" data-action="close-modal">Cancelar</button><button class="btn primary" type="submit">Salvar fazenda</button></div></form>`,{wide:true});
 farmEditSnapshots.set(farm.id,JSON.parse(JSON.stringify(saved||null)));
 document.querySelector('#farm-name')?.focus();
}
function addFarmInput(){farmForm();}
function requestFarmAction(id,inactivate=false) {
  const farm=state.farms.find(f=>f.id===id);
  if(!farm)return;
  if(inactivate||farmHasLinks(state,id))confirmation('Inativar '+farm.name+'?','Esta fazenda ficará fora de novos cadastros e transferências. Os contratos, descontos e pagamentos existentes continuam no controle.','confirm-inactivate-farm',id);
  else confirmation('Remover '+farm.name+'?','Esta fazenda não tem caminhões nem fechamentos vinculados e será removida da lista.','confirm-remove-farm',id);
}
async function applyFarmAction(id,action) {
  await remoteCommand(action==='remove'?'farm.remove':'farm.status',action==='remove'?{id}:{id,active:action==='reactivate'});
  if(action==='remove'&&farmFilter===id)farmFilter='';modal.close();render();
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
const closingMatchesSearch=row=>{const query=closingSearch.trim().toLocaleLowerCase('pt-BR');return !query||[row.plate,row.driver,row.farmName,row.carrier].some(value=>String(value||'').toLocaleLowerCase('pt-BR').includes(query));};
const closingVisibleRows=list=>list.filter(closingMatchesSearch);
const uniquePlates=list=>new Set(list.map(r=>r.plate)).size;
const CTE_PAGE_SIZE=50;
const cteNormalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
const ctePageCount=(total,size=CTE_PAGE_SIZE)=>Math.max(1,Math.ceil(total/size));
const ctePageSlice=(list,page,size=CTE_PAGE_SIZE)=>list.slice((Math.max(1,page)-1)*size,Math.max(1,page)*size);
const cteDocumentMatches=(doc,query)=>{const q=cteNormalize(query);return !q||[doc.number,doc.plate,doc.driver,doc.farmName,doc.shipper,doc.recipient,...(doc.manifestedNotes||[])].some(value=>cteNormalize(value).includes(q));};
const nfeNumberFromKey=value=>{const digits=String(value||'').replace(/\D/g,'');if(!/^\d{44}$/.test(digits))return '';const number=digits.slice(25,34).replace(/^0+/,'');return number||'0';};
const cteRequestMatches=(request,query)=>{const q=cteNormalize(query);return !q||[request.plate,request.driver,request.farmName,request.requestedEmail,request.note,...(request.invoiceKeys||[]),...(request.invoiceKeys||[]).map(nfeNumberFromKey)].some(value=>cteNormalize(value).includes(q));};
const ctePager=(action,page,total,label)=>{const pages=ctePageCount(total);if(pages<=1)return '';return `<nav class="cte-pagination" aria-label="Paginação de ${e(label)}"><span>Mostrando ${(Math.min(total,(page-1)*CTE_PAGE_SIZE+1))}–${Math.min(total,page*CTE_PAGE_SIZE)} de ${total}</span><div><button class="btn small" data-action="${action}-prev" ${page<=1?'disabled':''}>Anterior</button><strong>Página ${page} de ${pages}</strong><button class="btn small" data-action="${action}-next" ${page>=pages?'disabled':''}>Próxima</button></div></nav>`;};
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
  if(isCarrier()||isFarmEmployee()){state=initialState();portalRequests=data.requests||[];}else{state=applyFixedMonthlyRule(validateState(data.state));portalRequests=state.paymentRequests;}
  serverRevision=data.revision;loadError='';updateCloudStatus();
}
function currentFarmName(){
  if(!isFarmEmployee())return '';
  return currentUser?.farmName
    || cteFarms.find(farm=>farm.id===currentUser?.farmId)?.name
    || portalRequests.find(request=>!currentUser?.farmId||request.farmId===currentUser.farmId)?.farmName
    || 'Fazenda não identificada';
}
function updateCloudStatus() {
  const label=document.querySelector('#cloud-status');if(label)label.textContent=stale?'Há novas alterações. Atualize os dados.':saving?'Salvando no servidor…':'Dados salvos no banco online';
  const company=document.querySelector('#company-label');if(company)company.textContent=currentCompany?.name||'Rota Safra';
  const account=document.querySelector('#account-label');if(account)account.textContent=currentUser?(currentUser.email+' · '+(isCarrier()?'Transportadora':isFarmEmployee()?`Funcionário · ${currentFarmName()}`:'Grupo das fazendas')):'';
}
async function refreshServerData({automatic=false}={}) {
  if(saving)return false;
  const data=await cloud.load();
  if(automatic&&(saving||modal.open||reportDialog.open)){stale=true;updateCloudStatus();return false;}
  adoptServerData(data);stale=false;
  if(!automatic){modal.close();reportDialog.close();}
  render();updateCloudStatus();return true;
}
function renderAccess() {
  document.body.classList.add('logged-out');
  const ready=inviteTicket&&inviteInfo;
  main.innerHTML=`<div class="login-page"><section class="auth-card"><div class="auth-brand"><img class="auth-logo" src="./assets/rota-safra/logo-principal.png" width="768" height="485" alt="Rota Safra"></div><h1>${ready?inviteSignin?'Aceitar acesso':'Configurar seu acesso':'Entrar no sistema'}</h1><p>${ready?e(inviteInfo.companyName):'Acesse os registros da empresa, salvos no banco online.'}</p><form id="access-form" class="auth-form">${errBox()}${ready&&inviteInfo.firstAccess?'<div class="field"><label for="access-company">Nome da empresa</label><input id="access-company" name="companyName" maxlength="120" required autocomplete="organization"></div>':''}<div class="field"><label for="access-email">E-mail</label><input id="access-email" name="email" type="email" value="${e(ready?inviteInfo.email:'')}" ${ready&&inviteInfo.email?'readonly':''} required autocomplete="username"></div><div class="field"><label for="access-password">Senha</label><input id="access-password" name="password" type="password" required ${ready&&!inviteSignin?'minlength="6"':''} autocomplete="${ready&&!inviteSignin?'new-password':'current-password'}">${ready&&!inviteSignin?'<small>Use pelo menos 6 caracteres. A senha é definida aqui.</small>':''}</div><button class="btn primary" type="submit" ${inviteTicket&&!ready?'disabled':''}>${ready&&!inviteSignin?'Criar acesso':'Entrar'}</button>${ready?`<button type="button" class="btn ghost" data-action="auth-switch">${inviteSignin?'Criar uma nova conta':'Já tenho uma conta'}</button>`:''}</form>${inviteTicket&&!ready?'<p id="invite-message" class="auth-help">Conferindo o link de acesso…</p>':'<p class="auth-help">O administrador da empresa libera os usuários e seus perfis de acesso.</p>'}</section></div>`;
}
const accessProfiles=[['group:operator','Grupo — cadastros, fechamentos e solicitações'],['carrier:operator','Transportadora — pagamentos com comprovante'],['farm:operator','Funcionário — solicitar e receber CT-e'],['group:viewer','Grupo — somente consulta'],['carrier:viewer','Transportadora — somente consulta'],['farm:viewer','Funcionário — somente consulta de CT-e'],['group:admin','Administrador do grupo — equipe e configurações']];
const profileOptions=value=>accessProfiles.map(([key,label])=>opt(key,label,value)).join('');
function updateMemberFarmSummary(userId,farmId,status='') {const summary=document.querySelector(`[data-member-summary][data-id="${CSS.escape(userId)}"]`);if(!summary)return;const farmName=state.farms.find(farm=>farm.id===farmId)?.name||'Fazenda não encontrada';summary.textContent=`Funcionário · ${farmName} · ${status}`;}
function teamMemberRow(member) {
  const party=member.party||'group',farmId=member.farm_id||'',scope=party==='carrier'?'Transportadora':party==='farm'?'Funcionário · '+(state.farms.find(farm=>farm.id===farmId)?.name||'Fazenda não encontrada'):'Grupo das fazendas';
  return `<article class="team-member"><div class="team-member-info"><strong>${e(member.email||'E-mail não informado')}</strong><span class="secondary" ${party==='farm'?`data-member-summary data-id="${e(member.user_id)}"`:''}>${e(scope)}</span></div><span class="badge ${member.active?'green':'gray'}"><i></i>${member.active?'Ativo':'Inativo'}</span><div class="team-controls"><label class="sr-only" for="member-profile-${e(member.user_id)}">Perfil de ${e(member.email||'usuário')}</label><select id="member-profile-${e(member.user_id)}" aria-label="Acesso de ${e(member.email||'usuário')}" data-member-profile data-id="${e(member.user_id)}" data-active="${member.active}" data-farm="${e(farmId)}">${profileOptions(party+':'+member.role)}</select><label class="sr-only" for="member-farm-${e(member.user_id)}">Fazenda de ${e(member.email||'usuário')}</label><select id="member-farm-${e(member.user_id)}" aria-label="Fazenda de ${e(member.email||'usuário')}" data-member-farm data-id="${e(member.user_id)}" ${party==='farm'?'':'hidden'}>${opt('','Selecione a fazenda',farmId)}${farmOptions(farmId)}</select><button type="button" class="btn small ${member.active?'':'primary'}" data-action="member-status" data-id="${e(member.user_id)}" data-role="${e(member.role)}" data-party="${e(party)}" data-farm="${e(farmId)}" data-active="${member.active?'false':'true'}">${member.active?'Inativar':'Reativar'}</button></div></article>`;
}
function teamFarmWorkspace(farmId,employees,knownFarmIds) {
  const farm=state.farms.find(item=>item.id===farmId),members=farm?employees.filter(member=>member.farm_id===farm.id):employees.filter(member=>!knownFarmIds.has(member.farm_id));
  const title=farm?.name||'Fazenda sem vínculo',emptyLabel=farm?'Nenhum funcionário com acesso a esta fazenda.':'Nenhum funcionário sem fazenda vinculada.';
  return `<section class="team-farm-section"><div class="team-section-heading"><div><h3>${e(title)}</h3><p>${members.length?`${members.filter(member=>member.active).length} ativo(s) · ${members.length} cadastrado(s)`:emptyLabel}</p></div><button class="btn small primary" type="button" data-action="team-invite-farm" data-farm-id="${e(farm?.id||'')}">Cadastrar usuário</button></div>${members.length?members.map(teamMemberRow).join(''):`<p class="team-empty">${e(emptyLabel)}</p>`}</section>`;
}
async function loadTeam() {
  if(currentUser?.role!=='admin'||isCarrier())return;const box=document.querySelector('#team-list');
  try {
    const data=await cloud.team();teamMembers=data.members||[];
    const teamCount=document.querySelector('[data-team-count]');if(teamCount)teamCount.textContent=`${teamMembers.length} usuário(s)`;
    if(box){
      const general=teamMembers.filter(member=>member.party!=='farm');
      const employees=teamMembers.filter(member=>member.party==='farm');
      const knownFarmIds=new Set(state.farms.map(farm=>farm.id));
      const unassigned=employees.filter(member=>!knownFarmIds.has(member.farm_id));
      const hasUnassigned=unassigned.length>0,availableIds=[...state.farms.map(farm=>farm.id),...(hasUnassigned?['__unassigned__']:[])];
      if(!availableIds.includes(teamSelectedFarmId))teamSelectedFarmId=availableIds[0]||'';
      const tabs=state.farms.map(farm=>{const members=employees.filter(member=>member.farm_id===farm.id),selected=teamSelectedFarmId===farm.id;return `<button class="team-farm-tab${selected?' selected':''}" type="button" aria-pressed="${selected}" data-action="team-farm-select" data-farm-id="${e(farm.id)}"><span>${e(farm.name)}</span><small>${members.filter(member=>member.active).length} ativo(s) · ${members.length} usuário(s)</small></button>`;}).join('')+(hasUnassigned?`<button class="team-farm-tab${teamSelectedFarmId==='__unassigned__'?' selected':''}" type="button" aria-pressed="${teamSelectedFarmId==='__unassigned__'}" data-action="team-farm-select" data-farm-id="__unassigned__"><span>Fazenda sem vínculo</span><small>${unassigned.filter(member=>member.active).length} ativo(s) · ${unassigned.length} usuário(s)</small></button>`:'');
      const farmPanel=teamSelectedFarmId?teamFarmWorkspace(teamSelectedFarmId==='__unassigned__'?'':teamSelectedFarmId,employees,knownFarmIds):'<p class="team-empty">Nenhuma fazenda cadastrada.</p>';
      box.innerHTML=`<div class="team-section"><div class="team-section-heading"><div><h3>Acessos gerais</h3><p>Administradores, equipe do grupo e transportadora.</p></div><span class="count-pill">${general.length}</span></div>${general.length?general.map(teamMemberRow).join(''):'<p class="team-empty">Nenhum acesso geral cadastrado.</p>'}</div><div class="team-section"><div class="team-section-heading"><div><h3>Funcionários por fazenda</h3><p>Selecione uma fazenda para ver, alterar ou cadastrar os usuários vinculados.</p></div><span class="count-pill">${employees.length}</span></div><div class="team-farm-tabs" role="group" aria-label="Selecionar fazenda">${tabs}</div><div id="team-farm-panel">${farmPanel}</div></div>`;
    }
    if(view==='farms')main.innerHTML=farmsView();
  }catch(error){if(box)box.textContent=authErrorMessage(error);}
}
function teamSettings(){return currentUser?.role==='admin'&&!isCarrier()?`<section class="card team-access-card"><div class="card-header"><div><h2>Equipe e acessos</h2><p>Veja os usuários cadastrados, os perfis e a fazenda vinculada a cada funcionário.</p></div><span class="badge gray" data-team-count>${teamMembers.length} usuário(s)</span></div><div class="form-content"><div class="form-note team-autosave-note">As alterações de perfil e fazenda são salvas automaticamente. Funcionários acessam somente os documentos da fazenda vinculada.</div><div id="team-list"><p class="team-empty">Carregando usuários…</p></div></div></section><section class="card team-invite-card"><div class="card-header"><div><h2>Liberar novo acesso</h2><p>Envie um convite por e-mail e escolha o escopo correto para essa pessoa.</p></div></div><div class="form-content"><form id="invite-form">${errBox()}<div class="invite-fields"><div class="field"><label for="invite-email">E-mail</label><input id="invite-email" name="email" type="email" placeholder="nome@empresa.com.br" required></div><div class="field"><label for="invite-profile">Perfil de acesso</label><select name="profile" id="invite-profile">${profileOptions('farm:operator')}</select></div><div class="field" id="invite-farm-field"><label for="invite-farm">Fazenda do funcionário *</label><select name="farmId" id="invite-farm">${opt('','Selecione a fazenda','')}${farmOptions('')}</select></div></div><div class="form-note">O convite libera acesso ao portal conforme o perfil e a fazenda selecionados.</div><button class="btn primary" type="submit">Enviar convite por e-mail</button></form><div id="invite-result"></div></div></section>`:'';}

function download(data,type,name) {const u=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
function openModal(title,subtitle,body,{wide=false,preserve=false}={}) {
  if(preserve&&modal.open){
    modalStack.push({html:modalContent.innerHTML,wide:modal.classList.contains('wide-modal'),scrollTop:modal.scrollTop,bodyScrollTop:modalContent.querySelector('.modal-body')?.scrollTop||0});
  }else if(!preserve)modalStack=[];
  modal.classList.toggle('wide-modal',wide);
  modalContent.innerHTML=`<div class="modal-head"><div><h2 id="modal-title">${e(title)}</h2><p>${e(subtitle)}</p></div><button class="close-modal" data-action="close-modal" aria-label="${modalStack.length?'Voltar para a tela anterior':'Fechar janela'}">×</button></div><div class="modal-body">${body}</div>`;
  if(!modal.open)modal.showModal();
}
function closeModalOrReturn(){
  const previous=modalStack.pop();
  if(!previous){modal.close();return;}
  modal.classList.toggle('wide-modal',previous.wide);
  modalContent.innerHTML=previous.html;
  if(!modal.open)modal.showModal();
  requestAnimationFrame(()=>{modal.scrollTop=previous.scrollTop||0;const body=modalContent.querySelector('.modal-body');if(body)body.scrollTop=previous.bodyScrollTop||0;});
}
const errBox=()=>'<div class="form-error" role="alert"></div>';
function formError(form,message,details=[]) {const box=form.querySelector('.form-error');if(box){if(details.length){box.innerHTML='<strong>'+e(message)+'</strong><ul>'+details.map(item=>'<li>'+e(item)+'</li>').join('')+'</ul>';}else box.textContent=message;box.classList.add('visible');box.scrollIntoView({block:'nearest'});}else notify(message);}
const paymentStatus=row=>row.paid?'Pago':row.closed?'Fechado':'Aberto';
function badge(row) {const status=paymentStatus(row),color=status==='Pago'?'green':status==='Fechado'?'amber':'gray';return `<span class="badge ${color}"><i></i>${status}</span>`;}
function head(title,subtitle,actions='',eyebrow='PAGAMENTOS QUINZENAIS') {return `<div class="page-head"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${subtitle}</p></div><div class="actions">${actions}</div></div>`;}
function periodBar(includeFarm=true,monthAria='Mês do fechamento') {const p=currentPeriod();return `<div class="period-bar"><div class="period-controls"><label for="period-month">Competência</label><input type="month" id="period-month" aria-label="${e(monthAria)}" value="${e(currentMonth)}"><div class="segmented" aria-label="Selecionar quinzena"><button data-action="half" data-half="1" class="${currentHalf===1?'selected':''}" aria-pressed="${currentHalf===1}">1ª quinzena</button><button data-action="half" data-half="2" class="${currentHalf===2?'selected':''}" aria-pressed="${currentHalf===2}">2ª quinzena</button></div>${includeFarm?`<select id="farm-filter" aria-label="Filtrar por fazenda">${opt('','Todas as fazendas',farmFilter)}${farmOptions(farmFilter)}</select>`:''}</div><div class="period-caption">${e(periodLabel(p))}</div></div>`;}
function ruleNotice() {
  if(loadError)return `<div class="notice">${e(loadError)}<a href="#settings">Recuperar registros</a></div>`;
  if(!state.settings.confirmed && !closing())return `<div class="notice"><span><strong>Regra provisória para o teste:</strong> mensal ÷ 30, contando os dias de entrada e saída. Confira antes de fechar.</span><a href="#settings">Definir regra de cálculo</a></div>`;
  if(filteredRows().some(r=>r.paid&&rowRules(r).mode!=='half'))return `<div class="notice neutral"><span><strong>Regra mensal fixa ativa.</strong> Os pagamentos já registrados com a regra anterior permanecem no histórico. Os cálculos sem pagamento usam metade do mensal por quinzena completa.</span></div>`;
  const cs=selectedClosings(),late=filteredRows().filter(r=>!r.closed&&r.complementary);
  if(late.length)return `<div class="notice neutral"><span><strong>${late.length} caminhão(ões) ficaram fora das faturas fechadas.</strong> Emita uma fatura complementar para incluí-los; as faturas e os pagamentos anteriores serão preservados.</span><a href="#closings">Ver histórico da quinzena</a></div>`;
  if(!farmFilter&&cs.length&&!closing())return `<div class="notice neutral"><span><strong>Fechamento por fazenda:</strong> ${periodClosings(state,currentPeriod()).reduce((ids,c)=>{c.farmIds.forEach(id=>ids.add(id));return ids;},new Set()).size} fazenda(s) fechada(s), ${openFarmIds(state,currentPeriod()).length} em aberto. As prévias das demais continuam atualizando.</span><a href="#closings">Ver fechamentos</a></div>`;
  return '';
}
function truckTable(list) {
  if(!list.length)return `<div class="empty"><div class="empty-icon">▤</div><h3>${closingSearch?'Nenhuma placa encontrada':state.trucks.length?'Nenhum caminhão neste período':'Sua primeira quinzena começa aqui'}</h3><p>${closingSearch?'Tente buscar por outra placa, motorista ou fazenda.':state.trucks.length?'Ajuste o mês ou a fazenda para ver os caminhões contratados.':'Cadastre uma placa, informe o valor mensal e a data de início.'}</p><div class="actions" style="justify-content:center">${closingSearch?'<button class="btn" data-action="clear-closing-search">Limpar busca</button>':'<button class="btn primary" data-action="new-truck">+ Cadastrar caminhão</button>'}</div></div>`;
  const groups=new Map();for(const row of list){if(!groups.has(row.plate))groups.set(row.plate,[]);groups.get(row.plate).push(row);}
  const rows=[...groups.values()].map(records=>{
    records.sort((a,b)=>a.start.localeCompare(b.start)||a.farmName.localeCompare(b.farmName,'pt-BR'));
    const first=records[0],farms=[...new Set(records.map(row=>row.farmName))],discount=sum(records,'discount'),discountDays=sum(records,'discountDays'),discountByAmount=round(records.reduce((total,row)=>total+amountDiscountTotal(row),0)),requested=records.some(row=>row.requestId&&!row.paid),status=records.every(row=>row.paid)?'Pago':records.every(row=>row.closed)?'Fechado':'Aberto',color=status==='Pago'?'green':status==='Fechado'?'amber':'gray';
    return `<tr><td><span class="plate">${e(first.plate)}</span><span class="secondary">${e(first.driver)}</span></td><td>${e(farms.join(' · '))}<span class="secondary">${records.length} período(s) · ${e([...new Set(records.map(row=>row.carrier))].join(' · '))}</span></td><td class="num">${sum(records,'eligibleDays')}<span class="secondary">total na quinzena</span></td><td class="num discount-color">${discount?money(discount):'—'}<span class="secondary">${discount?[discountDays?discountDays+' dia(s)':'',discountByAmount?'Por valor':''].filter(Boolean).join(' + '):'Sem desconto'}</span></td><td class="num value">${money(sum(records,'net'))}<span class="secondary">${sum(records,'payableDays')} dia(s) na quinzena</span></td><td><span class="badge ${color}"><i></i>${status}</span>${requested?'<span class="secondary">Solicitado à transportadora</span>':''}</td><td><button class="btn small ghost" data-action="fortnight-plate-detail" data-plate="${e(first.plate)}">Detalhes (${records.length})</button></td></tr>`;
  }).join('');
  return `<div class="table-wrap"><table><thead><tr><th>CAMINHÃO / MOTORISTA</th><th>FAZENDA / PERÍODOS</th><th class="num">DIAS NA QUINZENA</th><th class="num">DESCONTOS</th><th class="num">VALOR LÍQUIDO</th><th>SITUAÇÃO</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function fortnightPlateDetail(plate){
  const records=filteredRows().filter(row=>!row.closed&&row.plate===plate).sort((a,b)=>a.start.localeCompare(b.start)||a.farmName.localeCompare(b.farmName,'pt-BR'));
  if(!records.length)throw Error('Os períodos desta placa não estão disponíveis nesta seleção.');
  const first=records[0],current=latestTruck(state,first.truckId),active=!current.end&&current.start<=today(),endAction=current.serviceEnded?`<button class="btn orange" data-action="end-activities" data-id="${e(current.id)}">Revisar encerramento</button>`:active?`<button class="btn orange" data-action="end-activities" data-id="${e(current.id)}">Encerrar atividades</button>`:'',rows=records.map(row=>`<tr><td>${e(row.farmName)}</td><td>${dateLabel(row.start)} a ${dateLabel(row.end)}</td><td class="num">${row.eligibleDays}</td><td class="num discount-color">${row.discount?money(row.discount):'—'}</td><td class="num value">${money(row.net)}</td></tr>`).join('');
  openModal(first.plate+' · '+first.driver,periodLabel(currentPeriod())+' · '+records.length+' período(s)',`<div class="detail-grid"><div><small>Fazendas</small><strong>${e([...new Set(records.map(row=>row.farmName))].join(' · '))}</strong></div><div><small>Dias na quinzena</small><strong>${sum(records,'eligibleDays')}</strong></div><div><small>Descontos</small><strong>${money(sum(records,'discount'))}</strong></div><div><small>Valor líquido</small><strong>${money(sum(records,'net'))}</strong></div></div><section class="card" style="margin:18px 0 0"><div class="card-header"><div><h3>Períodos considerados</h3><p>Transferências entre fazendas aparecem aqui, sem repetir a placa na tabela.</p></div></div><div class="table-wrap"><table><thead><tr><th>FAZENDA</th><th>PERÍODO</th><th class="num">DIAS</th><th class="num">DESCONTOS</th><th class="num">LÍQUIDO</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><th colspan="2">TOTAL DA PLACA</th><th class="num">${sum(records,'eligibleDays')}</th><th class="num">${money(sum(records,'discount'))}</th><th class="num">${money(sum(records,'net'))}</th></tr></tfoot></table></div></section>${current.serviceEnded?`<div class="notice neutral" style="margin-top:18px"><span>Encerramento registrado para <strong>${dateLabel(current.serviceEnded.date)}</strong>.</span></div>`:active?'<div class="form-note" style="margin-top:18px">O encerramento vale para a atividade atual da placa, mesmo que ela tenha passado por mais de uma fazenda.</div>':''}<div class="form-actions">${endAction}<button class="btn" data-action="close-modal">Fechar</button></div>`,{wide:true});
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
  const events=[...entries.map(t=>({plate:t.plate,date:t.start,label:'Entrada',text:state.farms.find(f=>f.id===t.farmId)?.name||'Fazenda'})),...endings.map(t=>({plate:t.plate,date:t.end,label:'Encerramento',text:state.farms.find(f=>f.id===t.farmId)?.name||'Fazenda'})),...transfers.map(t=>({plate:t.plate,date:t.transferOut.date,label:'Transferência',text:(state.farms.find(f=>f.id===t.farmId)?.name||'Fazenda')+' para '+t.transferOut.toFarmName,destinationTruckId:state.trucks.find(x=>x.id===t.transferOut.toTruckId)?.id||state.trucks.find(x=>x.transferIn?.fromTruckId===t.id&&x.transferIn.date===t.transferOut.date)?.id||t.id}))];
  events.sort((a,b)=>Number(a.date>now)-Number(b.date>now)||(a.date>now?a.date.localeCompare(b.date):b.date.localeCompare(a.date))||a.plate.localeCompare(b.plate));
  const paid=sum(rows.filter(r=>r.paid),'net'),waiting=sum(rows.filter(r=>r.closed&&!r.paid),'net'),open=sum(rows.filter(r=>!r.closed),'net');
  const farms=state.farms.filter(f=>(!selectedFarm||f.id===selectedFarm)&&(f.active!==false||assignments.some(t=>t.farmId===f.id)||rows.some(r=>r.farmId===f.id)||f.id===selectedFarm)).map(f=>({...f,activeTrucks:uniquePlates(active.filter(t=>t.farmId===f.id)),periodTrucks:uniquePlates(assignments.filter(t=>t.farmId===f.id))}));
  return {start,end,reference,referenceLabel:now<start?'Previstos no início da quinzena':now>end?'Ativos no fim da quinzena':'Em atividade hoje',periodTrucks:fleet.length,activeTrucks:uniquePlates(active),entries:entries.length,scheduledEntries:entries.filter(t=>t.start>now).length,endings:endings.length,scheduledEndings:endings.filter(t=>t.end>now).length,types,axles,events,transfers:transfers.length,farms,paid,waiting,open,gross:sum(rows,'gross'),total:sum(rows,'net'),discounts:sum(rows,'discount')};
}
function overview() {
  const d=overviewData();
  const recovery=loadError?`<div class="notice"><span>${e(loadError)}</span><a href="#settings">Recuperar registros</a></div>`:'';
  const metrics=[['Caminhões na quinzena',d.periodTrucks,'Placas com contrato nesta quinzena'],[d.referenceLabel,d.activeTrucks,'Situação em '+dateLabel(d.reference)],['Entradas na quinzena',d.entries,d.scheduledEntries?d.scheduledEntries+' entrada(s) agendada(s)':'Novos períodos de serviço'],['Encerramentos na quinzena',d.endings,d.scheduledEndings?d.scheduledEndings+' encerramento(s) agendado(s)':'Serviços concluídos na quinzena']];
  return head('Visão geral','O resumo da sua frota e dos pagamentos da quinzena.','<a class="btn" href="#trucks">Ver caminhões</a><button class="btn primary" data-action="new-truck">+ Cadastrar caminhão</button>','RESUMO DA FROTA')+
    periodBar(true,'Mês da visão geral')+recovery+
    `<div class="metric-grid overview-metrics">${metrics.map(([label,value,note],index)=>`<div class="metric ${index===0?'featured':''}"><div class="metric-label">${index===0?'<span class="dot"></span>':''}${e(label)}</div><div class="metric-value">${value}</div><div class="metric-note">${e(note)}</div></div>`).join('')}</div>`+
    `<section class="card"><div class="card-header"><div><h2>Resumo financeiro da quinzena</h2><p>Prévia dos valores em aberto e fechamentos salvos nesta quinzena.</p></div><a class="btn small" href="#closings">Ir para Fechamentos →</a></div><div class="overview-finance"><div class="overview-finance-total"><span class="finance-dot spacer" aria-hidden="true"></span><span>Total bruto</span><strong>${money(d.gross)}</strong></div><div class="overview-finance-item overview-finance-net"><span class="finance-dot spacer" aria-hidden="true"></span><span>Líquido após descontos</span><strong>${money(d.total)}</strong></div><div class="overview-finance-item"><span class="finance-dot paid"></span><span>Pago</span><strong>${money(d.paid)}</strong></div><div class="overview-finance-item"><span class="finance-dot waiting"></span><span>Fechado, aguardando pagamento</span><strong>${money(d.waiting)}</strong></div><div class="overview-finance-item"><span class="finance-dot open"></span><span>Em aberto</span><strong>${money(d.open)}</strong></div><a class="overview-finance-item overview-discounts-link" href="#discounts" aria-label="Ver descontos totais da quinzena: ${e(money(d.discounts))}"><span class="finance-dot discount"></span><span>Descontos totais</span><strong>${money(d.discounts)}</strong><small>Ver descontos →</small></a></div></section>`+
    `<div class="overview-columns"><section class="card"><div class="card-header"><div><h2>Caminhões por fazenda</h2><p>Situação em ${dateLabel(d.reference)} · ${d.activeTrucks} caminhão(ões) em atividade</p></div></div><div class="overview-farms">${d.farms.length?d.farms.map(f=>`<div class="overview-farm-row"><div class="overview-farm-label"><strong>${e(f.name)}${f.active===false?' <span class="badge gray">Inativa</span>':''}</strong><span>${f.activeTrucks} em atividade</span></div><div class="overview-bar" aria-hidden="true"><span style="width:${d.activeTrucks?Math.round(f.activeTrucks/d.activeTrucks*100):0}%"></span></div><p>${f.periodTrucks} placa(s) com passagem nesta quinzena</p></div>`).join(''):'<div class="overview-no-events">Nenhuma fazenda nesta seleção.</div>'}</div></section><section class="card"><div class="card-header"><div><h2>Perfil dos caminhões</h2><p>Uma contagem por placa na quinzena selecionada.</p></div></div><div class="overview-profile">${Object.entries(d.types).map(([type,count])=>`<div class="overview-type"><span>${e(type)}</span><strong>${count}</strong></div>`).join('')}<div class="overview-axles"><strong>Quantidade de eixos</strong><div><span>7 eixos <b>${d.axles[7]}</b></span><span>9 eixos <b>${d.axles[9]}</b></span><span>Outros / a informar <b>${d.axles.other}</b></span></div></div></div></section></div>`;
}
function movementsView() {
  const d=overviewData(),events=d.events;
  const list=events.length?`<div class="overview-events">${events.map(event=>`<div class="overview-event"><div class="overview-event-date">${dateLabel(event.date).slice(0,5)}</div><div><strong>${e(event.plate)}</strong><p>${e(event.text)}</p></div><span class="badge ${event.label==='Encerramento'?'gray':event.label==='Transferência'?'amber':'green'}">${event.label}${event.date>today()?' · agendado':''}</span>${event.label==='Transferência'?'<button class="btn small" data-action="truck-history" data-id="${e(event.destinationTruckId)}">Ver / estornar</button>':''}</div>`).join('')}</div>`:`<div class="overview-no-events"><h3>${state.trucks.length?'Nenhuma movimentação nesta quinzena':'Comece cadastrando sua frota'}</h3><p>${state.trucks.length?'As entradas, transferências e encerramentos deste período aparecerão aqui.':'Cadastre os caminhões para acompanhar as movimentações da frota.'}</p><a class="btn primary" href="#trucks">Ver caminhões</a></div>`;
  return head('Movimenta\u00e7\u00f5es','Acompanhe entradas, transferências e encerramentos da frota por quinzena.','<a class="btn" href="#trucks">Ver caminhões</a>','MOVIMENTAÇÕES DA FROTA')+
    periodBar(true,'Mês das movimentações')+
    `<div class="metric-grid overview-metrics"><div class="metric featured"><div class="metric-label"><span class="dot"></span>Movimentaç\u00f5es na quinzena</div><div class="metric-value">${events.length}</div><div class="metric-note">Todos os registros do período</div></div><div class="metric"><div class="metric-label">Entradas</div><div class="metric-value">${d.entries}</div><div class="metric-note">${d.scheduledEntries?'Inclui '+d.scheduledEntries+' agendada(s)':'Novos períodos de serviço'}</div></div><div class="metric"><div class="metric-label">Transferências</div><div class="metric-value">${d.transfers}</div><div class="metric-note">Mudanças de fazenda</div></div><div class="metric"><div class="metric-label">Encerramentos</div><div class="metric-value">${d.endings}</div><div class="metric-note">${d.scheduledEndings?'Inclui '+d.scheduledEndings+' agendado(s)':'Serviços concluídos'}</div></div></div>`+
    `<section class="card"><div class="card-header"><div><h2>Histórico da quinzena <span class="count-pill">${events.length}</span></h2><p>Registros ordenados por data, com os agendamentos destacados.</p></div><a class="btn small" href="#trucks">Ver cadastros</a></div>${list}</section>`;
}
function closingMetrics(list,p) {
  const paid=list.filter(r=>r.paid),pending=list.filter(r=>!r.paid);
  return `<div class="metric-grid"><div class="metric"><div class="metric-label">Saldo a pagar</div><div class="metric-value money">${money(sum(pending,'net'))}</div><div class="metric-note">${pending.filter(r=>!r.closed).length?'Inclui placas em aberto':'Valores fechados sem pagamento'}</div></div><div class="metric"><div class="metric-label">Pagamentos realizados</div><div class="metric-value money">${money(sum(paid,'net'))}</div><div class="metric-note">${paid.length} pagamento(s) registrado(s)</div></div><div class="metric"><div class="metric-label">Descontos da quinzena</div><div class="metric-value money">${money(sum(list,'discount'))}</div><div class="metric-note">${list.reduce((n,r)=>n+r.discountDays,0)} dia(s) descontado(s)</div></div></div>`;
}

function ruleDescription(s,p) {return s.mode==='half'?`Um mês completo sem descontos soma o valor mensal cadastrado. Cada quinzena completa paga metade do mensal; períodos parciais de contrato são calculados por mensal ÷ 30 × dias elegíveis. Cada dia de falta ou oficina desconta mensal ÷ 30.`:s.mode==='calendar'?`Este registro usou a divisão pelos ${p.monthDays} dias do mês. A regra atual paga metade do mensal por quinzena completa; períodos parciais e descontos por dia usam mensal ÷ 30.`:'Este pagamento foi registrado com a antiga regra diária mensal ÷ 30. O cálculo atual paga metade do mensal por quinzena completa; períodos parciais de contrato e descontos por dia usam mensal ÷ 30.';}
function trucksView() {
  const grouped=new Map();
  for(const truck of state.trucks){const key=truck.plate.trim().toLocaleUpperCase('pt-BR');if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(truck);}
  const groups=[...grouped.values()].map(records=>{records.sort((a,b)=>a.start.localeCompare(b.start));const current=records.at(-1),farms=[...new Set(records.map(t=>state.farms.find(f=>f.id===t.farmId)?.name).filter(Boolean))];return {records,current,farms};})
    .filter(group=>(!farmFilter||group.records.some(t=>t.farmId===farmFilter))&&(!search||group.records.some(t=>[t.plate,t.driver,t.carrier].some(x=>x.toLocaleLowerCase().includes(search.toLocaleLowerCase())))))
    .sort((a,b)=>a.current.plate.localeCompare(b.current.plate));
  const status=t=>t.serviceEnded?(t.serviceEnded.date>today()?'Encerramento agendado':'Encerrado'):t.transferOut?(t.transferOut.date>today()?'Transferência agendada':'Transferido'):t.start>today()?'Agendado':t.end&&t.end<today()?'Encerrado':'Em serviço';
  const rows=groups.map(({records,current,farms})=>{
    const situation=status(current);
    const range=records.length===1?dateLabel(records[0].start)+(records[0].end?' a '+dateLabel(records[0].end):' · em aberto'):records.length+' períodos · '+dateLabel(records[0].start)+' a '+(records.at(-1).end?dateLabel(records.at(-1).end):'em aberto');
    return '<tr><td><span class="plate">'+e(current.plate)+'</span>'+(current.sample?'<span class="sample-mark">EXEMPLO</span>':'')+'<span class="secondary">'+e(current.driver)+'</span></td><td>'+e(current.carrier)+'</td><td>'+e(state.farms.find(f=>f.id===current.farmId)?.name||'—')+(farms.length>1?'<span class="secondary">Passou por '+farms.length+' fazendas</span>':'')+'</td><td>'+e(current.bodyType||'A informar')+'<span class="secondary">'+(current.axles?current.axles+' eixos':'Eixos a informar')+'</span></td><td class="num value">'+money(current.monthly)+'</td><td>'+range+(records.length>1?'<span class="secondary">'+records.length+' períodos registrados</span>':'')+'</td><td><span class="badge '+(situation==='Em serviço'?'green':situation.toLocaleLowerCase().includes('agendado')?'amber':'gray')+'">'+situation+'</span></td><td><button class="btn small" data-action="truck-history" data-id="'+e(current.id)+'">Detalhes</button></td></tr>';
  }).join('');
  return head('Caminhões','Cada placa aparece uma vez. Abra os detalhes para consultar os períodos por fazenda.','<div class="actions"><button class="btn" data-action="payment-accounts">Contas de pagamento</button><button class="btn primary" data-action="new-truck">+ Cadastrar caminhão</button></div>','CADASTRO DA FROTA')+
    '<div class="toolbar"><input id="truck-search" type="search" placeholder="Buscar placa, motorista ou transportador" aria-label="Buscar caminhão" value="'+e(search)+'"><select id="farm-filter" aria-label="Filtrar caminhões por fazenda">'+opt('','Todas as fazendas',farmFilter)+farmOptions(farmFilter)+'</select><span class="period-caption">'+groups.length+' placa(s) · '+groups.reduce((sum,group)=>sum+group.records.length,0)+' período(s)</span></div><section class="card"><div class="table-wrap">'+(groups.length?'<table><thead><tr><th>PLACA / MOTORISTA</th><th>TRANSPORTADOR</th><th>FAZENDA ATUAL</th><th>TIPO / EIXOS</th><th class="num">VALOR MENSAL</th><th>PERÍODO DE ATIVIDADE</th><th>SITUAÇÃO</th><th>AÇÕES</th></tr></thead><tbody>'+rows+'</tbody></table>':'<div class="empty"><div class="empty-icon">▤</div><h3>'+(state.trucks.length?'Nenhum resultado':'Cadastre o primeiro caminhão')+'</h3><p>Placa, motorista, fazenda, valor mensal e início são suficientes para começar.</p><button class="btn primary" data-action="new-truck">+ Cadastrar caminhão</button></div>')+'</div></section><div class="notice neutral"><span>O filtro por fazenda considera todo o histórico da placa. Para mudar de fazenda a partir de uma data, abra os <strong>Detalhes</strong>; os dias e descontos serão divididos entre origem e destino.</span></div>';
}
function discountsView() {
  const p=currentPeriod(),list=state.discounts.filter(d=>overlaps(d.start,d.end,p.start,p.end)&&(!farmFilter||state.trucks.find(t=>t.id===d.truckId)?.farmId===farmFilter)).sort((a,b)=>b.start.localeCompare(a.start));
  return head('Descontos','Registre descontos por dias ou por valor, com data e motivo.','<button class="btn primary" data-action="new-discount" '+(!state.trucks.length?'disabled':'')+'>+ Lançar desconto</button>','OCORRÊNCIAS DO PERÍODO')+periodBar()+`<section class="card"><div class="card-header"><div><h2>Ocorrências <span class="count-pill">${list.length}</span></h2><p>Dias são calculados pelo período; valores entram na quinzena da data informada.</p></div></div>${list.length?`<div class="table-wrap"><table><thead><tr><th>CAMINHÃO</th><th>MOTIVO</th><th>PERÍODO</th><th class="num">DIAS / VALOR</th><th>OBSERVAÇÃO</th><th>AÇÕES</th></tr></thead><tbody>${list.map(d=>{const t=state.trucks.find(t=>t.id===d.truckId),locked=discountLocked(d,state);return `<tr><td><span class="plate">${e(t?.plate)}</span><span class="secondary">${e(t?.driver)}</span></td><td><span class="badge amber">${isAmountDiscount(d)?'Por valor':e(d.reason)}</span></td><td>${dateLabel(d.start)}${isAmountDiscount(d)?'':' a '+dateLabel(d.end)}</td><td class="num">${isAmountDiscount(d)?money(d.amount):days(d.start>p.start?d.start:p.start,d.end<p.end?d.end:p.end)+' dia(s)'}</td><td style="white-space:normal;max-width:260px">${e(d.note)||'—'}</td><td>${locked?'<span class="badge gray">Período fechado</span>':`<div class="actions"><button class="btn small ghost" data-action="edit-discount" data-id="${e(d.id)}">Editar</button><button class="btn small danger" data-action="delete-discount" data-id="${e(d.id)}">Excluir</button></div>`}</td></tr>`;}).join('')}</tbody></table></div>`:`<div class="empty"><div class="empty-icon">−</div><h3>Nenhum desconto nesta quinzena</h3><p>Escolha a placa e lance dias de falta ou oficina, ou um valor em reais com motivo obrigatório.</p><button class="btn" data-action="new-discount" ${!state.trucks.length?'disabled':''}>Lançar desconto</button></div>`}</section>`;
}
function historyReopenBlock(closing,row) {
  if(row.paid)return 'Pagamento já registrado; corrija o pagamento antes de reabrir.';
  if(row.requestId||state.paymentRequests.some(request=>request.period.key===closing.period.key&&request.snapshot.truckId===row.truckId&&request.snapshot.farmId===row.farmId&&['pending','paid'].includes(request.status)))return 'Há uma solicitação de pagamento; cancele ou corrija antes de reabrir.';
  if(state.fundingTransfers.some(transfer=>transfer.period.key===closing.period.key&&transfer.farmId===row.farmId&&transfer.status!=='cancelled'))return 'Há uma solicitação/transferência desta fazenda; resolva antes de reabrir.';
  return '';
}
function historyPaymentAccountMarkup(row){
 return `<button class="btn small" data-act…40085 tokens truncated…roof'),button=f.querySelector('[type="submit"]'),ids=[...selectedBillingCteIds];button.disabled=true;
    try{if(!ids.length)throw Error('Selecione ao menos um CT-e para pagar.');if(!file?.size||file.size>10*1024*1024)throw Error('Anexe um comprovante PDF, JPG ou PNG de até 10 MB.');await cloud.submitCtePaymentProofBatch(ids,file);selectedBillingCteIds.clear();modal.close();await loadCteData();notify(`${ids.length} CT-e(s) marcado(s) como pago(s) com o comprovante enviado.`);}
    catch(error){formError(f,error.message||'Não foi possível anexar o comprovante.');button.disabled=false;}return;
  }
  if(f.id==='cte-billing-invoice-form'){
    ev.preventDefault();const dueOn=String(new FormData(f).get('dueOn')||''),button=f.querySelector('[type="submit"]'),ids=[...selectedBillingCteIds];button.disabled=true;
    try{if(!ids.length)throw Error('Selecione ao menos um CT-e para faturar.');if(!/^\d{4}-\d{2}-\d{2}$/.test(dueOn)||dueOn<today())throw Error('Informe um vencimento válido a partir de hoje.');const result=await cloud.issueCteBillingInvoice({documentIds:ids,dueOn});selectedBillingCteIds.clear();modal.close();await loadCteData();notify(`Fatura ${result.invoice?.number||''} emitida. O pagamento continua em aberto até o comprovante ser enviado.`);}
    catch(error){formError(f,error.message||'Não foi possível emitir a fatura.');button.disabled=false;}return;
  }
  if(f.id==='cte-invoice-payment-form'){
    ev.preventDefault();const file=new FormData(f).get('paymentProof'),button=f.querySelector('[type="submit"]'),invoiceId=f.dataset.invoiceId;button.disabled=true;
    try{if(!file?.size||file.size>10*1024*1024)throw Error('Anexe um comprovante PDF, JPG ou PNG de até 10 MB.');await cloud.payCteBillingInvoice(invoiceId,file);modal.close();await loadCteData();notify('Comprovante anexado. A fatura e seus CT-es foram marcados como pagos.');}
    catch(error){formError(f,error.message||'Não foi possível anexar o comprovante.');button.disabled=false;}return;
  }  if(f.id==='cte-preferences-form'){
    ev.preventDefault();const visibleColumns=[...f.querySelectorAll('[data-cte-pref-column]:checked')].map(input=>input.dataset.ctePrefColumn),button=f.querySelector('[type="submit"]');button.disabled=true;
    try{if(!visibleColumns.length)throw Error('Mantenha pelo menos uma coluna visível.');const saved=await cloud.saveCtePreferences({visibleColumns,columnOrder:ctePreferenceDraft.columnOrder});ctePreferences=saved.preferences;ctePage=1;ctePreferenceDraft=null;modal.close();if(view==='ctes')main.innerHTML=ctesView();notify('Personalização salva na sua conta.');}
    catch(error){formError(f,authErrorMessage(error));}finally{button.disabled=false;}return;
  }
  if(f.id==='payment-account-form'){
    ev.preventDefault();const data=new FormData(f),method=String(data.get('method')||''),bankSelection=String(data.get('bankSelection')||''),current=state.paymentAccounts.find(item=>item.id===f.dataset.id),farmId=current?.farmId||String(data.get('farmId')||''),details=normalizePaymentDetails({method,holder:String(data.get('holder')||'').trim(),document:formatPaymentDocument(data.get('document')),pixKey:method==='pix'?String(data.get('pixKey')||'').trim():'',bankName:method==='bank'?(bankSelection==='other'?String(data.get('otherBankName')||'').trim():bankSelection):'',agency:method==='bank'?String(data.get('agency')||'').trim():'',account:method==='bank'?String(data.get('account')||'').trim():'',accountType:method==='bank'?String(data.get('accountType')||''):''}),truckIds=[...f.querySelectorAll('input[name="truckIds"]:checked')].map(input=>input.value),button=f.querySelector('[type="submit"]');
    try{if(!truckIds.length)throw Error('Selecione ao menos uma placa para esta conta.');const missing=paymentDetailsMissing(details);if(missing.length)throw Error('Complete os dados da conta: '+missing.join(', ')+'.');button.disabled=true;await remoteCommand('payment-account.save',{id:f.dataset.id||uid(),name:String(data.get('name')||'').trim(),details,truckIds});paymentAccountsView();notify('Conta salva e placas vinculadas.');}
    catch(error){formError(f,error.message||'Não foi possível salvar a conta.');}finally{button.disabled=false;}return;
  }
  if(['request-payments-form','request-reason-form'].includes(f.id)){
    ev.preventDefault();const data=new FormData(f),button=f.querySelector('[type="submit"]');button.disabled=true;
    try{if(f.id==='request-payments-form'){await remoteCommand('payment.request',{month:currentMonth,half:currentHalf,farmId:farmFilter,truckId:f.dataset.truckId||''});portalPeriod=currentPeriod().key;portalFarm=farmFilter;modal.close();location.hash='#requests';render();notify('Solicitações enviadas à transportadora.');}
    else{const note=String(data.get('note')||'').trim();if(!note)throw Error('Informe o motivo.');await remoteCommand(f.dataset.operation==='cancel'?'payment.cancel':'payment.undo',f.dataset.operation==='legacy'?{closingId:rowClosing(f.dataset.id).id,truckId:f.dataset.id,note}:{requestId:f.dataset.id,note});modal.close();render();notify(f.dataset.operation==='cancel'?'Solicitação cancelada. O fechamento pode ser reaberto.':'Correção registrada. O histórico e os comprovantes anteriores foram preservados.');}}
    catch(error){formError(f,error.message);}finally{button.disabled=false;}return;
  }
  if(f.id==='payment-batch-form'){
    ev.preventDefault();const data=new FormData(f),date=String(data.get('date')||''),file=data.get('receipt'),requestIds=JSON.parse(f.dataset.requestIds||'[]'),button=f.querySelector('[type="submit"]');
    try{if(!isCarrier()||!canOperate())throw Error('O pagamento exige acesso da transportadora.');if(!validDate(date)||date>today())throw Error('Informe uma data de pagamento válida, até hoje.');if(!file||!file.size||file.size>10*1024*1024)throw Error('Anexe um comprovante em PDF, JPG ou PNG de até 10 MB.');button.disabled=true;const receipt=await cloud.uploadReceipt(requestIds[0],file);await remoteCommand('payment.record-batch',{requestIds,date,note:String(data.get('note')||'').trim(),receiptId:receipt.id});for(const id of requestIds)selectedPaymentRequests.delete(id);modal.close();render();notify('Pagamento conjunto registrado nas placas selecionadas.');}catch(error){formError(f,error.message||'Não foi possível registrar o pagamento conjunto.');}finally{button.disabled=false;}return;
  }
  if(!['truck-form','discount-form','payment-form','farm-form','transfer-form','end-activities-form'].includes(f.id))return;ev.preventDefault();const data=new FormData(f);
  try {
    if(f.id==='truck-form'){
      const id=f.dataset.id||uid(),prior=state.trucks.find(t=>t.id===id),method=String(data.get('paymentMethod')||''),paymentAccountId=String(data.get('paymentAccountId')||''),selectedAccount=state.paymentAccounts.find(account=>account.id===paymentAccountId);
      const selectedBank=String(data.get('paymentBankSelection')||'');
      const paymentDetails=normalizePaymentDetails({method,holder:String(data.get('paymentHolder')||''),document:formatPaymentDocument(data.get('paymentDocument')),pixKey:method==='pix'?String(data.get('paymentPixKey')||''):'',bankName:method==='bank'?(selectedBank==='other'?String(data.get('paymentOtherBankName')||''):selectedBank):'',agency:method==='bank'?String(data.get('paymentAgency')||''):'',account:method==='bank'?String(data.get('paymentAccount')||''):'',accountType:method==='bank'?String(data.get('paymentAccountType')||''):''});
      const t={id,plate:String(data.get('plate')).toUpperCase().replace(/[^A-Z0-9]/g,''),driver:String(data.get('driver')).trim(),carrier:String(data.get('carrier')).trim(),farmId:data.get('farmId')||prior?.farmId,bodyType:data.get('bodyType'),axles:Number(data.get('axles')==='other'?data.get('otherAxles'):data.get('axles')),monthly:parseAmount(data.get('monthly')),start:data.get('start'),end:data.get('end')||'',paymentAccountId,paymentAccountName:String(data.get('paymentAccountName')||'').trim(),paymentDetails:selectedAccount?.details||paymentDetails,...(prior?.sample?{sample:true}:{}),...(prior?.transferIn?{transferIn:structuredClone(prior.transferIn)}:{}),...(prior?.transferOut?{transferOut:structuredClone(prior.transferOut)}:{}),...(prior?.serviceEnded?{serviceEnded:structuredClone(prior.serviceEnded)}:{})};
      validateTruck(t,state,true);await remoteCommand('truck.save',t);modal.close();render();notify('Cadastro salvo.');
    }
    else if(f.id==='end-activities-form'){const date=String(data.get('date'));await remoteCommand('truck.end',{id:f.dataset.id,date,note:String(data.get('note')||'')});currentMonth=date.slice(0,7);currentHalf=Number(date.slice(8))<=15?1:2;farmFilter='';modal.close();location.hash='closings';render();notify('Atividades encerradas e quinzena desta placa fechada.');}
    else if(f.id==='transfer-form'){await remoteCommand('truck.transfer',{id:f.dataset.id,toFarmId:String(data.get('toFarmId')),date:String(data.get('date')),note:String(data.get('note')||'')});farmFilter='';modal.close();render();notify('Transferência registrada. Confira os períodos e valores por fazenda.');}
    else if(f.id==='discount-form'){const byAmount=data.get('kind')==='amount',selection=String(data.get('truckId')||''),selected=state.trucks.find(t=>t.id===selection||t.plate===selection),plate=selected?.plate||selection,start=byAmount?data.get('date'):data.get('start'),end=byAmount?data.get('date'):data.get('end'),candidates=state.trucks.filter(t=>t.plate===plate&&start>=t.start&&(!t.end||start<=t.end)),truck=candidates.find(t=>!t.end||end<=t.end);if(!truck)throw Error(candidates.length&&!byAmount?'O período do desconto atravessa uma transferência de fazenda. Lance um desconto para cada período/fazenda.':`A placa ${plate||'selecionada'} não tinha atividade cadastrada na data informada.`);const d={id:f.dataset.id||uid(),truckId:truck.id,start,end,reason:byAmount?'Valor':data.get('reason'),note:String(data.get('note')||'').trim(),...(byAmount?{kind:'amount',amount:parseAmount(data.get('amount'))}:{})};validateDiscount(d,state);await remoteCommand('discount.save',d);modal.close();render();notify('Desconto salvo e prévia atualizada.');}
    else if(f.id==='payment-form'){
      if(!isCarrier()||!canOperate())throw Error('O pagamento exige acesso da transportadora.');
      const date=data.get('date'),file=data.get('receipt'),requestId=f.dataset.requestId;if(!validDate(date)||date>today())throw Error('Informe uma data de pagamento válida, até hoje.');
      if(!file||!file.size||file.size>10*1024*1024)throw Error('Anexe um comprovante em PDF, JPG ou PNG de até 10 MB.');
      const button=f.querySelector('[type="submit"]');button.disabled=true;try{const receipt=await cloud.uploadReceipt(requestId,file);await remoteCommand('payment.record',{requestId,date,note:String(data.get('note')||'').trim(),receiptId:receipt.id});modal.close();render();notify('Pagamento registrado com comprovante.');}finally{button.disabled=false;}
    }
    else if(f.id==='farm-form'){
      const id=f.dataset.id||uid(),editing=state.farms.some(saved=>saved.id===id),name=String(data.get('name')||'').trim(),document=String(data.get('document')||'').trim(),digits=document.replace(/\D/g,'');
      if(!name)throw Error('Informe o nome para identificar a fazenda.');
      if(state.farms.some(saved=>saved.id!==id&&saved.name.toLocaleLowerCase('pt-BR')===name.toLocaleLowerCase('pt-BR')))throw Error('Já existe uma fazenda com esse nome.');
      if(digits&&![11,14].includes(digits.length))throw Error('O CPF deve ter 11 dígitos ou o CNPJ deve ter 14 dígitos.');
      const farm={...(state.farms.find(saved=>saved.id===id)||{}),id,name,legalName:String(data.get('legalName')||'').trim(),cpf:digits.length===11?formatPaymentDocument(digits):'',cnpj:digits.length===14?formatPaymentDocument(digits):'',stateRegistration:String(data.get('stateRegistration')||'').trim(),address:String(data.get('address')||'').trim(),contactName:String(data.get('contactName')||'').trim(),contactEmail:String(data.get('contactEmail')||'').trim(),contactPhone:String(data.get('contactPhone')||'').trim()};
      if(farm.contactEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(farm.contactEmail))throw Error('Confira o e-mail de contato da fazenda.');
      const normalizeStateRegistration=value=>String(value||'').toLocaleUpperCase('pt-BR').replace(/[\s./-]/g,'');
      const registration=normalizeStateRegistration(farm.stateRegistration);
      const priorRegistration=normalizeStateRegistration(state.farms.find(saved=>saved.id===id)?.stateRegistration);
      if(registration&&registration!==priorRegistration&&!['ISENTO','NAOCONTRIBUINTE'].includes(registration)){
        const duplicate=state.farms.find(saved=>saved.id!==id&&normalizeStateRegistration(saved.stateRegistration)===registration);
        if(duplicate)throw Error(`A inscrição estadual já está cadastrada para ${duplicate.name}. Confira o cadastro das fazendas.`);
      }
      const farms=editing?state.farms.map(saved=>saved.id===id?farm:saved):[...state.farms,farm];
      try{await remoteCommand('farms.save',{farms});}
      catch(error){
        if(error.status!==409)throw error;
        const latest=await cloud.load(),latestFarm=latest.state?.farms?.find(saved=>saved.id===id)||null,original=farmEditSnapshots.get(id)||null;
        adoptServerData(latest);stale=false;updateCloudStatus();
        if(editing&&(!latestFarm||JSON.stringify(latestFarm)!==JSON.stringify(original))){
          farmEditSnapshots.set(id,latestFarm?JSON.parse(JSON.stringify(latestFarm)):null);
          throw Error(latestFarm?'Esta fazenda também foi atualizada por outra pessoa. Os dados atuais foram carregados; confira as informações e salve novamente.':'Esta fazenda foi removida por outra pessoa. Os dados foram atualizados; feche e abra o cadastro novamente.');
        }
        const refreshedFarm={...(latestFarm||farm),...farm};
        const refreshedFarms=editing?state.farms.map(saved=>saved.id===id?refreshedFarm:saved):[...state.farms,refreshedFarm];
        await remoteCommand('farms.save',{farms:refreshedFarms});
      }
      farmEditSnapshots.delete(id);modal.close();render();notify(editing?'Cadastro da fazenda atualizado.':'Fazenda cadastrada.');
    }
  }catch(err){formError(f,err.message||'Não foi possível salvar. Atualize os dados para conferir o salvamento no servidor.');}
});
document.addEventListener('change',async ev=>{
  const el=ev.target;
  if(el.id==='cte-request-pdfs'){const summary=el.closest('form')?.querySelector('[data-cte-invoice-summary]'),count=el.files?.length||0;if(summary)summary.textContent=count?`${count} PDF${count===1?' selecionado':'s selecionados'} para este manifesto.`:'Você pode selecionar até 10 PDFs deste mesmo manifesto.';return;}
  if(el.matches?.('[data-billing-select]')){el.checked?selectedBillingCteIds.add(el.dataset.billingSelect):selectedBillingCteIds.delete(el.dataset.billingSelect);const selected=cteDocuments.filter(doc=>selectedBillingCteIds.has(doc.id)&&!doc.paymentReceipt&&doc.billableTons!=null&&Number.isFinite(Number(doc.billableTons))),amount=selected.reduce((sum,doc)=>sum+Number(doc.billingAmount??Number(doc.billableTons)*Number(doc.billingRate||2.7)),0),form=modalContent.querySelector('#cte-billing-payment-form,#cte-billing-invoice-form');if(form){const count=form.querySelector('[data-billing-selected-count]'),total=form.querySelector('[data-billing-selected-total]'),button=form.querySelector('[type="submit"]');if(count)count.textContent=`${selected.length} CT-e(s) selecionado(s)`;if(total)total.textContent=money(amount);if(button)button.disabled=!selected.length;}return;}
  if(el.id==='cte-billing-month'){cteBillingMonth=/^\d{4}-\d{2}$/.test(el.value)?el.value:today().slice(0,7);cteBillingSearch='';cteBillingPage=1;selectedBillingCteIds.clear();main.innerHTML=cteBillingView();return;}
  if(el.matches?.('[data-payment-group-request]')){el.checked?selectedPaymentRequests.add(el.dataset.paymentGroupRequest):selectedPaymentRequests.delete(el.dataset.paymentGroupRequest);render();return;}
  if(el.matches?.('[data-payment-group-select]')){const key=decodeURIComponent(el.dataset.paymentGroupSelect);for(const request of portalRequests.filter(item=>item.status==='pending'&&paymentGroupKey(item)===key)){if(el.checked)selectedPaymentRequests.add(request.id);else selectedPaymentRequests.delete(request.id);}render();return;}
  if(el.matches?.('[data-member-profile]')){const [party,role]=el.value.split(':'),farmSelect=document.querySelector(`[data-member-farm][data-id="${CSS.escape(el.dataset.id)}"]`);if(farmSelect)farmSelect.hidden=party!=='farm';try{const farmId=party==='farm'?(farmSelect?.value||el.dataset.farm||''):null;if(party==='farm'&&!farmId){notify('Escolha a fazenda antes de conceder este acesso.');return;}if(party==='farm')updateMemberFarmSummary(el.dataset.id,farmId,'Salvando…');await cloud.updateMember(el.dataset.id,role,el.dataset.active==='true',party,farmId);await loadTeam();if(party==='farm'&&!teamMembers.some(member=>member.user_id===el.dataset.id&&member.farm_id===farmId))throw Error('O perfil foi enviado, mas a fazenda vinculada não foi confirmada. Atualize os dados e tente novamente.');notify('Perfil de acesso atualizado.');}catch(error){notify(error.message);await loadTeam();}return;}
  if(el.matches?.('[data-member-farm]')){const profile=document.querySelector(`[data-member-profile][data-id="${CSS.escape(el.dataset.id)}"]`);if(!profile||!profile.value.startsWith('farm:'))return;try{const [,role]=profile.value.split(':');updateMemberFarmSummary(el.dataset.id,el.value,'Salvando…');await cloud.updateMember(el.dataset.id,role,profile.dataset.active==='true','farm',el.value);await loadTeam();if(!teamMembers.some(member=>member.user_id===el.dataset.id&&member.farm_id===el.value))throw Error('A fazenda selecionada não foi confirmada. Atualize os dados e tente novamente.');notify('Fazenda de acesso atualizada.');}catch(error){notify(error.message);await loadTeam();}return;}
  if(el.id==='invite-profile'){const farmField=document.querySelector('#invite-farm-field'),farm=document.querySelector('#invite-farm'),isFarm=el.value.startsWith('farm:');if(farmField)farmField.hidden=!isFarm;if(farm)farm.required=isFarm;return;}
  if(el.id==='request-period'){portalPeriod=el.value;portalInvoice='';selectedPaymentRequests.clear();render();return;}
  if(el.id==='request-farm'){portalFarm=el.value;portalInvoice='';selectedPaymentRequests.clear();render();return;}
  if(el.id==='request-invoice'){portalInvoice=el.value;selectedPaymentRequests.clear();render();return;}
  if(el.id==='cte-farm-filter'){cteFarmFilter=el.value;ctePage=1;render();return;}
  if(el.matches?.('[data-cte-filter-option]')){const value=el.value;cteFilterDraft=el.checked?[...new Set([...cteFilterDraft,value])]:cteFilterDraft.filter(item=>item!==value);return;}
  if(['report-month','report-half','report-farm','report-scope','report-plate'].includes(el.id)){updateReportPeriod();return;}
  if(el.id==='period-month'){if(/^\d{4}-\d{2}$/.test(el.value)){currentMonth=el.value;render();}}
  else if(el.id==='complementary-farm')updateComplementaryInvoicePreview();
  else if(el.id==='farm-filter'){farmFilter=el.value;render();}
  else if(el.id==='truck-farm')updateTruckPaymentAccountOptions(el.form);
  else if(el.id==='truck-payment-account-select')updateTruckPaymentFields(el.form);
  else if(['discount-kind','discount-reason'].includes(el.id))updateDiscountKind(el.form);
  else if(['discount-start','discount-end','truck-start','truck-end'].includes(el.id))updateDateRange(el.form);
  else if(el.id==='truck-axles'){const other=el.value==='other',field=document.querySelector('#other-axles-field'),input=document.querySelector('#truck-other-axles');field.hidden=!other;input.required=other;if(!other)input.value='';}
  else if(el.id==='truck-payment-method')updateTruckPaymentFields(el.form);
  else if(el.id==='truck-payment-bank')updateOtherBankField(el.form);
  else if(el.id==='payment-account-method'||el.id==='payment-account-bank')updatePaymentAccountFields(el.form);
  else if(el.id==='activity-end-date')updateActivityEndPreview();
  else if(el.id==='transfer-farm'||el.id==='transfer-date')updateTransferPreview();
  else if(el.id==='closing-farm')updateClosingPreview();
  else if(el.id==='reopening-farm')updateReopeningPreview();
  else if(el.id==='backup-file'&&el.files[0]){try{const file=el.files[0];if(file.size>10000000)throw Error('O arquivo é grande demais para este controle.');pendingBackup=applyFixedMonthlyRule(validateState(JSON.parse(await file.text())));confirmation('Restaurar este backup?',`O arquivo contém ${pendingBackup.trucks.length} caminhão(ões), ${pendingBackup.discounts.length} desconto(s) e ${pendingBackup.closings.length} fechamento(s). Os registros atuais da empresa serão substituídos no banco online. Baixe um backup dos registros atuais antes de continuar, se precisar preservá-los.`,'confirm-import');}catch(err){pendingBackup=null;notify(err.message||'Não foi possível ler o backup.');}el.value='';}
});
document.addEventListener('input',ev=>{if(ev.target.id==='request-search'){portalSearch=ev.target.value;selectedPaymentRequests.clear();const pos=ev.target.selectionStart;render();const el=document.querySelector('#request-search');el.focus();el.setSelectionRange(pos,pos);}if(ev.target.id==='truck-search'){search=ev.target.value;const pos=ev.target.selectionStart;render();const el=document.querySelector('#truck-search');el.focus();el.setSelectionRange(pos,pos);}if(ev.target.id==='closing-search'){closingSearch=ev.target.value;const pos=ev.target.selectionStart;render();const el=document.querySelector('#closing-search');if(el){el.focus();el.setSelectionRange(pos,pos);}}});
modal.addEventListener('click',ev=>{
  if(modal.querySelector('#farm-form'))return;
  if(ev.target===modal){const r=modal.getBoundingClientRect();if(ev.clientX<r.left||ev.clientX>r.right||ev.clientY<r.top||ev.clientY>r.bottom)closeModalOrReturn();}
});
modal.addEventListener('cancel',ev=>{if(modal.querySelector('#farm-form'))ev.preventDefault();else if(modalStack.length){ev.preventDefault();closeModalOrReturn();}});

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
  if(['truck-payment-document','payment-account-document','farm-document'].includes(ev.target.id))maskPaymentDocumentInput(ev.target);
  if(ev.target.id==='farm-stateRegistration')maskStateRegistrationInput(ev.target);
  if(ev.target.id==='farm-contactPhone')maskFarmPhoneInput(ev.target);
  if(['discount-start','discount-end','truck-start','truck-end'].includes(ev.target.id))updateDateRange(ev.target.form);
  if(['truck-monthly','discount-amount'].includes(ev.target.id))ev.target.setCustomValidity('');
  if(ev.target.id==='transfer-date')updateTransferPreview();
  if(ev.target.id==='activity-end-date')updateActivityEndPreview();
});
document.addEventListener('keydown',ev=>{
  if(ev.key==='Escape'&&cteFilterFieldOpen){closeCteFilter();render();return;}
  const input=ev.target;
  if(!['truck-payment-document','payment-account-document','farm-document','farm-stateRegistration','farm-contactPhone'].includes(input.id)||!['Backspace','Delete'].includes(ev.key)||input.selectionStart!==input.selectionEnd)return;
  const position=input.selectionStart,backward=ev.key==='Backspace',separator=input.value[position-(backward?1:0)];
  if(!separator||/\d/.test(separator))return;
  ev.preventDefault();
  const digitCount=input.value.slice(0,position).replace(/\D/g,'').length;
  const digits=input.value.replace(/\D/g,'');
  const removedIndex=backward?digitCount-1:digitCount;
  if(removedIndex<0||removedIndex>=digits.length)return;
  const nextDigits=digits.slice(0,removedIndex)+digits.slice(removedIndex+1),formatted=input.id==='farm-contactPhone'?formatFarmPhoneInput(nextDigits):input.id==='farm-stateRegistration'?formatStateRegistrationInput(nextDigits):formatPaymentDocumentInput(nextDigits);
  input.value=formatted;
  const nextPosition=documentCaret(formatted,backward?removedIndex:digitCount);
  input.setSelectionRange?.(nextPosition,nextPosition);
});
document.addEventListener('focusout',ev=>{
  if(['truck-payment-document','payment-account-document','farm-document'].includes(ev.target.id)){ev.target.value=formatPaymentDocumentInput(ev.target.value);return;}
  if(ev.target.id==='farm-stateRegistration'){ev.target.value=formatStateRegistrationInput(ev.target.value);return;}
  if(ev.target.id==='farm-contactPhone'){ev.target.value=formatFarmPhoneInput(ev.target.value);return;}
  if(!['truck-monthly','discount-amount'].includes(ev.target.id))return;
  const n=parseAmount(ev.target.value);
  if(Number.isFinite(n)&&n>0){ev.target.value=amountLabel(n);ev.target.setCustomValidity('');}
  else if(ev.target.value.trim())ev.target.setCustomValidity('Informe um valor válido. Exemplo: 40.000,00.');
});

document.addEventListener('input',event=>{if(event.target.id==='cte-filter-search'){cteFilterSearch=event.target.value;const query=cteFilterSearch.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');document.querySelectorAll('[data-cte-option-row]').forEach(row=>row.hidden=!row.textContent.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').includes(query));}});
document.addEventListener('input',event=>{if(event.target.id!=='reconciliation-search')return;const value=event.target.value,position=event.target.selectionStart;main.innerHTML=reconciliationView();const input=main.querySelector('#reconciliation-search');input?.focus();input?.setSelectionRange(position,position);});
document.addEventListener('input',event=>{
 const id=event.target.id;if(!['cte-search','cte-queue-search','cte-billing-search','cte-farm-request-search'].includes(id))return;
 const value=event.target.value,position=event.target.selectionStart;
 if(id==='cte-search'){cteSearch=value;ctePage=1;main.innerHTML=ctesView();}
 if(id==='cte-queue-search'){cteQueueSearch=value;cteQueuePage=1;main.innerHTML=ctesView();}
 if(id==='cte-billing-search'){cteBillingSearch=value;cteBillingPage=1;main.innerHTML=cteBillingView();}
 if(id==='cte-farm-request-search'){cteFarmRequestSearch=value;cteFarmRequestPage=1;main.innerHTML=farmCteRequestsView();}
 const input=document.querySelector('#'+id);input?.focus();input?.setSelectionRange(position,position);
});
window.addEventListener('hashchange',()=>{render();window.scrollTo(0,0);});
async function restoreSession(){
  if(!cloud.hasSession()){render();return;}
  document.body.classList.add('logged-out');
  main.innerHTML='<div class="login-page"><section class="auth-card"><div class="auth-brand"><img class="auth-logo" src="./assets/rota-safra/logo-principal.png" width="768" height="485" alt="Rota Safra"></div><h1>Restaurando acesso</h1><p>Conferindo sua sessão com o servidor…</p></section></div>';
  try{adoptServerData(await cloud.load());render();}
  catch(error){
    if(error.status===400||error.status===401||error.status===403){cloud.forgetSession();render();return;}
    main.innerHTML=`<div class="login-page"><section class="auth-card"><div class="auth-brand"><img class="auth-logo" src="./assets/rota-safra/logo-principal.png" width="768" height="485" alt="Rota Safra"></div><h1>Não foi possível conectar</h1><p>${e(authErrorMessage(error))}</p><div class="actions" style="margin-top:20px"><button class="btn primary" data-action="restore-session">Tentar novamente</button><button class="btn" data-action="forget-session">Entrar novamente</button></div></section></div>`;
  }
}
if(inviteTicket)render();else restoreSession();
if(inviteTicket){cloud.inspectInvite(inviteTicket).then(info=>{inviteInfo=info;renderAccess();}).catch(error=>{const message=document.querySelector('#invite-message');if(message)message.textContent=authErrorMessage(error);});}
let checkingUpdates=false,nextGroupCheck=0,nextCteCheck=0;
async function checkForUpdates(force=false){
  if(!currentUser||saving||checkingUpdates||document.visibilityState==='hidden')return;
  if((view==='ctes'||view==='reconciliation'||view==='cte-requests'||view==='farm-billing'||view==='farms')&&!modal.open&&Date.now()>=nextCteCheck){nextCteCheck=Date.now()+30000;await loadCteData();}
  if(isFarmEmployee())return;
  if(!force&&!isCarrier()&&Date.now()<nextGroupCheck)return;
  if(!isCarrier())nextGroupCheck=Date.now()+60000;
  const userId=currentUser.id;checkingUpdates=true;
  try{
    const next=await cloud.version();
    if(!currentUser||currentUser.id!==userId||saving)return;
    if(stale||next.revision!==serverRevision||next.role&&next.role!==currentUser.role||next.party&&next.party!==currentUser.party){
      if(modal.open||reportDialog.open){stale=true;updateCloudStatus();}
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

function requestPaymentsButton(){const list=filteredRows().filter(r=>r.closed&&!r.paid&&!r.requestId&&r.net>0);return `<button class="btn primary" data-action="request-payments" ${!list.length||!canOperate()?'disabled':''}>Enviar para pagamento</button>`;}
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
 const entries=list.map(row=>{const truck=state.trucks.find(t=>t.id===row.truckId),account=state.paymentAccounts.find(item=>item.id===truck?.paymentAccountId),details=normalizePaymentDetails(account?.details||truck?.paymentDetails||{}),missing=paymentDetailsMissing(details);return {row,account,details,missing};}),blocked=entries.filter(item=>item.missing.length),groups=new Map();
 for(const entry of entries){const destinationKey=entry.account?.id||(!entry.missing.length?JSON.stringify(entry.details):'missing:'+entry.row.truckId),key=JSON.stringify([entry.row.closingId,destinationKey]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(entry);}
 const groupCards=[...groups.values()].map(items=>{const first=items[0],amount=round(items.reduce((total,item)=>total+item.row.net,0)),label=first.account?.name||first.row.paymentAccountName||`Conta de ${first.details.holder||first.row.plate}`,farms=[...new Set(items.map(item=>item.row.farmName))].join(' · '),members=items.map(({row,missing})=>`<div class="farm-payment-line"><span><strong>${e(row.plate)}</strong> · ${e(row.driver)}<small>${e(row.farmName)}</small></span><span class="request-preview-actions"><strong>${money(row.net)}</strong>${missing.length?`<button class="btn small" type="button" data-action="edit-truck" data-id="${e(row.truckId)}">Preencher dados</button>`:''}</span></div>`).join(''),destination=first.missing.length?`<div class="form-note warn"><strong>Dados de pagamento incompletos</strong><br>Faltam: ${e(first.missing.join(', '))}</div>`:paymentDetailsMarkup(first.details);return `<section class="farm-payment-group"><div class="farm-payment-group-heading"><div><strong>${e(label)}</strong><span>${items.length} placa(s) · ${e(farms)}</span></div><strong>${money(amount)}</strong></div>${destination}<div class="farm-payment-lines">${members}<div class="farm-payment-subtotal"><strong>Total desta conta</strong><strong>${money(amount)}</strong></div></div></section>`;}).join('');
 const farms=[...new Set(list.map(row=>row.farmName))].join(' · '),destinationKeys=new Set(entries.map(entry=>entry.account?.id||(!entry.missing.length?JSON.stringify(entry.details):'missing:'+entry.row.truckId))),accountCount=destinationKeys.size,groupCount=groups.size,total=money(sum(list,'net')),plateCountLabel=list.length===1?'1 placa':`${list.length} placas`,accountCountLabel=accountCount===1?'1 conta de destino':`${accountCount} contas de destino`,groupCountLabel=groupCount===1?'1 grupo de pagamento':`${groupCount} grupos de pagamento`,paymentActionLabel=list.length===1?'Enviar 1 lançamento':`Enviar ${list.length} lançamentos`;
 openModal('Conferir e enviar lançamentos',`${periodLabel(currentPeriod())} · ${list.length} placa(s)`, `<form id="request-payments-form" data-truck-id="${e(truckId)}">${errBox()}<div class="form-note"><strong>Resumo da fatura da quinzena</strong><br>${e(farms||'Fazendas selecionadas')} · ${plateCountLabel} · ${accountCountLabel}<br>${groupCountLabel} separados por fazenda/fatura<br>Total a enviar: <strong>${total}</strong></div>${blocked.length?`<div class="form-note warn"><strong>${blocked.length} placa(s) com dados de pagamento incompletos.</strong><br>Preencha os dados para liberar o envio.</div>`:`<div class="form-note">Confira as contas que receberão cada valor. A transportadora verá os lançamentos agrupados por conta dentro de cada fatura e poderá registrar uma transferência e um comprovante para cada grupo.</div>`}<div class="farm-payment-groups">${groupCards}</div><p class="secondary">Ao confirmar, cada lançamento de placa será enviado à transportadora com o valor e a conta indicados acima.</p><div class="form-actions"><button class="btn" type="button" data-action="close-modal">Voltar e conferir</button><button class="btn primary" type="submit" ${blocked.length?'disabled':''}>${paymentActionLabel} · ${total}</button></div></form>`,{wide:true});
}function requestReasonForm(id,operation){const title=operation==='cancel'?'Cancelar solicitação':operation==='legacy'?'Corrigir registro anterior ao portal':'Corrigir registro de pagamento';openModal(title,'O motivo e o histórico serão preservados.',`<form id="request-reason-form" data-id="${e(id)}" data-operation="${e(operation)}">${errBox()}<div class="field"><label>Motivo *</label><textarea name="note" required maxlength="300" placeholder="Explique por que o registro precisa ser corrigido"></textarea></div><div class="form-note">${operation==='cancel'?'O pagamento ainda não foi registrado no portal. Confira com a transportadora antes de cancelar. O cancelamento libera o fechamento para ajustes.':'Esta ação corrige o controle no portal. Confirme a situação da transferência antes de continuar.'}</div><div class="form-actions"><button class="btn" type="button" data-action="close-modal">Voltar</button><button class="btn danger" type="submit">Confirmar com motivo</button></div></form>`);}
const requestStatus=r=>r.status==='paid'?'Pago':r.status==='cancelled'?'Solicitação cancelada':'Fechado, aguardando pagamento';
const timeLabel=value=>value?new Date(value).toLocaleString('pt-BR',{timeZone:'America/Cuiaba'}):'—';
function paymentGroupKey(request){const details=request.snapshot.paymentDetails||{};return JSON.stringify([request.closingId||'legacy-'+(request.batchId||request.id),request.snapshot.paymentAccountId||'',details]);}
function paymentDestinationLabel(details={}){if(details.method==='pix')return `Pix · ${details.holder||'Titular não informado'} · ${details.pixKey||'Chave não informada'}`;if(details.method==='bank')return `${details.bankName||'Banco'} · ${details.holder||'Titular não informado'} · ag. ${details.agency||'—'} · conta ${details.account||'—'}`;return 'Conta de pagamento não identificada';}
function paymentHistoryKey(request){return request.payment?.paymentGroupId?'transfer:'+request.payment.paymentGroupId:'single:'+request.id;}
function paymentHistoryTable(list,allRequests,invoiceKey){
 const periods=new Map();for(const request of list){const key=request.period.key;if(!periods.has(key))periods.set(key,{period:request.period,invoices:new Map()});const period=periods.get(key),invoiceId=invoiceKey(request);if(!period.invoices.has(invoiceId))period.invoices.set(invoiceId,{invoiceNumber:request.invoiceNumber,requests:[]});period.invoices.get(invoiceId).requests.push(request);}
 let entryCount=0,paymentCount=0,cancelledCount=0;
 const html=[...periods.values()].sort((a,b)=>b.period.key.localeCompare(a.period.key)).map(period=>`<div class="request-fortnight"><h3>Quinzena ${e(periodLabel(period.period))}</h3>${[...period.invoices.entries()].sort((a,b)=>(a[1].invoiceNumber||0)-(b[1].invoiceNumber||0)).map(([invoiceId,invoice])=>{
  const visiblePaid=invoice.requests.filter(request=>request.status==='paid'),visibleCancelled=invoice.requests.filter(request=>request.status==='cancelled'),paidKeys=new Set(visiblePaid.map(paymentHistoryKey)),paidGroups=new Map();
  for(const request of allRequests){if(request.status!=='paid'||invoiceKey(request)!==invoiceId||request.period.key!==period.period.key||!paidKeys.has(paymentHistoryKey(request)))continue;const key=paymentHistoryKey(request);if(!paidGroups.has(key))paidGroups.set(key,[]);paidGroups.get(key).push(request);}
  const records=[...paidGroups.entries()].map(([key,items])=>({key,items,paid:true,sortDate:items[0].payment?.recordedAt||items[0].payment?.date||items[0].requestedAt})).concat(visibleCancelled.map(request=>({key:request.id,items:[request],paid:false,sortDate:request.cancelledAt||request.requestedAt}))).sort((a,b)=>b.sortDate.localeCompare(a.sortDate));
  paymentCount+=paidGroups.size;cancelledCount+=visibleCancelled.length;entryCount+=records.length;if(!records.length)return '';
  const rows=records.map(record=>{const request=record.items[0],snapshot=request.snapshot,total=round(record.items.reduce((sum,item)=>sum+item.snapshot.net,0)),farmNames=[...new Set(record.items.map(item=>item.snapshot.farmName))],plates=record.items.map(item=>item.snapshot.plate).join(', '),payment=request.payment,receipt=payment?.receipt,label=snapshot.paymentAccountName||paymentDestinationLabel(snapshot.paymentDetails);return `<tr><td><strong>${record.paid?e(label):'Solicitação cancelada'}</strong>${record.paid?'':`<span class="secondary">${e(snapshot.plate)} · ${e(snapshot.driver)}</span>`}</td><td>${e(farmNames.join(' · '))}<span class="secondary">${e(periodLabel(request.period))}</span></td><td>${record.items.length} placa(s)<span class="secondary">${e(plates)}</span></td><td class="num value">${money(total)}</td><td><span class="badge ${record.paid?'green':'gray'}">${record.paid?'Pago':'Cancelada'}</span><span class="secondary">${record.paid?'Pago em '+dateLabel(payment?.date):'Cancelada em '+dateLabel((request.cancelledAt||request.requestedAt).slice(0,10))}</span></td><td><div class="actions">${record.paid&&receipt?`<button class="btn small" data-action="receipt-view" data-id="${e(receipt.id)}">Comprovante</button>`:''}<button class="btn small" data-action="${record.paid?'payment-group-detail':'request-detail'}" data-id="${e(record.paid?record.key:request.id)}">Detalhes</button></div></td></tr>`;}).join('');
  return `<section class="request-invoice-group"><div class="request-invoice-heading"><div><strong>Fatura ${invoice.invoiceNumber||'—'}</strong><span>${e([...new Set(invoice.requests.map(request=>request.snapshot.farmName))].join(' · '))} · ${records.length} registro(s)</span></div></div><div class="table-wrap"><table><thead><tr><th>PAGAMENTO / CONTA</th><th>FAZENDA / QUINZENA</th><th>PLACAS</th><th class="num">TOTAL</th><th>SITUAÇÃO / DATA</th><th>AÇÕES</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
 }).join('')}</div>`).join('');
 return {html,entryCount,paymentCount,cancelledCount};
}
function groupedCarrierTable(list,invoiceKey,table){
 const groups=new Map();for(const request of list){const periodKey=request.period.key;if(!groups.has(periodKey))groups.set(periodKey,{period:request.period,invoices:new Map()});const group=groups.get(periodKey),key=invoiceKey(request);if(!group.invoices.has(key))group.invoices.set(key,{invoiceNumber:request.invoiceNumber,requests:[]});group.invoices.get(key).requests.push(request);}
 return [...groups.values()].sort((a,b)=>b.period.key.localeCompare(a.period.key)).map(group=>`<div class="request-fortnight"><h3>Quinzena ${e(periodLabel(group.period))}</h3>${[...group.invoices.values()].sort((a,b)=>(a.invoiceNumber||0)-(b.invoiceNumber||0)).map(invoice=>{const rows=invoice.requests,farmNames=[...new Set(rows.map(r=>r.snapshot.farmName))],amount=round(rows.reduce((total,r)=>total+r.snapshot.net,0)),pendingOnly=rows.every(r=>r.status==='pending');if(!pendingOnly)return `<section class="request-invoice-group"><div class="request-invoice-heading"><div><strong>Fatura ${invoice.invoiceNumber||'—'}</strong><span>${e(farmNames.join(' · '))} · ${rows.length} lançamento(s)</span></div><strong>${money(amount)}</strong></div>${table(rows)}</section>`;const payees=new Map();for(const request of rows){const key=paymentGroupKey(request);if(!payees.has(key))payees.set(key,[]);payees.get(key).push(request);}return `<section class="request-invoice-group"><div class="request-invoice-heading"><div><strong>Fatura ${invoice.invoiceNumber||'—'}</strong><span>${e(farmNames.join(' · '))} · ${rows.length} lançamento(s)</span></div><strong>${money(amount)}</strong></div>${[...payees.entries()].map(([key,items])=>{const token=encodeURIComponent(key),total=round(items.reduce((sum,item)=>sum+item.snapshot.net,0)),snapshot=items[0].snapshot,label=snapshot.paymentAccountName||paymentDestinationLabel(snapshot.paymentDetails),destination=PAYMENT_METHODS[snapshot.paymentDetails?.method]||'Dados de pagamento',details=items.map(item=>`<tr><td><strong class="plate">${e(item.snapshot.plate)}</strong><span class="secondary">${e(item.snapshot.driver)}</span></td><td>${e(item.snapshot.farmName)}</td><td class="num">${money(item.snapshot.gross)}</td><td class="num ${item.snapshot.discount?'discount':''}">${money(item.snapshot.discount)}</td><td class="num value">${money(item.snapshot.net)}</td><td>${item.snapshot.discountDays} dia(s)</td><td>${item.snapshot.payableDays} dia(s)</td></tr>`).join('');return `<div class="request-payee-group"><div class="request-payee-heading"><span><strong>${e(label)}</strong><small>${e(destination)} · ${items.length} placa(s) · ${e(snapshot.farmName)} · total líquido ${money(total)}</small></span><button class="btn small" data-action="request-account-detail" data-group="${e(token)}">Detalhes</button></div></div>`;}).join('')}</section>`;}).join('')}</div>`).join('');
}
function requestAccountDetail(key){
 const requests=portalRequests.filter(request=>request.status==='pending'&&paymentGroupKey(request)===key);if(!requests.length)throw Error('Fatura ou conta não encontrada.');
 const gross=round(requests.reduce((sum,request)=>sum+(request.snapshot.gross||0),0)),discount=round(requests.reduce((sum,request)=>sum+(request.snapshot.discount||0),0));
 const plateRows=requests.map(({snapshot:row})=>`<tr><td><strong class="plate">${e(row.plate)}</strong><span class="secondary">${e(row.driver)}</span></td><td>${e(row.farmName)}</td><td class="num">${money(row.gross||0)}</td><td class="num ${row.discount?'discount':''}">${money(row.discount||0)}<span class="secondary">${row.discount?`${row.discountDays||0} dia(s) descontado(s)`:'Sem desconto'}</span></td><td class="num value">${money(row.net)}</td><td>${row.discountDays||0} dia(s)</td><td>${row.payableDays??'—'} dia(s)</td></tr>`).join('');
 const plateReview=`<section class="card" style="margin:18px 0 0"><div class="card-header"><div><h3>Conferência por placa</h3><p>Confira o valor bruto, o desconto aplicado e o líquido antes de programar o pagamento.</p></div></div><div class="table-wrap"><table><thead><tr><th>PLACA / MOTORISTA</th><th>FAZENDA</th><th class="num">BRUTO</th><th class="num">DESCONTO</th><th class="num">LÍQUIDO</th><th>DIAS DESCONTADOS</th><th>DIAS A PAGAR</th></tr></thead><tbody>${plateRows}</tbody><tfoot><tr><th colspan="2">TOTAL DA CONTA</th><th class="num">${money(gross)}</th><th class="num">${money(discount)}</th><th class="num">${money(round(requests.reduce((sum,request)=>sum+request.snapshot.net,0)))}</th><th>—</th><th>—</th></tr></tfoot></table></div></section>`;

 const first=requests[0],snapshot=first.snapshot,total=round(requests.reduce((sum,request)=>sum+request.snapshot.net,0)),farms=[...new Set(requests.map(request=>request.snapshot.farmName))],paymentForm=isCarrier()&&canOperate()?`<form id="payment-batch-form" data-request-ids="${e(JSON.stringify(requests.map(item=>item.id)))}" style="margin-top:20px">${errBox()}<div class="form-note"><strong>Registrar pagamento desta conta</strong><br>O comprovante será compartilhado com o grupo e vinculado aos ${requests.length} lançamento(s) desta fatura.</div><div class="field"><label for="paid-batch-date">Data do pagamento *</label><input id="paid-batch-date" name="date" type="date" value="${today()}" max="${today()}" required></div><div class="field"><label for="paid-batch-receipt">Comprovante da transferência *</label><input id="paid-batch-receipt" name="receipt" type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" required><small>Um comprovante será compartilhado por toda a conta. PDF, JPG ou PNG, até 10 MB.</small></div><div class="field"><label for="paid-batch-note">Observação</label><input id="paid-batch-note" name="note" maxlength="300" placeholder="Ex.: transferência conjunta via Pix"></div><div class="form-actions"><button class="btn primary" type="submit">Confirmar pagamento e anexar comprovante · ${money(total)}</button></div></form>`:'';
 openModal(`Detalhes · Fatura ${first.invoiceNumber||'—'}`,`${periodLabel(first.period)} · ${e(farms.join(' · '))}`,`<div class="form-note"><strong>Conta indicada para pagamento</strong><br>${e(snapshot.paymentAccountName||'Conta cadastrada para esta placa')}</div>${paymentDetailsMarkup(snapshot.paymentDetails,first.status)}<div class="detail-grid"><div><small>Valor desta conta</small><strong>${money(total)}</strong></div><div><small>Número da fatura</small><strong>${first.invoiceNumber||'—'}</strong></div><div><small>Fazenda(s)</small><strong>${e(farms.join(' · '))}</strong></div></div>${plateReview}${paymentForm}<div class="form-actions"><button class="btn" data-action="close-modal">Fechar</button></div>`,{wide:true});
}function requestsView(){
 const periods=[...new Map(portalRequests.map(r=>[r.period.key,r.period])).values()].sort((a,b)=>b.key.localeCompare(a.key));
 const farms=isCarrier()?[...new Map(portalRequests.map(r=>({id:r.snapshot.farmId,name:r.snapshot.farmName})).map(f=>[f.id,f])).values()]:state.farms;
 const invoiceSources=portalRequests.filter(r=>(!portalPeriod||r.period.key===portalPeriod)&&(!portalFarm||r.snapshot.farmId===portalFarm)),invoiceKey=r=>r.closingId||'legacy-'+(r.batchId||r.id),invoiceOptions=[...new Map(invoiceSources.map(r=>[invoiceKey(r),r])).values()].sort((a,b)=>a.period.key.localeCompare(b.period.key)||((a.invoiceNumber||0)-(b.invoiceNumber||0))||a.requestedAt.localeCompare(b.requestedAt));
 const base=invoiceSources.filter(r=>(!portalInvoice||invoiceKey(r)===portalInvoice)&&(!portalSearch||(r.snapshot.plate+' '+r.snapshot.driver).toLocaleLowerCase('pt-BR').includes(portalSearch.toLocaleLowerCase('pt-BR')))).sort((a,b)=>b.requestedAt.localeCompare(a.requestedAt)||a.snapshot.farmName.localeCompare(b.snapshot.farmName));
 const pendingRows=base.filter(r=>r.status==='pending'),historyRows=base.filter(r=>r.status!=='pending'),history=paymentHistoryTable(historyRows,invoiceSources,invoiceKey);
 const paid=round(base.filter(r=>r.status==='paid').reduce((n,r)=>n+r.snapshot.net,0)),pending=round(pendingRows.reduce((n,r)=>n+r.snapshot.net,0));
  const rowsMarkup=(list,selectable=false)=>list.map(r=>`<tr>${selectable?`<td><input type="checkbox" aria-label="Selecionar ${e(r.snapshot.plate)} para pagamento conjunto" data-payment-group-request="${e(r.id)}" ${selectedPaymentRequests.has(r.id)?'checked':''} ${canOperate()?'':'disabled'}></td>`:''}<td><strong class="plate">${e(r.snapshot.plate)}</strong><span class="secondary">${e(r.snapshot.driver)}</span></td><td>${e(r.snapshot.farmName)}<span class="secondary">${e(periodLabel(r.period))}</span></td><td class="num value">${money(r.snapshot.net)}</td><td><span class="badge ${r.status==='paid'?'green':r.status==='cancelled'?'gray':'amber'}">${requestStatus(r)}</span>${r.status==='paid'&&r.payment?`<span class="secondary">Pago em ${dateLabel(r.payment.date)}</span>${r.payment.paymentGroupAmount?`<span class="secondary">Pagamento conjunto · ${money(r.payment.paymentGroupAmount)}</span>`:''}`:r.status==='cancelled'?`<span class="secondary">Cancelada em ${dateLabel((r.cancelledAt||r.requestedAt).slice(0,10))}</span>`:`<span class="secondary">Solicitado em ${dateLabel(r.requestedAt.slice(0,10))}</span>`}${r.status==='pending'&&paymentDetailsMissing(r.snapshot.paymentDetails).length?'<span class="secondary">Faltam dados de pagamento</span>':''}</td><td><div class="actions">${r.payment?.receipt?`<button class="btn small" data-action="receipt-view" data-id="${e(r.payment.receipt.id)}">Comprovante</button>`:''}<button class="btn small" data-action="request-detail" data-id="${e(r.id)}">Detalhes</button></div></td></tr>`).join('');
  const table=(list,selectable=false)=>`<div class="table-wrap"><table><thead><tr>${selectable?'<th>SELECIONAR</th>':''}<th>PLACA / MOTORISTA</th><th>FAZENDA / QUINZENA</th><th class="num">VALOR DO LANÇAMENTO</th><th>SITUAÇÃO / DATA</th><th>AÇÕES</th></tr></thead><tbody>${rowsMarkup(list,selectable)}</tbody></table></div>`;
  const groupedTable=list=>groupedCarrierTable(list,invoiceKey,table);
 const invoiceFilter=isCarrier()?`<select id="request-invoice" aria-label="Filtrar fatura">${opt('','Todas as faturas',portalInvoice)}${invoiceOptions.map(r=>opt(invoiceKey(r),`Fatura ${r.invoiceNumber||'—'} · ${periodLabel(r.period)} · ${r.snapshot.farmName}`,portalInvoice)).join('')}</select>`:'';
 return head(isCarrier()?'Pagamentos da transportadora':'Lançamentos para pagamento',isCarrier()?'Receba as solicitações do grupo e registre cada pagamento com comprovante.':'Acompanhe os pagamentos por placa e consulte o histórico.','','GRUPO E TRANSPORTADORA')+`<div class="period-bar"><div class="period-controls"><select id="request-period" aria-label="Filtrar quinzena">${opt('','Todas as quinzenas',portalPeriod)}${periods.map(p=>opt(p.key,periodLabel(p),portalPeriod)).join('')}</select><select id="request-farm" aria-label="Filtrar fazenda">${opt('','Todas as fazendas',portalFarm)}${farms.map(f=>opt(f.id,f.name,portalFarm)).join('')}</select>${invoiceFilter}<input id="request-search" type="search" value="${e(portalSearch)}" placeholder="Buscar placa ou motorista" aria-label="Buscar placa ou motorista"></div></div><div class="metric-grid request-metrics"><div class="metric"><div class="metric-label">Lançamentos nesta seleção</div><div class="metric-value">${base.length}</div></div><div class="metric featured"><div class="metric-label">Aguardando pagamento</div><div class="metric-value money">${money(pending)}</div></div><div class="metric"><div class="metric-label">Pagamentos registrados</div><div class="metric-value money">${money(paid)}</div></div></div><section class="card"><div class="card-header"><div><h2>Lançamentos aguardando pagamento</h2><p>Lançamentos agrupados por quinzena e fatura.</p></div><span class="badge amber">${pendingRows.length}</span></div>${pendingRows.length?groupedTable(pendingRows):`<div class="empty"><h3>Nenhum lançamento pendente nesta seleção</h3><p>Lançamentos pagos ou cancelados ficam no histórico abaixo.</p></div>`}<div class="card-footer"><span>${pendingRows.length} lançamento(s) aguardando pagamento</span><strong>Total: ${money(pending)}</strong></div></section><section class="card" style="margin-top:24px"><div class="card-header"><div><h2>Histórico de pagamentos</h2><p>Cada transferência aparece uma vez; detalhes mostram as placas e o comprovante.</p></div><span class="badge gray">${history.entryCount}</span></div>${history.entryCount?history.html:'<div class="empty"><h3>Nenhum pagamento no histórico desta seleção</h3><p>Pagamentos registrados e solicitações canceladas aparecerão aqui.</p></div>'}<div class="card-footer"><span>${history.paymentCount} pagamento(s) · ${history.cancelledCount} solicitação(ões) cancelada(s)</span><strong>Total pago: ${money(paid)}</strong></div></section>`;
}function requestDetail(id){
  const request=portalRequests.find(item=>item.id===id);if(!request)throw Error('Solicitação não encontrada.');
  const row=request.snapshot;
  const paymentActions=request.status==='pending'&&canOperate()&&!isCarrier()?`<button class="btn danger" data-action="cancel-request" data-id="${e(id)}">Cancelar solicitação</button>`:'';
  openModal(row.plate+' · '+row.driver,row.farmName+' · '+periodLabel(request.period),`<div class="form-note"><strong>${requestStatus(request)}</strong><br>Valor solicitado: <strong>${money(row.net)}</strong><br>Solicitado em ${e(timeLabel(request.requestedAt))}${request.requestedEmail?' por '+e(request.requestedEmail):''}</div><div class="detail-grid"><div><small>Valor bruto</small><strong>${money(row.gross)}</strong></div><div><small>Descontos</small><strong>${money(row.discount)}</strong></div><div><small>Dias a pagar</small><strong>${row.payableDays}</strong></div><div><small>Transportador contratado</small><strong>${e(row.carrier)}</strong></div></div>${paymentDetailsMarkup(row.paymentDetails,request.status)}${request.payment?`<div class="form-note">Pago em ${dateLabel(request.payment.date)}${request.payment.recordedEmail?' por '+e(request.payment.recordedEmail):''}<br>${e(request.payment.receipt.name)}<br><button class="btn small" data-action="receipt-view" data-id="${e(request.payment.receipt.id)}">Abrir comprovante</button></div>`:''}${request.status==='cancelled'?`<div class="form-note">Cancelada em ${e(timeLabel(request.cancelledAt))}<br>Motivo: ${e(request.cancelReason)}</div>`:''}${request.paymentHistory.length?`<div class="event-list"><h3>Correções anteriores</h3>${request.paymentHistory.map(item=>`<p>${e(timeLabel(item.at))} · ${e(item.reason)}<br>Pagamento anterior em ${dateLabel(item.payment.date)} · <button class="btn small" data-action="receipt-view" data-id="${e(item.payment.receipt.id)}">Comprovante anterior</button></p>`).join('')}</div>`:''}<div class="form-actions">${paymentActions}<button class="btn" data-action="close-modal">Fechar</button></div>`);
}function paymentGroupDetail(key){
 const items=portalRequests.filter(request=>request.status==='paid'&&paymentHistoryKey(request)===key);if(!items.length)throw Error('Pagamento não encontrado.');
 const first=items[0],payment=first.payment,snapshot=first.snapshot,total=round(items.reduce((sum,item)=>sum+item.snapshot.net,0)),label=snapshot.paymentAccountName||paymentDestinationLabel(snapshot.paymentDetails),receipt=payment?.receipt;
 const rows=items.map(item=>`<tr><td><strong class="plate">${e(item.snapshot.plate)}</strong><span class="secondary">${e(item.snapshot.driver)}</span></td><td>${e(item.snapshot.farmName)}</td><td class="num value">${money(item.snapshot.net)}</td></tr>`).join('');
 openModal('Detalhes do pagamento',label,`<div class="detail-grid"><div><small>Data do pagamento</small><strong>${dateLabel(payment?.date)}</strong></div><div><small>Placas incluídas</small><strong>${items.length}</strong></div><div><small>Total transferido</small><strong>${money(total)}</strong></div><div><small>Registrado por</small><strong>${e(payment?.recordedEmail||'Transportadora')}</strong></div></div>${payment?.note?`<div class="form-note">Observação: ${e(payment.note)}</div>`:''}<section class="card" style="margin:18px 0 0"><div class="card-header"><div><h3>Placas deste pagamento</h3><p>O valor individual de cada placa faz parte da transferência acima.</p></div></div><div class="table-wrap"><table><thead><tr><th>PLACA / MOTORISTA</th><th>FAZENDA</th><th class="num">VALOR</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><th colspan="2">TOTAL DA TRANSFERÊNCIA</th><th class="num">${money(total)}</th></tr></tfoot></table></div></section><div class="form-actions">${receipt?`<button class="btn primary" data-action="receipt-view" data-id="${e(receipt.id)}">Abrir comprovante</button>`:''}<button class="btn" data-action="close-modal">Fechar</button></div>`,{wide:true});
}async function showReceipt(id){const receipt=await cloud.receiptLink(id);openModal('Documento anexado',receipt.name,`<div class="form-note">Arquivo privado. O link de acesso vale por um minuto.</div><div class="form-actions"><a class="btn primary" href="${e(receipt.signedUrl)}" target="_blank" rel="noopener noreferrer">Abrir documento</a><button class="btn" data-action="close-modal">Fechar</button></div>`);}




