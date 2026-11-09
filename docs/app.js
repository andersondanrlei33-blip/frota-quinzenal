Warning: truncated output (original token count: 78891)
Total output lines: 1379

import {isAmountDiscount,amountDiscountTotal,MODES,BODY_TYPES,PAYMENT_METHODS,normalizePaymentDetails,paymentDetailsMissing,initialState,validateState,validateTruck,validateDiscount,draft,period,periodLabel,dateLabel,days,overlaps,round,money,today,uid,csv,amountLabel,parseAmount,dateRangeError,validDate,periodClosings,farmClosing,openFarmIds,periodRows,closingPreview,saveClosing,reopenClosing,discountLocked,shiftDate,previewTransfer,undoTransferBlockReason,transferTruck,latestTruck,previewEndActivities,endActivities,applyFixedMonthlyRule,farmHasLinks,removeFarm,setFarmActive} from './engine.js?v=127';
import {createReport,reportMarkup} from './reports.js?v=158';
import {cloud,authErrorMessage,APP_ENVIRONMENT,TEST_ACCESS_EMAIL} from './cloud-ui.js?v=133';

let uiGeneration=0;
let checkingUpdates=false,nextGroupCheck=0,nextCteCheck=0;
let state=initialState(),loadError='',currentUser=null,currentCompany=null,serverRevision=0,saving=false,stale=false,inviteInfo=null,inviteSignin=false;
let teamMembers=[],teamSelectedFarmId='',farmEditSnapshots=new Map();
let inviteTicket=location.hash.startsWith('#activate=')?location.hash.slice(10):null;
let portalRequests=[],portalPeriod='',portalFarm='',portalInvoice='',portalSearch='',selectedPaymentRequests=new Set();
let cteDocuments=[],cteRequests=[],cteTrucks=[],cteFarms=[],billingInvoices=[],cteFarmFilter='',cteSearch='',ctePage=1,cteQueueSearch='',cteQueuePage=1,cteBillingSearch='',cteBillingPage=1,cteFarmRequestSearch='',cteFarmRequestPage=1,cteColumnFilters={},cteFilterFieldOpen='',cteFilterDraft=[],cteFilterOptions=[],cteFilterSearch='',cteFilterAnchor={top:0,left:0},cteLoading=false,cteSummaryLoaded=false,ctePreferences={visibleColumns:[],columnOrder:[]},ctePreferenceDraft=null,cteRequestForUpload='',farmCteTab='request',farmCteSelectedFarmId='';
let selectedBillingCteIds=new Set(),cteBillingMonth='';
const formatCteDocument=(value,type)=>{const digits=String(value||'').replace(/\D/g,'');if(type==='cnpj'&&digits.length===14)return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5');if(type==='cpf'&&digits.length===11)return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/,'$1.$2.$3-$4');return value||'—';};
const cteParticipant=(doc,party,key)=>key==='cnpj'||key==='cpf'?formatCteDocument(doc.participantDetails?.[party]?.[key],key):doc.participantDetails?.[party]?.[key]||'—';
const cteParticipantDocument=(doc,party)=>{const cnpj=cteParticipant(doc,party,'cnpj');return cnpj==='—'?cteParticipant(doc,party,'cpf'):cnpj;};
const CTE_FILTER_FIELDS={number:{label:'Número do CT-e',get:doc=>doc.number||'—'},farm:{label:'Fazenda',get:doc=>doc.farmName||'Fazenda não identificada'},shipper:{label:'Remetente',get:doc=>doc.shipper||'—'},recipient:{label:'Destinatário',get:doc=>doc.recipient||'—'},serviceTaker:{label:'Tomador do serviço',get:doc=>doc.serviceTaker||'—'},issuer:{label:'Transportadora',get:doc=>doc.issuer||'—'},totalValue:{label:'Valor do serviço',get:doc=>money(doc.totalValue||0)},issuedOn:{label:'Data de emissão',get:doc=>dateLabel(doc.issuedOn)},plate:{label:'Placa',get:doc=>doc.plate||'—'},cargoWeight:{label:'Peso da carga',get:doc=>doc.cargoWeight==null?'—':`${Number(doc.cargoWeight).toLocaleString('pt-BR',{maximumFractionDigits:3})}${doc.cargoWeightUnit?' '+doc.cargoWeightUnit:' (unidade não informada)'}`},responseTime:{label:'Tempo até receber',get:doc=>cteResponseTime(doc)},manifestedNotes:{label:'Notas fiscais manifestadas',get:doc=>(doc.manifestedNotes||[]).join(', ')||'—'},shipperCity:{label:'Cidade do remetente',get:doc=>cteParticipant(doc,'shipper','city')},shipperStateRegistration:{label:'IE do remetente',get:doc=>cteParticipant(doc,'shipper','stateRegistration')},shipperDocument:{label:'CPF/CNPJ do remetente',get:doc=>cteParticipantDocument(doc,'shipper')},recipientCity:{label:'Cidade do destinatário',get:doc=>cteParticipant(doc,'recipient','city')},recipientStateRegistration:{label:'IE do destinatário',get:doc=>cteParticipant(doc,'recipient','stateRegistration')},recipientDocument:{label:'CPF/CNPJ do destinatário',get:doc=>cteParticipantDocument(doc,'recipient')},serviceTakerCity:{label:'Cidade do tomador',get:doc=>cteParticipant(doc,'serviceTaker','city')},serviceTakerStateRegistration:{label:'IE do tomador',get:doc=>cteParticipant(doc,'serviceTaker','stateRegistration')},serviceTakerDocument:{label:'CPF/CNPJ do tomador',get:doc=>cteParticipantDocument(doc,'serviceTaker')},issuerCity:{label:'Cidade da transportadora',get:doc=>cteParticipant(doc,'issuer','city')},issuerStateRegistration:{label:'IE da transportadora',get:doc=>cteParticipant(doc,'issuer','stateRegistration')},issuerDocument:{label:'CPF/CNPJ da transportadora',get:doc=>cteParticipantDocument(doc,'issuer')}};
const DEFAULT_CTE_COLUMNS=['number','shipper','recipient','serviceTaker','issuer','totalValue','issuedOn','plate','cargoWeight','responseTime'],ALL_CTE_COLUMNS=Object.keys(CTE_FILTER_FIELDS);
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
 const truckCount=state.trucks.filter(truck=>truck.farmId===farm.id&&truck.start<=today()&&(!truck.end||truck.end>=today())).length,closings=state.closings.filter(closing=>(closing.farmIds||[]).includes(farm.id)),openRows=closings.flatMap(closing=>closing.rows.filter(row=>row.farmId===farm.id&&!row.paid)),openAmount=round(openRows.reduce((total,row)=>total+row.net,0)),requests=cteRequests.filter(request=>request.farmId===farm.id),pendingCte=requests.filter(request=>request.status==='pending').length,receivedCte=requests.filter(request=>request.status==='issued').length,staffCount=teamMembers.filter(member=>member.party==='farm'&&memberFarmIds(member).includes(farm.id)&&member.active).length;
 const farmDocument=farm.cnpj&&String(farm.cnpj).replace(/\D/g,'').length===14?farm.cnpj:farm.cpf||farm.cnpj||'',documentType=String(farmDocument).replace(/\D/g,'').length===14?'CNPJ':'CPF',stateRegistration=formatStateRegistration(farm.stateRegistration);
 return `<article class="farm-profile-card"><div class="farm-profile-heading"><div><span class="farm-index">FAZENDA ${String(index+1).padStart(2,'0')}</span><h2>${e(farm.name)}</h2><p>${e(farm.legalName||'Dados do titular ainda não cadastrados')}${farmDocument?' · '+documentType+' '+e(formatPaymentDocument(farmDocument)):''}${stateRegistration?' · IE '+e(stateRegistration):''}</p>${inactive?'<span class="badge gray">Inativa</span>':''}</div><div class="farm-actions">${currentUser?.role==='admin'?`<button class="btn small" type="button" data-action="edit-farm" data-id="${e(farm.id)}">Editar cadastro</button><button class="btn small" type="button" data-action="${action}" data-id="${e(farm.id)}">${label}</button>`:''}</div></div><div class="farm-profile-summary"><span><strong>${truckCount}</strong> placas ativas</span><span><strong>${closings.length}</strong> faturas no histórico</span><span><strong>${money(openAmount)}</strong> em faturas a pagar</span><span><strong>${pendingCte}</strong> CT-e aguardando · <strong>${receivedCte}</strong> recebidos</span>${currentUser?.role==='admin'?`<span><strong>${staffCount}</strong> funcionário(s) ativo(s)`:''}</div><div class="farm-profile-links"><button class="btn small" type="button" data-action="farm-open-trucks" data-id="${e(farm.id)}">Ver placas</button><button class="btn small" type="button" data-action="farm-open-finance" data-id="${e(farm.id)}">Ver faturas</button><button class="btn small" type="button" data-action="farm-open-ctes" data-id="${e(farm.id)}">Ver CT-es</button>${currentUser?.role==='admin'?'<button class="btn small" type="button" data-action="farm-open-team">Equipe</button>':''}</div></article>`;
};
function farmForm(id='') {
 const saved=state.farms.find(farm=>farm.id===id),farm=saved||{id:uid(),name:''},farmDocument=farm.cnpj&&String(farm.cnpj).replace(/\D/g,'').length===14?farm.cnpj:farm.cpf||farm.cnpj||'',profile=(key,label,type='text',placeholder='',max=120,value=farm[key]||'')=>`<div class="field"><label for="farm-${key}">${label}</label><input id="farm-${key}" name="${key}" type="${type}" value="${e(key==='stateRegistration'?formatStateRegistrationInput(value):value)}" maxlength="${max}" placeholder="${placeholder}" ${key==='document'?'inputmode="numeric" autocomplete="off"':''}></div>`;
 openModal(saved?'Editar fazenda':'Cadastrar fazenda','Informe os dados desta unidade.',`<form id="farm-form" data-id="${e(farm.id)}">${errBox()}<div class="field"><label for="farm-name">Nome para identificar *</label><input id="farm-name" name="name" value="${e(farm.name)}" maxlength="80" placeholder="Ex.: Fazenda Santa Clara" required></div><div class="farm-profile-fields">${profile('legalName','Nome ou razão social do titular','text','Nome ou razão social')}${profile('document','CPF ou CNPJ do titular','text','CPF ou CNPJ',18,formatPaymentDocumentInput(farmDocument))}${profile('stateRegistration','Inscrição estadual','text','Inscrição estadual',30)}${profile('address','Endereço','text','Endereço da unidade',180)}${profile('contactName','Pessoa de contato','text','Nome do responsável',100)}${profile('contactPhone','Telefone de contato','tel','(00) 00000-0000',30,formatFarmPhoneInput(farm.contactPhone||''))}</div><div class="form-note">Os caminhões, faturas, funcionários e pedidos de CT-e serão vinculados a esta fazenda.</div><div class="form-actions"><button class="btn" type="button" data-action="close-modal">Cancelar</button><button class="btn primary" type="submit">Salvar fazenda</button></div></form>`,{wide:true});
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
 const context=uiContext();
  await remoteCommand(action==='remove'?'farm.remove':'farm.status',action==='remove'?{id}:{id,active:action==='reactivate'});assertUiContext(context);
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
const uiContext=()=>({generation:uiGeneration,session:cloud.sessionGeneration()});
const isCurrentUi=context=>context.generation===uiGeneration&&context.session===cloud.sessionGeneration();
function assertUiContext(context){if(!isCurrentUi(context))throw Object.assign(Error('A sessão ou o acesso mudou.'),{code:'UI_CONTEXT_CHANGED'});}
const accessScope=(user,company)=>JSON.stringify([user?.id,company?.id,user?.role,user?.party,user?.farmId,[...(user?.farmIds||[])].sort()]);
function resetPrivateState(){
  uiGeneration++;currentUser=null;currentCompany=null;state=initialState();serverRevision=0;portalRequests=[];
  teamMembers=[];teamSelectedFarmId='';farmEditSnapshots.clear();pendingBackup=null;
  portalPeriod='';portalFarm='';portalInvoice='';portalSearch='';selectedPaymentRequests.clear();
  cteDocuments=[];cteRequests=[];cteTrucks=[];cteFarms=[];billingInvoices=[];selectedBillingCteIds.clear();
  cteFarmFilter='';cteSearch='';ctePage=1;cteQueueSearch='';cteQueuePage=1;cteBillingSearch='';cteBillingPage=1;cteFarmRequestSearch='';cteFarmRequestPage=1;
  cteColumnFilters={};cteFilterFieldOpen='';cteFilterDraft=[];cteFilterOptions=[];cteFilterSearch='';cteFilterAnchor={top:0,left:0};
  cteLoading=false;cteSummaryLoaded=false;ctePreferences={visibleColumns:[],columnOrder:[]};ctePreferenceDraft=null;cteRequestForUpload='';cteBillingMonth='';farmCteTab='request';farmCteSelectedFarmId='';draggedCtePreference='';
  currentMonth=today().slice(0,7);currentHalf=Number(today().slice(8))<=15?1:2;farmFilter='';search='';closingSearch='';view='overview';
  saving=false;stale=false;loadError='';invoiceSplitAttempted=false;invoiceSplitInProgress=false;checkingUpdates=false;nextGroupCheck=0;nextCteCheck=0;
  modalStack=[];reportContext=null;reportInvoker=null;modal.close();reportDialog.close();modalContent.innerHTML='';
  for(const selector of ['#report-content','#report-preview','#account-label']){const element=document.querySelector(selector);if(element)element.textContent='';}
  clearTimeout(toastTimer);const toast=document.querySelector('#toast');toast.textContent='';toast.classList.remove('show');
  document.body.classList.remove('saving','report-open');updateCloudStatus();
}
async function remoteCommand(type,payload) {
 const context=uiContext();
  if(!currentUser)throw Error('Faça login antes de alterar os registros.');
  if(saving)throw Error('Aguarde o salvamento em andamento.');
  saving=true;document.body.classList.add('saving');
  try { const saved=await cloud.execute(type,payload,serverRevision);assertUiContext(context);adoptServerData(saved);stale=false; }
  catch(error){if(!isCurrentUi(context))throw error;if(error.status===409){stale=true;updateCloudStatus();}throw error;}
  finally {if(isCurrentUi(context)){saving=false;document.body.classList.remove('saving');}}
}
function adoptServerData(data) {
  if(currentUser&&data.user&&accessScope(currentUser,currentCompany)!==accessScope(data.user,data.company||currentCompany))resetPrivateState();
  if(data.user)currentUser=data.user;if(data.company)currentCompany=data.company;
  if(isCarrier()||isFarmEmployee()){state=initialState();portalRequests=data.requests||[];}else{state=applyFixedMonthlyRule(validateState(data.state));portalRequests=state.paymentRequests;}
  serverRevision=data.revision;loadError='';updateCloudStatus();
}
function currentFarmName(){
  if(!isFarmEmployee())return '';
  return currentUser?.farmName
   || cteFarms.find(farm=>farm.id===currentUser?.farmId)?.name
   || (currentUser?.farmIds?.length>1?'várias fazendas':'')
   || portalRequests.find(request=>!currentUser?.farmId||request.farmId===currentUser.farmId)?.farmName
    || 'Fazenda não identificada';
}
function updateCloudStatus() {
  const label=document.querySelector('#cloud-status');if(label)label.textContent=stale?'Há novas alterações. Atualize os dados.':saving?'Salvando no servidor…':'Dados salvos no banco online';
  const company=document.querySelector('#company-label');if(company)company.textContent=currentCompany?.name||'Rota Safra';
  const account=document.querySelector('#account-label');if(account)account.textContent=currentUser?(currentUser.email+' · '+(isCarrier()?'Transportadora':isFarmEmployee()?`Funcionário · ${currentFarmName()}`:'Grupo das fazendas')):'';
}
async function refreshServerData({automatic=false}={}) {
 const context=uiContext();
  if(saving)return false;
  const data=await cloud.load();assertUiContext(context);
  if(automatic&&(saving||modal.open||reportDialog.open)){stale=true;updateCloudStatus();return false;}
  adoptServerData(data);stale=false;
  if(!automatic){modal.close();reportDialog.close();}
  render();updateCloudStatus();return true;
}
function renderAccess() {
  document.body.classList.add('logged-out');
  const ready=inviteTicket&&inviteInfo;
  const environmentPicker=!ready?`<section class="environment-login-picker" aria-label="Escolher ambiente"><span>Acessar ambiente</span><div><a href="./" ${APP_ENVIRONMENT==='production'?'aria-current="page"':''}>Rota Safra Produção</a><a href="?ambiente=teste" data-test-environment-link ${APP_ENVIRONMENT==='test'?'aria-current="page"':''} hidden>Rota Safra Teste</a></div></section>`:'';
  const environmentNotice=APP_ENVIRONMENT==='test'?'<div class="environment-test-notice"><strong>AMBIENTE DE TESTE</strong><span>Os registros ficam em uma base separada e não alteram a produção.</span></div>':'';
  main.innerHTML=`<div class="login-page"><section class="auth-card"><div class="auth-brand"><img class="auth-logo" src="./assets/rota-safra/logo-principal.png" width="768" height="485" alt="Rota Safra"></div>${environmentPicker}${environmentNotice}<h1>${ready?inviteSignin?'Aceitar acesso':'Configurar seu acesso':'Entrar no sistema'}</h1><p>${ready?e(inviteInfo.companyName):'Acesse os registros da empresa, salvos no banco online.'}</p><form id="access-form" class="auth-form">${errBox()}${ready&&inviteInfo.firstAccess?'<div class="field"><label for="access-company">Nome da empresa</label><input id="access-company" name="companyName" maxlength="120" required autocomplete="organization"></div>':''}<div class="field"><label for="access-email">E-mail</label><input id="access-email" name="email" type="email" value="${e(ready?inviteInfo.email:'')}" ${ready&&inviteInfo.email?'readonly':''} required autocomplete="username"></div><div class="field"><label for="access-password">Senha</label><input id="access-password" name="password" type="password" required ${ready&&!inviteSignin?'minlength="6"':''} autocomplete="${ready&&!inviteSignin?'new-password':'current-password'}">${ready&&!inviteSignin?'<small>Use pelo menos 6 caracteres. A senha é definida aqui.</small>':''}</div><button class="btn primary" type="submit" ${inviteTicket&&!ready?'disabled':''}>${ready&&!inviteSignin?'Criar acesso':'Entrar'}</button>${ready?`<button type="button" class="btn ghost" data-action="auth-switch">${inviteSignin?'Criar uma nova conta':'Já tenho uma conta'}</button>`:''}</form>${inviteTicket&&!ready?'<p id="invite-message" class="auth-help">Conferindo o link de acesso…</p>':'<p class="auth-help">O administrador da empresa libera os usuários e seus perfis de acesso.</p>'}</section></div>`;
  const syncTestOption=()=>{const link=main.querySelector('[data-test-environment-link]'),email=main.querySelector('#access-email')?.value.trim().toLowerCase();if(link)link.hidden=email!==TEST_ACCESS_EMAIL;};
  const emailInput=main.querySelector('#access-email');emailInput?.addEventListener('input',syncTestOption);emailInput?.addEventListener('change',syncTestOption);syncTestOption();
}
const accessProfiles=[['group:operator','Grupo — cadastros, fechamentos e solicitações'],['carrier:operator','Transportadora — pagamentos com comprovante'],['farm:operator','Funcionário — solicitar e receber CT-e'],['farm-multi:operator','Funcionário — CT-e em várias fazendas'],['group:viewer','Grupo — somente consulta'],['carrier:viewer','Transportadora — somente consulta'],['farm:viewer','Funcionário — somente consulta de CT-e'],['group:admin','Administrador do grupo — equipe e configurações']];
const profileOptions=value=>accessProfiles.map(([key,label])=>opt(key,label,value)).join('');
const memberFarmIds=member=>member?.farm_ids?.length?member.farm_ids:member?.farm_id?[member.farm_id]:[];
const farmProfileValue=member=>`farm${member?.farm_ids?.length?'-multi':''}:${member?.role||'operator'}`;
function updateMemberFarmSummary(userId,farmIds,status='') {const summary=document.querySelector(`[data-member-summary][data-id="${CSS.escape(userId)}"]`);if(!summary)return;const names=(Array.isArray(farmIds)?farmIds:[farmIds]).map(id=>state.farms.find(farm=>farm.id===id)?.name||'Fazenda não encontrada');summary.textContent=`Funcionário · ${names.join(' · ')} · ${status}`;}
function teamMemberRow(member) {
  const party=member.party||'group',farmId=member.farm_id||'',farmIds=memberFarmIds(member),farmNames=farmIds.map(id=>state.farms.find(farm=>farm.id===id)?.name||'Fazenda não encontrada'),scope=party==='carrier'?'Transportadora':party==='farm'?'Funcionário · '+farmNames.join(' · '):'Grupo das fazendas',profileValue=party==='farm'?farmProfileValue(member):party+':'+member.role;
  return `<article class="team-member"><div class="team-member-info"><strong>${e(member.email||'E-mail não informado')}</strong><span class="secondary" ${party==='farm'?`data-member-summary data-id="${e(member.user_id)}"`:''}>${e(scope)}</span></div><span class="badge ${member.active?'green':'gray'}"><i></i>${member.active?'Ativo':'Inativo'}</span><div class="team-controls"><label class="sr-only" for="member-profile-${e(member.user_id)}">Perfil de ${e(member.email||'usuário')}</label><select id="member-profile-${e(member.user_id)}" aria-label="Acesso de ${e(member.email||'usuário')}" data-member-profile data-id="${e(member.user_id)}" data-active="${member.active}" data-farm="${e(farmId)}" data-farm-ids="${e(JSON.stringify(farmIds))}">${profileOptions(profileValue)}</select><label class="sr-only" for="member-farm-${e(member.user_id)}">Fazenda de ${e(member.email||'usuário')}</label><select id="member-farm-${e(member.user_id)}" aria-label="Fazenda de ${e(member.email||'usuário')}" data-member-farm data-id="${e(member.user_id)}" ${party==='farm'&&farmIds.length<2?'':'hidden'}>${opt('','Selecione a fazenda',farmId)}${farmOptions(farmId)}</select><label class="sr-only" for="member-farms-${e(member.user_id)}">Fazendas de ${e(member.email||'usuário')}</label><select id="member-farms-${e(member.user_id)}" aria-label="Fazendas de ${e(member.email||'usuário')}" data-member-farms data-id="${e(member.user_id)}" multiple size="${Math.min(Math.max(state.farms.length,2),5)}" ${party==='farm'&&farmIds.length>1?'':'hidden'}>${state.farms.map(farm=>`<option value="${e(farm.id)}" ${farmIds.includes(farm.id)?'selected':''}>${e(farm.name)}</option>`).join('')}</select><small class="team-multi-help" ${party==='farm'&&farmIds.length>1?'':'hidden'}>Use Ctrl para selecionar mais de uma fazenda.</small><button type="button" class="btn small ${member.active?'':'primary'}" data-action="member-status" data-id="${e(member.user_id)}" data-role="${e(member.role)}" data-party="${e(party)}" data-farm="${e(farmId)}" data-farm-ids="${e(JSON.stringify(farmIds))}" data-active="${member.active?'false':'true'}">${member.active?'Inativar':'Reativar'}</button></div></article>`;
}
function teamFarmWorkspace(farmId,employees,knownFarmIds) {
  const farm=state.farms.find(item=>item.id===farmId),members=farm?employees.filter(member=>memberFarmIds(member).includes(farm.id)):employees.filter(member=>memberFarmIds(member).some(id=>!knownFarmIds.has(id))||!memberFarmIds(member).length);
  const title=farm?.name||'Fazenda sem vínculo',emptyLabel=farm?'Nenhum funcionário com acesso a esta fazenda.':'Nenhum funcionário sem fazenda vinculada.';
  return `<section class="team-farm-section"><div class="team-section-heading"><div><h3>${e(title)}</h3><p>${members.length?`${members.filter(member=>member.active).length} ativo(s) · ${members.length} cadastrado(s)`:emptyLabel}</p></div><button class="btn small primary" type="button" data-action="team-invite-farm" data-farm-id="${e(farm?.id||'')}">Cadastrar usuário</button></div>${members.length?members.map(teamMemberRow).join(''):`<p class="team-empty">${e(emptyLabel)}</p>`}</section>`;
}
async function loadTeam() {
 const context=uiContext();
  if(currentUser?.role!=='admin'||isCarrier())return;const box=document.querySelector('#team-list');
  try {
    const data=await cloud.team();assertUiContext(context);teamMembers=data.members||[];
    const teamCount=document.querySelector('[data-team-count]');if(teamCount)teamCount.textContent=`${teamMembers.length} usuário(s)`;
    if(box){
      const general=teamMembers.filter(member=>member.party!=='farm');
      const employees=teamMembers.filter(member=>member.party==='farm');
      const knownFarmIds=new Set(state.farms.map(farm=>farm.id));
       const unassigned=employees.filter(member=>memberFarmIds(member).some(id=>!knownFarmIds.has(id))||!memberFarmIds(member).length);
      const hasUnassigned=unassigned.length>0,availableIds=[...state.farms.map(farm=>farm.id),...(hasUnassigned?['__unassigned__']:[])];
      if(!availableIds.includes(teamSelectedFarmId))teamSelectedFarmId=availableIds[0]||'';
       const tabs=state.farms.map(farm=>{const members=employees.filter(member=>memberFarmIds(member).includes(farm.id)),selected=teamSelectedFarmId===farm.id;return `<button class="team-farm-tab${selected?' selected':''}" type="button" aria-pressed="${selected}" data-action="team-farm-select" data-farm-id="${e(farm.id)}"><span>${e(farm.name)}</span><small>${members.filter(member=>member.active).length} ativo(s) · ${members.length} usuário(s)</small></button>`;}).join('')+(hasUnassigned?`<button class="team-farm-tab${teamSelectedFarmId==='__unassigned__'?' selected':''}" type="button" aria-pressed="${teamSelectedFarmId==='__unassigned__'}" data-action="team-farm-select" data-farm-id="__unassigned__"><span>Fazenda sem vínculo</span><small>${unassigned.filter(member=>member.active).length} ativo(s) · ${unassigned.length} usuário(s)</small></button>`:'');
      const farmPanel=teamSelectedFarmId?teamFarmWorkspace(teamSelectedFarmId==='__unassigned__'?'':teamSelectedFarmId,employees,knownFarmIds):'<p class="team-empty">Nenhuma fazenda cadastrada.</p>';
      box.innerHTML=`<div class="team-section"><div class="team-section-heading"><div><h3>Acessos gerais</h3><p>Administradores, equipe do grupo e transportadora.</p></div><span class="count-pill">${general.length}</span></div>${general.length?general.map(teamMemberRow).join(''):'<p class="team-empty">Nenhum acesso geral cadastrado.</p>'}</div><div class="team-section"><div class="team-section-heading"><div><h3>Funcionários por fazenda</h3><p>Selecione uma fazenda para ver, alterar ou cadastrar os usuários vinculados.</p></div><span class="count-pill">${employees.length}</span></div><div class="team-farm-tabs" role="group" aria-label="Selecionar fazenda">${tabs}</div><div id="team-farm-panel">${farmPanel}</div></div>`;
    }
    if(view==='farms')main.innerHTML=farmsView();
  }catch(error){if(!isCurrentUi(context))return;if(box)box.textContent=authErrorMessage(error);}
}
function teamSettings(){return currentUser?.role==='admin'&&!isCarrier()?`<section class="card team-access-card"><div class="card-header"><div><h2>Equipe e acessos</h2><p>Veja os usuários cadastrados, os perfis e as fazendas vinculadas a cada funcionário.</p></div><span class="badge gray" data-team-count>${teamMembers.length} usuário(s)</span></div><div class="form-content"><div class="form-note team-autosave-note">As alterações de perfil e fazenda são salvas automaticame…60891 tokens truncated…D/g,'').length;
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
  if(!['truck-monthly','truck-adjust-monthly','discount-amount'].includes(ev.target.id))return;
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
 const context=uiContext();
  if(!cloud.hasSession()){resetPrivateState();render();return;}
  document.body.classList.add('logged-out');
  main.innerHTML='<div class="login-page"><section class="auth-card"><div class="auth-brand"><img class="auth-logo" src="./assets/rota-safra/logo-principal.png" width="768" height="485" alt="Rota Safra"></div><h1>Restaurando acesso</h1><p>Conferindo sua sessão com o servidor…</p></section></div>';
  try{const data=await cloud.load();assertUiContext(context);adoptServerData(data);render();}
  catch(error){
    if(!isCurrentUi(context))return;
    if(error.status===400||error.status===401||error.status===403){cloud.forgetSession();return;}
    main.innerHTML=`<div class="login-page"><section class="auth-card"><div class="auth-brand"><img class="auth-logo" src="./assets/rota-safra/logo-principal.png" width="768" height="485" alt="Rota Safra"></div><h1>Não foi possível conectar</h1><p>${e(authErrorMessage(error))}</p><div class="actions" style="margin-top:20px"><button class="btn primary" data-action="restore-session">Tentar novamente</button><button class="btn" data-action="forget-session">Entrar novamente</button></div></section></div>`;
  }
}
cloud.onSessionInvalidated(reason=>{const wasLoggedIn=!!currentUser;resetPrivateState();if(reason!=='login'||wasLoggedIn)render();});
if(inviteTicket)render();else restoreSession();
if(inviteTicket){const context=uiContext();cloud.inspectInvite(inviteTicket).then(info=>{if(!isCurrentUi(context))return;inviteInfo=info;renderAccess();}).catch(error=>{if(!isCurrentUi(context))return;const message=document.querySelector('#invite-message');if(message)message.textContent=authErrorMessage(error);});}

async function checkForUpdates(force=false){
 const context=uiContext();
  if(!currentUser||saving||checkingUpdates||document.visibilityState==='hidden')return;
  if((view==='ctes'||view==='reconciliation'||view==='cte-requests'||view==='farm-billing'||view==='farms')&&!modal.open&&Date.now()>=nextCteCheck){nextCteCheck=Date.now()+30000;await loadCteData();if(!isCurrentUi(context))return;}
  if(!isCurrentUi(context)||!currentUser||isFarmEmployee())return;
  if(!force&&!isCarrier()&&Date.now()<nextGroupCheck)return;
  if(!isCarrier())nextGroupCheck=Date.now()+60000;
  const userId=currentUser.id;checkingUpdates=true;
  try{
    const next=await cloud.version();assertUiContext(context);
    if(!isCurrentUi(context)||!currentUser||currentUser.id!==userId||saving)return;
    if(stale||next.revision!==serverRevision||next.role&&next.role!==currentUser.role||next.party&&next.party!==currentUser.party){
      if(modal.open||reportDialog.open){stale=true;updateCloudStatus();}
      else{
        const knownRequests=new Set(portalRequests.map(request=>request.id));
        if(!await refreshServerData({automatic:true})||!isCurrentUi(context))return;
        if(isCarrier()){
          const added=portalRequests.filter(request=>request.status==='pending'&&!knownRequests.has(request.id)).length;
          if(added)notify(added===1?'Nova solicitação de pagamento recebida.':`${added} novas solicitações de pagamento recebidas.`);
        }
      }
    }
  }catch(error){
    if(!isCurrentUi(context))return;
    if(error.status===401||error.status===403){cloud.forgetSession();}
    else{stale=true;updateCloudStatus();}
  }finally{if(isCurrentUi(context))checkingUpdates=false;}
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
}async function showReceipt(id){
 const context=uiContext();const receipt=await cloud.receiptLink(id);assertUiContext(context);openModal('Documento anexado',receipt.name,`<div class="form-note">Arquivo privado. O link de acesso vale por um minuto.</div><div class="form-actions"><a class="btn primary" href="${e(receipt.signedUrl)}" target="_blank" rel="noopener noreferrer">Abrir documento</a><button class="btn" data-action="close-modal">Fechar</button></div>`);}





