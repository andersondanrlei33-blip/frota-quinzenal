import {MODES,BODY_TYPES,initialState,validateState,validateTruck,validateDiscount,draft,period,periodLabel,dateLabel,days,overlaps,round,money,today,uid,csv,amountLabel,parseAmount,dateRangeError,validDate,periodClosings,farmClosing,openFarmIds,periodRows,closingPreview,saveClosing,reopenClosing,discountLocked,shiftDate,previewTransfer,transferTruck,latestTruck,previewEndActivities,endActivities,applyFixedMonthlyRule,farmHasLinks,removeFarm,setFarmActive} from './engine.js?v=18';
import {createReport,reportMarkup} from './reports.js?v=18';

const KEY='frota-quinzenal-v2';
const LEGACY_KEY='frota-quinzenal-v1';
let state=initialState(), loadError='';
try { localStorage.removeItem(LEGACY_KEY);const raw=localStorage.getItem(KEY); if(raw) state=applyFixedMonthlyRule(validateState(JSON.parse(raw))); } catch { loadError='Não conseguimos ler os registros salvos. Importe um backup nas configurações antes de cadastrar novos dados.'; }
let currentMonth=today().slice(0,7), currentHalf=Number(today().slice(8))<=15?1:2, farmFilter='',search='',view='overview',toastTimer;
const main=document.querySelector('#main'),modal=document.querySelector('#modal'),modalContent=document.querySelector('#modal-content');
const e=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const opt=(v,label,selected)=>`<option value="${e(v)}" ${String(v)===String(selected)?'selected':''}>${e(label)}</option>`;
const farmOptions=(selected,activeOnly=false)=>state.farms.filter(f=>!activeOnly||f.active!==false||f.id===selected).map(f=>opt(f.id,f.name+(f.active===false?' (Inativa)':''),selected)).join('');
const farmField=(farm,index)=>{const saved=state.farms.find(f=>f.id===farm.id),inactive=saved?.active===false,action=inactive?'reactivate-farm':saved&&farmHasLinks(state,farm.id)?'inactivate-farm':'remove-farm',label=inactive?'Reativar':action==='inactivate-farm'?'Inativar':'Remover';return `<div class="farm-input-row"><span class="index">${String(index+1).padStart(2,'0')}</span><input aria-label="Nome da fazenda ${index+1}" name="${e(farm.id)}" data-farm-id="${e(farm.id)}" value="${e(farm.name)}" maxlength="80" required><div class="farm-actions">${inactive?'<span class="badge gray">Inativa</span>':''}<button class="btn small ${action==='remove-farm'?'danger':''}" type="button" data-action="${action}" data-id="${e(farm.id)}" aria-label="${label} ${e(farm.name)||'nova fazenda'}">${label}</button></div></div>`;};
function addFarmInput() {
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
function applyFarmAction(id,action) {
  const form=document.querySelector('#farms-form'),drafts=form?[...form.querySelectorAll('[data-farm-id]')].map(input=>({id:input.dataset.farmId,name:input.value})):[];
  mutate(s=>action==='remove'?removeFarm(s,id):setFarmActive(s,id,action==='reactivate'));
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
function mutate(fn) {
  if(loadError) throw Error('Importe um backup válido antes de alterar os registros.');
  const prior=structuredClone(state);
  try { fn(state);applyFixedMonthlyRule(state);state.updatedAt=new Date().toISOString();localStorage.setItem(KEY,JSON.stringify(state)); } catch(err) { state=prior;throw err; }
}
function download(data,type,name) {const u=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
function openModal(title,subtitle,body) {modalContent.innerHTML=`<div class="modal-head"><div><h2 id="modal-title">${e(title)}</h2><p>${e(subtitle)}</p></div><button class="close-modal" data-action="close-modal" aria-label="Fechar janela">×</button></div><div class="modal-body">${body}</div>`;if(!modal.open)modal.showModal();}
const errBox=()=>'<div class="form-error" role="alert"></div>';
function formError(form,message) {const box=form.querySelector('.form-error');if(box){box.textContent=message;box.classList.add('visible');box.scrollIntoView({block:'nearest'});}else notify(message);}
const paymentStatus=row=>row.paid?'Pago':row.closed?'Fechado':'Aberto';
function badge(row) {const status=paymentStatus(row),color=status==='Pago'?'green':status==='Fechado'?'amber':'gray';return `<span class="badge ${color}"><i></i>${status}</span>`;}
function head(title,subtitle,actions='',eyebrow='PAGAMENTOS QUINZENAIS') {return `<div class="page-head"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${subtitle}</p></div><div class="actions">${actions}</div></div>`;}
function periodBar(includeFarm=true) {const p=currentPeriod();return `<div class="period-bar"><div class="period-controls"><label for="period-month">Competência</label><input type="month" id="period-month" aria-label="Mês do fechamento" value="${e(currentMonth)}"><div class="segmented" aria-label="Selecionar quinzena"><button data-action="half" data-half="1" class="${currentHalf===1?'selected':''}" aria-pressed="${currentHalf===1}">1ª quinzena</button><button data-action="half" data-half="2" class="${currentHalf===2?'selected':''}" aria-pressed="${currentHalf===2}">2ª quinzena</button></div>${includeFarm?`<select id="farm-filter" aria-label="Filtrar por fazenda">${opt('','Todas as fazendas',farmFilter)}${farmOptions(farmFilter)}</select>`:''}</div><div class="period-caption">${e(periodLabel(p))}</div></div>`;}
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
  return `<div class="table-wrap"><table><thead><tr><th>CAMINHÃO / MOTORISTA</th><th>FAZENDA</th><th class="num">DIAS NO PERÍODO</th><th class="num">DESCONTOS</th><th class="num">VALOR LÍQUIDO</th><th>SITUAÇÃO</th><th></th></tr></thead><tbody>${list.map(r=>`<tr><td><span class="plate">${e(r.plate)}</span><span class="secondary">${e(r.driver)}</span></td><td>${e(r.farmName)}<span class="secondary">${e(r.carrier)}</span></td><td class="num">${r.eligibleDays}<span class="secondary">${dateLabel(r.start).slice(0,5)} a ${dateLabel(r.end).slice(0,5)}</span></td><td class="num discount-color">${r.discountDays?money(r.discount):'—'}<span class="secondary">${r.discountDays?r.discountDays+' dia(s)':'Sem desconto'}</span></td><td class="num value">${money(r.net)}<span class="secondary">${r.payableDays} dia(s) a pagar</span></td><td>${badge(r)}</td><td><button class="btn small ghost" data-action="detail" data-id="${e(r.truckId)}">Detalhes</button></td></tr>`).join('')}</tbody></table></div>`;
}
function overviewData(month=currentMonth,selectedFarm=farmFilter,now=today()) {
  const first=period(month,1),second=period(month,2),start=first.start,end=second.end,reference=now<start?start:now>end?end:now;
  const assignments=state.trucks.filter(t=>(!selectedFarm||t.farmId===selectedFarm)&&overlaps(t.start,t.end||'9999-12-31',start,end));
  const active=assignments.filter(t=>t.start<=reference&&(!t.end||t.end>=reference));
  const entries=assignments.filter(t=>!t.transferIn&&t.start>=start&&t.start<=end);
  const endings=assignments.filter(t=>!t.transferOut&&t.end&&t.end>=start&&t.end<=end);
  const transfers=assignments.filter(t=>t.transferOut&&t.transferOut.date>=start&&t.transferOut.date<=end);
  const monthlyRows=[...periodRows(state,first),...periodRows(state,second)].filter(r=>!selectedFarm||r.farmId===selectedFarm);
  const fleet=[...new Map(assignments.slice().sort((a,b)=>a.start.localeCompare(b.start)).map(t=>[t.plate,t])).values()];
  const types={Caçamba:0,Graneleiro:0,'A informar':0},axles={7:0,9:0,other:0};
  for(const t of fleet){types[BODY_TYPES.includes(t.bodyType)?t.bodyType:'A informar']++;axles[t.axles===7?7:t.axles===9?9:'other']++;}
  const events=[...entries.map(t=>({plate:t.plate,date:t.start,label:'Entrada',text:state.farms.find(f=>f.id===t.farmId)?.name||'Fazenda'})),...endings.map(t=>({plate:t.plate,date:t.end,label:'Encerramento',text:state.farms.find(f=>f.id===t.farmId)?.name||'Fazenda'})),...transfers.map(t=>({plate:t.plate,date:t.transferOut.date,label:'Transferência',text:(state.farms.find(f=>f.id===t.farmId)?.name||'Fazenda')+' para '+t.transferOut.toFarmName}))];
  events.sort((a,b)=>Number(a.date>now)-Number(b.date>now)||(a.date>now?a.date.localeCompare(b.date):b.date.localeCompare(a.date))||a.plate.localeCompare(b.plate));
  const paid=sum(monthlyRows.filter(r=>r.paid),'net'),waiting=sum(monthlyRows.filter(r=>r.closed&&!r.paid),'net'),open=sum(monthlyRows.filter(r=>!r.closed),'net');
  const farms=state.farms.filter(f=>(!selectedFarm||f.id===selectedFarm)&&(f.active!==false||assignments.some(t=>t.farmId===f.id)||monthlyRows.some(r=>r.farmId===f.id)||f.id===selectedFarm)).map(f=>({...f,activeTrucks:uniquePlates(active.filter(t=>t.farmId===f.id)),monthTrucks:uniquePlates(assignments.filter(t=>t.farmId===f.id))}));
  return {start,end,reference,referenceLabel:now<start?'Previstos no início do mês':now>end?'Ativos no fim do mês':'Em atividade hoje',monthTrucks:fleet.length,activeTrucks:uniquePlates(active),entries:entries.length,scheduledEntries:entries.filter(t=>t.start>now).length,endings:endings.length,scheduledEndings:endings.filter(t=>t.end>now).length,types,axles,events,farms,paid,waiting,open,total:sum(monthlyRows,'net'),discounts:sum(monthlyRows,'discount')};
}
function overview() {
  const d=overviewData(),eventList=d.events.slice(0,8);
  const recovery=loadError?`<div class="notice"><span>${e(loadError)}</span><a href="#settings">Recuperar registros</a></div>`:'';
  const metrics=[['Caminhões no mês',d.monthTrucks,'Placas com contrato no mês selecionado'],[d.referenceLabel,d.activeTrucks,'Situação em '+dateLabel(d.reference)],['Entradas no mês',d.entries,d.scheduledEntries?d.scheduledEntries+' entrada(s) agendada(s)':'Novos períodos de serviço'],['Encerramentos no mês',d.endings,d.scheduledEndings?d.scheduledEndings+' encerramento(s) agendado(s)':'Serviços concluídos no mês']];
  return head('Visão geral','O resumo da sua frota e dos pagamentos do mês.','<a class="btn" href="#trucks">Ver caminhões</a><button class="btn primary" data-action="new-truck">+ Cadastrar caminhão</button>','RESUMO DA FROTA')+
    `<div class="period-bar"><div class="period-controls"><label for="period-month">Competência</label><input type="month" id="period-month" aria-label="Mês da visão geral" value="${e(currentMonth)}"><select id="farm-filter" aria-label="Filtrar resumo por fazenda">${opt('','Todas as fazendas',farmFilter)}${farmOptions(farmFilter)}</select></div><div class="period-caption">Mês inteiro · ${dateLabel(d.start)} a ${dateLabel(d.end)}</div></div>${recovery}`+
    `<div class="metric-grid overview-metrics">${metrics.map(([label,value,note],index)=>`<div class="metric ${index===0?'featured':''}"><div class="metric-label">${index===0?'<span class="dot"></span>':''}${e(label)}</div><div class="metric-value">${value}</div><div class="metric-note">${e(note)}</div></div>`).join('')}</div>`+
    `<section class="card"><div class="card-header"><div><h2>Resumo financeiro do mês</h2><p>As duas quinzenas, incluindo prévias em aberto e fechamentos salvos.</p></div><a class="btn small" href="#closings">Ir para Fechamentos →</a></div><div class="overview-finance"><div class="overview-finance-total"><span>Valor líquido do mês</span><strong>${money(d.total)}</strong><small>Descontos do mês: ${money(d.discounts)}</small></div><div class="overview-finance-item"><span class="finance-dot paid"></span><span>Pago</span><strong>${money(d.paid)}</strong></div><div class="overview-finance-item"><span class="finance-dot waiting"></span><span>Fechado, aguardando pagamento</span><strong>${money(d.waiting)}</strong></div><div class="overview-finance-item"><span class="finance-dot open"></span><span>Em aberto</span><strong>${money(d.open)}</strong></div></div></section>`+
    `<div class="overview-columns"><section class="card"><div class="card-header"><div><h2>Caminhões por fazenda</h2><p>Situação em ${dateLabel(d.reference)} · ${d.activeTrucks} caminhão(ões) em atividade</p></div></div><div class="overview-farms">${d.farms.length?d.farms.map(f=>`<div class="overview-farm-row"><div class="overview-farm-label"><strong>${e(f.name)}${f.active===false?' <span class="badge gray">Inativa</span>':''}</strong><span>${f.activeTrucks} em atividade</span></div><div class="overview-bar" aria-hidden="true"><span style="width:${d.activeTrucks?Math.round(f.activeTrucks/d.activeTrucks*100):0}%"></span></div><p>${f.monthTrucks} placa(s) com passagem nesta fazenda no mês</p></div>`).join(''):'<div class="overview-no-events">Nenhuma fazenda nesta seleção.</div>'}</div></section><section class="card"><div class="card-header"><div><h2>Perfil dos caminhões</h2><p>Uma contagem por placa no mês selecionado.</p></div></div><div class="overview-profile">${Object.entries(d.types).map(([type,count])=>`<div class="overview-type"><span>${e(type)}</span><strong>${count}</strong></div>`).join('')}<div class="overview-axles"><strong>Quantidade de eixos</strong><div><span>7 eixos <b>${d.axles[7]}</b></span><span>9 eixos <b>${d.axles[9]}</b></span><span>Outros / a informar <b>${d.axles.other}</b></span></div></div></div></section></div>`+
    `<section class="card"><div class="card-header"><div><h2>Movimentações no mês <span class="count-pill">${d.events.length}</span></h2><p>Entradas, transferências e encerramentos${d.events.length>8?' · mostrando '+eventList.length+' de '+d.events.length:''}.</p></div><a class="btn small" href="#trucks">Ver cadastros</a></div>${eventList.length?`<div class="overview-events">${eventList.map(event=>`<div class="overview-event"><div class="overview-event-date">${dateLabel(event.date).slice(0,5)}</div><div><strong>${e(event.plate)}</strong><p>${e(event.text)}</p></div><span class="badge ${event.label==='Encerramento'?'gray':event.label==='Transferência'?'amber':'green'}">${event.label}${event.date>today()?' · agendado':''}</span></div>`).join('')}</div>`:`<div class="overview-no-events"><h3>${state.trucks.length?'Nenhuma movimentação neste mês':'Comece cadastrando sua frota'}</h3><p>${state.trucks.length?'Os caminhões que continuam trabalhando aparecem no resumo acima.':'Cadastre os caminhões ou use os exemplos para conhecer o controle.'}</p>${!state.trucks.length?'<button class="btn" data-action="demo">Testar com exemplos</button>':''}</div>`}</section>`;
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
  return head('Descontos','Registre faltas e oficina com as datas que serão descontadas.','<button class="btn primary" data-action="new-discount" '+(!state.trucks.length?'disabled':'')+'>+ Lançar desconto</button>','OCORRÊNCIAS DO PERÍODO')+periodBar()+`<section class="card"><div class="card-header"><div><h2>Ocorrências <span class="count-pill">${list.length}</span></h2><p>Somente os dias dentro do contrato e da quinzena entram no cálculo.</p></div></div>${list.length?`<div class="table-wrap"><table><thead><tr><th>CAMINHÃO</th><th>MOTIVO</th><th>PERÍODO</th><th class="num">DIAS NESTA QUINZENA</th><th>OBSERVAÇÃO</th><th>AÇÕES</th></tr></thead><tbody>${list.map(d=>{const t=state.trucks.find(t=>t.id===d.truckId),locked=discountLocked(d,state);return `<tr><td><span class="plate">${e(t?.plate)}</span><span class="secondary">${e(t?.driver)}</span></td><td><span class="badge amber">${e(d.reason)}</span></td><td>${dateLabel(d.start)} a ${dateLabel(d.end)}</td><td class="num">${days(d.start>p.start?d.start:p.start,d.end<p.end?d.end:p.end)}</td><td style="white-space:normal;max-width:260px">${e(d.note)||'—'}</td><td><div class="actions"><button class="btn small ghost" data-action="edit-discount" data-id="${e(d.id)}">Editar</button><button class="btn small danger" data-action="delete-discount" data-id="${e(d.id)}">Excluir</button></div>${locked?'<span class="badge gray" style="margin-top:7px">Período fechado</span>':''}</td></tr>`;}).join('')}</tbody></table></div>`:`<div class="empty"><div class="empty-icon">−</div><h3>Nenhum desconto nesta quinzena</h3><p>Se houver falta ou oficina, informe a placa e as datas. O valor é calculado automaticamente.</p><button class="btn" data-action="new-discount" ${!state.trucks.length?'disabled':''}>Lançar desconto</button></div>`}</section>`;
}
function closingsView() {
  const c=closing(),list=filteredRows(),p=currentPeriod(),groups=new Map();for(const r of list){if(!groups.has(r.carrier))groups.set(r.carrier,[]);groups.get(r.carrier).push(r);}
  return head('Fechamentos','Confira o demonstrativo, feche o período e registre os pagamentos.','<button class="btn" data-action="report" '+(!list.length?'disabled':'')+'>Relatório</button><button class="btn primary" data-action="'+(c?'show-closing':'close-period')+'" '+(!rows().length?'disabled':'')+'>'+(c?'Resumo do fechamento':selectedClosings().length?'Fechar pendências':'Fechar quinzena')+'</button>','CONFERÊNCIA E PAGAMENTO')+periodBar()+ruleNotice()+closingMetrics(list)+
    `<div class="notice ${c?'neutral':''}"><span>${c?`<strong>Quinzena fechada em ${dateLabel(c.closedDate)}.</strong> Os valores e a regra foram guardados neste fechamento.`:'<strong>Prévia em aberto.</strong> Cadastros e descontos atualizam os valores até você fechar a quinzena.'}</span>${selectedClosings().length?`<button data-action="reopen-period">Reabrir por fazenda</button>`:''}</div><section class="card"><div class="card-header"><div><h2>Demonstrativo por caminhão</h2><p>${e(ruleTitle())}</p></div><button class="btn small" data-action="export-csv" ${!list.length?'disabled':''}>Exportar CSV</button></div>${truckTable(list)}<div class="card-footer"><span>Bruto: ${money(sum(list,'gross'))} · Descontos: ${money(sum(list,'discount'))}</span><strong style="color:var(--ink)">Líquido: ${money(sum(list,'net'))}</strong></div></section>`+
    `<section class="card"><div class="card-header"><h2>Totais por transportador</h2><span class="badge gray">${groups.size} transportador(es)</span></div>${groups.size?`<div class="table-wrap"><table><thead><tr><th>TRANSPORTADOR</th><th class="num">CAMINHÕES</th><th class="num">TOTAL LÍQUIDO</th><th class="num">PAGO</th><th class="num">SALDO</th></tr></thead><tbody>${[...groups].map(([name,rr])=>`<tr><td>${e(name)}</td><td class="num">${uniquePlates(rr)}</td><td class="num value">${money(sum(rr,'net'))}</td><td class="num">${money(sum(rr.filter(r=>r.paid),'net'))}</td><td class="num value">${money(sum(rr.filter(r=>!r.paid),'net'))}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty"><p>Os transportadores aparecerão quando houver caminhões neste período.</p></div>'}</section>`+
    `<h2 style="margin:30px 0 15px">Histórico de quinzenas</h2>${state.closings.length?state.closings.slice().sort((a,b)=>b.period.key.localeCompare(a.period.key)).map(h=>`<section class="card history-card"><div><h3>${e(periodLabel(h.period))} </h3><p style="font-weight:600;color:var(--ink);margin-bottom:5px">${e(closingNames(h))}</p><p>Fechado em ${dateLabel(h.closedDate)} · ${h.rows.length} caminhão(ões) · ${e(historyRuleTitle(h))}</p><button class="btn small ghost" style="margin-top:10px" data-action="view-period" data-month="${e(h.period.month)}" data-half="${h.period.half}" data-farm="${h.farmIds.length===1?e(h.farmIds[0]):''}">Abrir quinzena →</button><button class="btn small" style="margin:10px 0 0 7px" data-action="report" data-id="${e(h.id)}" ${!h.rows.length?'disabled':''}>Relatório</button>${h.kind==='complement'&&!h.rows.some(r=>r.paid)?`<button class="btn small ghost" style="margin:10px 0 0 7px" data-action="reopen-batch" data-id="${e(h.id)}">Reabrir fechamento</button>`:''}</div><div class="history-total"><strong>${money(sum(h.rows,'net'))}</strong><span class="badge ${h.rows.some(r=>!r.paid&&r.net>0)?'amber':h.rows.some(r=>r.paid)?'green':'gray'}">${h.rows.some(r=>!r.paid&&r.net>0)?'Fechados, aguardando pagamento':h.rows.some(r=>r.paid)?'Pagos':'Fechados'}</span><span class="secondary">${h.rows.filter(r=>r.paid).length} de ${h.rows.length} pagamento(s) registrado(s)</span></div></section>`).join(''):'<section class="card empty"><p>Seus fechamentos salvos aparecerão aqui.</p></section>'}`;
}
function settingsView() {
  return head('Configurações','Consulte o cálculo, cadastre suas fazendas e cuide dos seus registros.','','AJUSTES DO CONTROLE')+`<div class="settings-grid"><section class="card"><div class="card-header"><div><h2>Regras de pagamento</h2><p>O pagamento é calculado com o valor mensal cadastrado por placa.</p></div></div><div class="form-content"><div class="field"><label>Cálculo do valor proporcional</label><div class="form-note"><strong>Mensal fixo: duas quinzenas de metade do valor</strong><br>Um mês completo de 28, 29, 30 ou 31 dias sempre soma o valor mensal cadastrado, antes dos descontos.</div><small>O valor mensal é sempre informado no cadastro de cada placa.</small></div><div class="form-note" id="mode-explanation">${ruleDescription(state.settings,currentPeriod())}</div><div class="form-note">Quinzenas fixas: 1 a 15 e 16 ao último dia do mês. Faltas e oficina descontam dias inteiros. O cálculo mantém a precisão da diária e arredonda o valor final para centavos.</div></div></section><section class="card"><div class="card-header"><h2>Backup dos registros</h2></div><div class="form-content"><p style="font-size:12px;line-height:1.8;margin-bottom:18px">Nesta versão de teste, os registros ficam neste navegador. Para levar seus dados a outro dispositivo ou guardá-los, exporte um backup.</p><div class="backup-actions"><button class="btn" data-action="backup">↓ Baixar backup completo</button><button class="btn" data-action="import-backup">↑ Restaurar backup</button><input type="file" id="backup-file" accept=".json,application/json" hidden></div><div class="form-note" style="margin-top:20px;margin-bottom:0">O backup inclui cadastros, descontos, regras e fechamentos. Restaurar substitui os registros deste navegador.</div><p class="secondary" style="margin-top:15px">${state.updatedAt?'Última gravação: '+e(new Date(state.updatedAt).toLocaleString('pt-BR',{timeZone:'America/Cuiaba'})):'Nenhum registro salvo ainda.'}</p></div></section><section class="card"><div class="card-header"><div><h2>Fazendas</h2><p>Adicione fazendas, remova as que não têm vínculos ou inative preservando o histórico.</p></div></div><form id="farms-form" class="form-content">${errBox()}<div id="farm-fields">${state.farms.map(farmField).join('')}</div><div class="actions" style="margin-top:15px"><button class="btn" type="button" data-action="add-farm">+ Adicionar fazenda</button><button class="btn primary" type="submit">Salvar fazendas</button></div></form></section><section class="card"><div class="card-header"><h2>Conheça o controle</h2></div><div class="form-content"><p style="font-size:12px;line-height:1.8;margin-bottom:18px">Você pode testar com três placas fictícias, valores mensais diferentes e dois descontos. Os exemplos usam o mês selecionado e ficam identificados no cadastro.</p><button class="btn" data-action="demo" ${state.trucks.length?'disabled':''}>Carregar dados de exemplo</button>${state.trucks.some(t=>t.sample)?'<button class="btn danger" style="margin:10px 0 0" data-action="remove-demo">Remover exemplos</button>':''}<div class="form-note" style="margin-top:18px;margin-bottom:0">Esta etapa controla o pagamento mensal dos caminhões. Produção, remuneração pelo CT-e ou nota fiscal e combustível serão acrescentados nas etapas seguintes.</div></div></section></div>`;
}
function render() {
  view=location.hash.replace('#','') || 'overview';if(!['overview','trucks','discounts','closings','settings'].includes(view))view='overview';
  const labels={overview:'Visão geral',trucks:'Caminhões',discounts:'Descontos',closings:'Fechamentos',settings:'Configurações'};
  document.querySelector('#breadcrumb-current').textContent=labels[view];document.querySelectorAll('[data-nav]').forEach(a=>{a.classList.toggle('active',a.dataset.nav===view);a.setAttribute('aria-current',a.dataset.nav===view?'page':'false');});
  main.innerHTML=({overview,trucks:trucksView,discounts:discountsView,closings:closingsView,settings:settingsView}[view])();
}
function truckForm(id) {
  const saved=state.trucks.find(t=>t.id===id),activeFarm=state.farms.find(f=>f.active!==false);
  if(!saved&&!activeFarm)throw Error('Cadastre ou reative uma fazenda antes de cadastrar o caminhão.');
  const t=saved||{plate:'',driver:'',carrier:'',farmId:activeFarm.id,bodyType:'',axles:null,monthly:null,start:today(),end:''};
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
    ${id?'<div class="form-note">Esta edição atualiza as prévias. Os valores e dados dos fechamentos já salvos permanecem preservados.</div>':''}
    <div class="form-actions"><button class="btn" type="button" data-action="close-modal">Cancelar</button><button class="btn primary" type="submit">Salvar caminhão</button></div></form>`);
  updateDateRange(document.querySelector('#truck-form'));
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
  const d=state.discounts.find(d=>d.id===id)||{truckId:truckId||state.trucks[0].id,start:today(),end:today(),reason:'Falta',note:''};
  openModal(id?'Editar desconto':'Lançar desconto','Registre os dias inteiros de falta ou oficina.',`<form id="discount-form" data-id="${e(id||'')}">${errBox()}<div class="field"><label for="discount-truck">Caminhão *</label><select id="discount-truck" name="truckId">${state.trucks.slice().sort((a,b)=>a.plate.localeCompare(b.plate)).map(t=>opt(t.id,t.plate+' · '+t.driver,d.truckId)).join('')}</select></div><div class="field"><label for="discount-reason">Motivo *</label><select id="discount-reason" name="reason">${['Falta','Oficina','Outro'].map(r=>opt(r,r,d.reason)).join('')}</select></div><div class="fields-two"><div class="field"><label for="discount-start">Primeiro dia *</label><input id="discount-start" name="start" type="date" value="${e(d.start)}" required></div><div class="field"><label for="discount-end">Último dia *</label><input id="discount-end" name="end" type="date" value="${e(d.end)}" required></div></div><div class="form-error range-error" role="alert"></div><div class="form-note" id="discount-length">${days(d.start,d.end)} dia(s) de desconto, incluindo o primeiro e o último dia.</div><div class="field"><label for="discount-note">Observação</label><textarea id="discount-note" name="note" maxlength="400" placeholder="Ex.: caminhão na oficina para manutenção">${e(d.note)}</textarea><small>Obrigatória quando o motivo for “Outro”.</small></div><div class="form-actions"><button class="btn" type="button" data-action="close-modal">Cancelar</button><button class="btn primary" type="submit">Salvar desconto</button></div></form>`);
  updateDateRange(document.querySelector('#discount-form'));
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
function applyDiscountReopen(id,operation) {
  const d=state.discounts.find(d=>d.id===id);if(!d)throw Error('O desconto selecionado não está mais disponível.');
  const plan=discountReopenPlan(d);
  if(plan.some(scope=>scope.rows.some(r=>r.paid)))throw Error('Há pagamento registrado neste fechamento. Revise o pagamento primeiro.');
  mutate(s=>{
    for(const scope of plan)reopenClosing(s,scope.period,scope.farmId,scope.closingId);
    if(operation==='delete')s.discounts=s.discounts.filter(x=>x.id!==id);
  });
  modal.close();render();
  if(operation==='edit'){discountForm(id);notify('A edição foi liberada. Confira e salve o desconto.');}
  else notify('Desconto excluído. Confira os valores e feche novamente as placas pendentes.');
}

function detail(id) {
  const r=rows().find(r=>r.truckId===id);if(!r)return;const c=rowClosing(id),settings=r.calculationSettings||c?.settings||state.settings;
  const rate=new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:4}).format(r.rate);
  openModal(r.plate,r.driver+' · '+r.farmName,`<div class="detail-grid"><div><small>Transportador</small><strong>${e(r.carrier)}</strong></div><div><small>Valor mensal</small><strong>${money(r.monthly)}</strong></div><div><small>Tipo de caminhão</small><strong>${e(r.bodyType)||'A informar'}</strong></div><div><small>Quantidade de eixos</small><strong>${r.axles?r.axles+' eixos':'A informar'}</strong></div><div><small>Período na fazenda</small><strong>${dateLabel(r.contractStart)} a ${r.contractEnd?dateLabel(r.contractEnd):'em aberto'}</strong></div><div><small>Período considerado</small><strong>${dateLabel(r.start)} a ${dateLabel(r.end)}</strong></div></div><div class="form-note">${e(MODES[settings.mode])}<br>Diária de cálculo: R$ ${rate}. O arredondamento é feito no valor final.${r.roundingAdjusted?' Os centavos foram distribuídos entre os períodos da placa para manter o total.':''}</div><div class="calculation"><div class="calc-row"><span>${r.eligibleDays} dia(s) no período</span><span>${money(r.gross)}</span></div><div class="calc-row discount-color"><span>${r.discountDays} dia(s) descontado(s)</span><span>− ${money(r.discount)}</span></div><div class="calc-row total"><span>${r.payableDays} dia(s) a pagar</span><span>${money(r.net)}</span></div></div><div class="event-list"><h3>Descontos considerados</h3>${r.events.length?r.events.map(d=>`<p><strong>${e(d.reason)}</strong> · ${d.count} dia(s) · ${dateLabel(d.start)} a ${dateLabel(d.end)}${d.note?'<br><span class="secondary">'+e(d.note)+'</span>':''}</p>`).join(''):'<p>Nenhum desconto neste período.</p>'}</div>${r.paid?`<div class="notice neutral" style="margin:20px 0 0"><span>Pago em ${dateLabel(r.paid.date)}${r.paid.note?' · '+e(r.paid.note):''}</span></div>`:''}${state.trucks.find(t=>t.id===id)?.serviceEnded?`<div class="notice neutral" style="margin-top:18px"><span>Encerramento registrado para <strong>${dateLabel(state.trucks.find(t=>t.id===id).serviceEnded.date)}</strong>.</span></div>`:''}<div class="form-actions"><button class="btn orange" data-action="end-activities" data-id="${e(id)}">${latestTruck(state,id).serviceEnded?'Revisar encerramento':'Encerrar atividades'}</button>${c?(r.paid?`<button class="btn danger" data-action="undo-payment" data-id="${e(id)}">Desfazer registro de pagamento</button>`:r.net>0?`<button class="btn primary" data-action="pay" data-id="${e(id)}">Registrar pagamento</button>`:'<span class="badge gray">Sem valor a pagar</span>'):`<button class="btn" data-action="new-discount" data-id="${e(id)}">Lançar desconto</button>`}<button class="btn" data-action="close-modal">Fechar</button></div>`);
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
  const selected=periodClosings(state,currentPeriod()).flatMap(c=>c.rows).filter(r=>!field.value||r.farmId===field.value),paid=selected.some(r=>r.paid);
  box.innerHTML=`<div class="form-note ${paid?'warn':''}">${paid?'Há pagamentos registrados nesta seleção. Desfaça esses registros antes de reabrir.':'A seleção será recalculada com os cadastros, descontos e regras atuais. Os fechamentos das outras fazendas serão preservados.'}</div>`;
  modal.querySelector('[data-action="confirm-reopen"]').disabled=paid;
}
function closingSummary() {
  const cs=selectedClosings();if(!cs.length)return;
  const list=cs.flatMap(c=>c.rows).filter(r=>!farmFilter||r.farmId===farmFilter);
  const names=[...new Set(cs.flatMap(c=>c.farmIds))].filter(id=>!farmFilter||id===farmFilter).map(id=>state.farms.find(f=>f.id===id)?.name);
  openModal('Resumo dos fechamentos',periodLabel(currentPeriod()),`<div class="form-note"><strong>Fazendas fechadas:</strong> ${names.map(e).join(', ')}.</div><div class="detail-grid"><div><small>Fechamento(s) salvo(s)</small><strong>${cs.length}</strong></div><div><small>Pagamentos registrados</small><strong>${list.filter(r=>r.paid).length} de ${list.filter(r=>r.net>0).length}</strong></div></div><div class="calculation"><div class="calc-row"><span>Total líquido fechado</span><strong>${money(sum(list,'net'))}</strong></div><div class="calc-row"><span>Já pago</span><strong>${money(sum(list.filter(r=>r.paid),'net'))}</strong></div><div class="calc-row total"><span>Saldo a pagar</span><span>${money(sum(list.filter(r=>!r.paid),'net'))}</span></div></div><div class="form-actions"><button class="btn" data-action="close-modal">Fechar</button><button class="btn primary" data-action="go-closings">Ver demonstrativo</button></div>`);
}
function paymentForm(id) {
  const r=rowClosing(id)?.rows.find(r=>r.truckId===id);if(!r)return;modal.close();openModal('Registrar pagamento',r.plate+' · '+r.carrier,`<form id="payment-form" data-id="${e(id)}">${errBox()}<div class="form-note">Valor do fechamento: <strong>${money(r.net)}</strong>. O registro confirma o pagamento integral deste caminhão nesta quinzena.</div><div class="field"><label for="paid-date">Data do pagamento *</label><input id="paid-date" name="date" type="date" value="${today()}" max="${today()}" required></div><div class="field"><label for="paid-note">Referência / observação</label><input id="paid-note" name="note" maxlength="200" placeholder="Ex.: referência do comprovante"></div><div class="form-actions"><button class="btn" type="button" data-action="close-modal">Cancelar</button><button class="btn primary" type="submit">Confirmar pagamento</button></div></form>`);
}
function confirmation(title,text,action,id='') {if(modal.open)modal.close();openModal(title,'Confira antes de continuar.',`<p style="font-size:13px;line-height:1.8;color:var(--ink)">${e(text)}</p><div class="form-actions"><button class="btn" data-action="close-modal">Cancelar</button><button class="btn danger" data-action="${e(action)}" data-id="${e(id)}">Confirmar</button></div>`);}
function addDemo() {
  if(state.trucks.length){notify('Os exemplos só podem ser carregados com o cadastro vazio.');return;}
  const availableFarms=state.farms.filter(farm=>farm.active!==false);
  if(!availableFarms.length)throw Error('Cadastre ou reative uma fazenda para carregar os exemplos.');
  const a=uid(),b=uid(),c=uid(),m=currentMonth;
  mutate(s=>{s.trucks=[{id:a,plate:'TST1A01',driver:'Motorista de exemplo 1',carrier:'Transportadora de exemplo',farmId:availableFarms[0].id,bodyType:'Caçamba',axles:7,monthly:40000,start:m+'-01',end:'',sample:true},{id:b,plate:'TST2B02',driver:'Motorista de exemplo 2',carrier:'Transportadora de exemplo',farmId:availableFarms[0].id,bodyType:'Graneleiro',axles:9,monthly:35000,start:m+'-06',end:'',sample:true},{id:c,plate:'TST3C03',driver:'Motorista de exemplo 3',carrier:'Contratado de exemplo',farmId:(availableFarms[1]||availableFarms[0]).id,bodyType:'Caçamba',axles:9,monthly:42000,start:m+'-01',end:m+'-11',sample:true}];s.discounts=[{id:uid(),truckId:a,start:m+'-08',end:m+'-09',reason:'Falta',note:'Exemplo: dois dias de falta.'},{id:uid(),truckId:b,start:m+'-12',end:m+'-12',reason:'Oficina',note:'Exemplo: manutenção.'}];});currentHalf=1;render();notify('Exemplos fictícios carregados. Você pode editar e conferir os cálculos.');
}
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
document.addEventListener('click',ev=>{
  const b=ev.target.closest('[data-action]');if(!b||b.disabled)return;const a=b.dataset.action,id=b.dataset.id;
  try {
    if(a==='close-modal')modal.close();
    else if(a==='new-truck'){if(modal.open)modal.close();truckForm();}
    else if(a==='edit-truck')truckForm(id);
    else if(a==='add-farm')addFarmInput();
    else if(a==='remove-farm')requestFarmAction(id);
    else if(a==='inactivate-farm')requestFarmAction(id,true);
    else if(a==='confirm-remove-farm')applyFarmAction(id,'remove');
    else if(a==='confirm-inactivate-farm')applyFarmAction(id,'inactivate');
    else if(a==='reactivate-farm')applyFarmAction(id,'reactivate');
    else if(a==='transfer-truck')transferForm(id);
    else if(a==='end-activities'){if(modal.open)modal.close();endActivitiesForm(id);}
    else if(a==='truck-history')truckHistory(id);
    else if(a==='transfer-review-closing'||a==='end-review-closing'){const c=state.closings.find(x=>x.id===b.dataset.closing);if(!c)throw Error('Este fechamento não está disponível.');currentMonth=c.period.month;currentHalf=c.period.half;farmFilter=b.dataset.farm||'';modal.close();location.hash='closings';render();detail(id);}
    else if(a==='new-discount'){if(modal.open)modal.close();discountForm(null,id);}
    else if(a==='edit-discount')requestDiscountAction(id,'edit');
    else if(a==='half'){currentHalf=Number(b.dataset.half);render();}
    else if(a==='detail')detail(id);
    else if(a==='close-period')closePeriodModal();
    else if(a==='confirm-close'){const farm=document.querySelector('#closing-farm')?.value||'';mutate(s=>saveClosing(s,currentPeriod(),farm));modal.close();render();notify('Fechamento salvo somente para as placas pendentes.');}
    else if(a==='show-closing')closingSummary();
    else if(a==='go-closings'){modal.close();location.hash='closings';render();}
    else if(a==='reopen-period')reopenPeriodModal();
    else if(a==='confirm-reopen'){const farm=document.querySelector('#reopening-farm')?.value||'';mutate(s=>reopenClosing(s,currentPeriod(),farm));modal.close();render();notify('A seleção foi reaberta para ajustes.');}
    else if(a==='reopen-batch'){const batch=state.closings.find(c=>c.id===id);if(!batch||batch.kind!=='complement')throw Error('Selecione um fechamento complementar.');if(batch.rows.some(r=>r.paid))throw Error('Há pagamentos registrados neste complemento.');confirmation('Reabrir somente este complemento?',periodLabel(batch.period)+' · Os outros fechamentos e pagamentos serão preservados.','confirm-reopen-batch',id);}
    else if(a==='confirm-reopen-batch'){const batch=state.closings.find(c=>c.id===id);if(!batch||batch.kind!=='complement')throw Error('Confira o complemento selecionado.');mutate(s=>reopenClosing(s,batch.period,'',batch.id));currentMonth=batch.period.month;currentHalf=batch.period.half;modal.close();render();notify('Somente o complemento foi reaberto.');}
    else if(a==='pay')paymentForm(id);
    else if(a==='undo-payment')confirmation('Desfazer registro de pagamento?','O caminhão voltará a aparecer como “Fechado”. Isso altera somente o registro no controle.','confirm-undo-payment',id);
    else if(a==='confirm-undo-payment'){mutate(()=>rowClosing(id).rows.find(r=>r.truckId===id).paid=null);modal.close();render();notify('Registro desfeito. O valor voltou ao saldo a pagar.');}
    else if(a==='delete-discount')requestDiscountAction(id,'delete');
    else if(a==='confirm-discount-reopen-edit')applyDiscountReopen(id,'edit');
    else if(a==='confirm-discount-reopen-delete')applyDiscountReopen(id,'delete');
    else if(a==='review-discount-payment'||a==='view-history-payment'){const batch=state.closings.find(c=>c.id===b.dataset.closing);if(!batch)throw Error('O fechamento selecionado não está mais disponível.');currentMonth=batch.period.month;currentHalf=batch.period.half;farmFilter=b.dataset.farm||'';modal.close();location.hash='closings';render();detail(id);}
    else if(a==='confirm-delete-discount'){const d=state.discounts.find(d=>d.id===id);if(!d)return;if(discountLocked(d,state))throw Error('Reabra a quinzena antes de excluir este desconto.');mutate(s=>s.discounts=s.discounts.filter(x=>x.id!==id));modal.close();render();notify('Desconto excluído.');}
    else if(a==='view-period'){currentMonth=b.dataset.month;currentHalf=Number(b.dataset.half);farmFilter=b.dataset.farm||'';render();window.scrollTo({top:0,behavior:'smooth'});}
    else if(a==='export-csv')exportCsv();
    else if(a==='report'||a==='print')openReport(a==='report'?id||'':'',b);
    else if(a==='print-report')printReport();
    else if(a==='close-report')closeReport();
    else if(a==='demo')addDemo();
    else if(a==='remove-demo'){if(state.closings.some(c=>c.rows.some(r=>state.trucks.find(t=>t.id===r.truckId)?.sample)))throw Error('Reabra os fechamentos dos exemplos antes de removê-los.');confirmation('Remover dados de exemplo?','Somente as placas marcadas como exemplo e seus descontos serão removidos. Cadastros criados por você serão preservados.','confirm-remove-demo');}
    else if(a==='confirm-remove-demo'){const ids=state.trucks.filter(t=>t.sample).map(t=>t.id);if(state.closings.some(c=>c.rows.some(r=>ids.includes(r.truckId))))throw Error('Reabra os fechamentos dos exemplos primeiro.');mutate(s=>{s.trucks=s.trucks.filter(t=>!t.sample);s.discounts=s.discounts.filter(d=>!ids.includes(d.truckId));});modal.close();render();notify('Exemplos removidos.');}
    else if(a==='backup'){if(loadError)throw Error('Os registros precisam ser recuperados antes de exportar.');download(JSON.stringify(state,null,2),'application/json',`frota-backup-${today()}.json`);notify('Backup completo baixado.');}
    else if(a==='import-backup')document.querySelector('#backup-file').click();
    else if(a==='confirm-import'){if(!pendingBackup)return;localStorage.setItem(KEY,JSON.stringify(pendingBackup));state=pendingBackup;pendingBackup=null;loadError='';modal.close();farmFilter='';render();notify('Backup restaurado.');}
  }catch(err){notify(err.message||'Não foi possível salvar. Confira o armazenamento deste navegador.');}
});
document.addEventListener('submit',ev=>{
  const f=ev.target;if(!['truck-form','discount-form','payment-form','farms-form','transfer-form','end-activities-form'].includes(f.id))return;ev.preventDefault();const data=new FormData(f);
  try {
    if(f.id==='truck-form'){const id=f.dataset.id||uid(),prior=state.trucks.find(t=>t.id===id),t={id,plate:String(data.get('plate')).toUpperCase().replace(/[^A-Z0-9]/g,''),driver:String(data.get('driver')).trim(),carrier:String(data.get('carrier')).trim(),farmId:data.get('farmId')||prior?.farmId,bodyType:data.get('bodyType'),axles:Number(data.get('axles')==='other'?data.get('otherAxles'):data.get('axles')),monthly:parseAmount(data.get('monthly')),start:data.get('start'),end:data.get('end')||'',...(prior?.sample?{sample:true}:{}),...(prior?.transferIn?{transferIn:structuredClone(prior.transferIn)}:{}),...(prior?.transferOut?{transferOut:structuredClone(prior.transferOut)}:{}),...(prior?.serviceEnded?{serviceEnded:structuredClone(prior.serviceEnded)}:{})};validateTruck(t,state,true);mutate(s=>{const index=s.trucks.findIndex(x=>x.id===id);if(index<0)s.trucks.push(t);else s.trucks[index]=t;});modal.close();render();notify('Cadastro salvo.');}
    else if(f.id==='end-activities-form'){const date=String(data.get('date'));mutate(s=>endActivities(s,f.dataset.id,date,String(data.get('note')||'')));currentMonth=date.slice(0,7);currentHalf=Number(date.slice(8))<=15?1:2;farmFilter='';modal.close();location.hash='closings';render();notify('Atividades encerradas e quinzena desta placa fechada.');}
    else if(f.id==='transfer-form'){mutate(s=>transferTruck(s,f.dataset.id,String(data.get('toFarmId')),String(data.get('date')),String(data.get('note')||'')));farmFilter='';modal.close();render();notify('Transferência registrada. Confira os períodos e valores por fazenda.');}
    else if(f.id==='discount-form'){const d={id:f.dataset.id||uid(),truckId:data.get('truckId'),start:data.get('start'),end:data.get('end'),reason:data.get('reason'),note:String(data.get('note')).trim()};validateDiscount(d,state);mutate(s=>{const index=s.discounts.findIndex(x=>x.id===d.id);if(index<0)s.discounts.push(d);else s.discounts[index]=d;});modal.close();render();notify('Desconto salvo e prévia atualizada.');}
    else if(f.id==='payment-form'){const c=rowClosing(f.dataset.id),r=c?.rows.find(r=>r.truckId===f.dataset.id);if(!r||r.paid)throw Error('Confira a situação deste pagamento.');const date=data.get('date');if(!validDate(date)||date>today())throw Error('Informe uma data de pagamento válida, até hoje.');mutate(()=>{r.paid={date,note:String(data.get('note')).trim()};});modal.close();render();notify('Pagamento registrado.');}
    else if(f.id==='farms-form'){const farms=[...f.querySelectorAll('[data-farm-id]')].map(input=>({...state.farms.find(farm=>farm.id===input.dataset.farmId),id:input.dataset.farmId,name:input.value.trim()}));if(!farms.length||farms.some(farm=>!farm.name))throw Error('Preencha o nome de cada fazenda.');if(farms.some(farm=>farm.name.length>80))throw Error('Use até 80 caracteres para o nome da fazenda.');if(new Set(farms.map(farm=>farm.name.toLocaleLowerCase('pt-BR'))).size!==farms.length)throw Error('Use nomes diferentes para identificar cada fazenda.');mutate(s=>s.farms=farms);render();notify('Fazendas salvas.');}
  }catch(err){formError(f,err.message||'Não foi possível salvar. Confira o armazenamento deste navegador.');}
});
document.addEventListener('change',async ev=>{
  const el=ev.target;
  if(['report-month','report-half','report-farm','report-scope','report-plate'].includes(el.id)){updateReportPeriod();return;}
  if(el.id==='period-month'){if(/^\d{4}-\d{2}$/.test(el.value)){currentMonth=el.value;render();}}
  else if(el.id==='farm-filter'){farmFilter=el.value;render();}
  else if(['discount-start','discount-end','truck-start','truck-end'].includes(el.id))updateDateRange(el.form);
  else if(el.id==='truck-axles'){const other=el.value==='other',field=document.querySelector('#other-axles-field'),input=document.querySelector('#truck-other-axles');field.hidden=!other;input.required=other;if(!other)input.value='';}
  else if(el.id==='activity-end-date')updateActivityEndPreview();
  else if(el.id==='transfer-farm'||el.id==='transfer-date')updateTransferPreview();
  else if(el.id==='closing-farm')updateClosingPreview();
  else if(el.id==='reopening-farm')updateReopeningPreview();
  else if(el.id==='backup-file'&&el.files[0]){try{const file=el.files[0];if(file.size>10000000)throw Error('O arquivo é grande demais para este controle.');pendingBackup=applyFixedMonthlyRule(validateState(JSON.parse(await file.text())));confirmation('Restaurar este backup?',`O arquivo contém ${pendingBackup.trucks.length} caminhão(ões), ${pendingBackup.discounts.length} desconto(s) e ${pendingBackup.closings.length} fechamento(s). Os registros atuais deste navegador serão substituídos. Baixe um backup dos registros atuais antes de continuar, se precisar preservá-los.`,'confirm-import');}catch(err){pendingBackup=null;notify(err.message||'Não foi possível ler o backup.');}el.value='';}
});
document.addEventListener('input',ev=>{if(ev.target.id==='truck-search'){search=ev.target.value;const pos=ev.target.selectionStart;render();const el=document.querySelector('#truck-search');el.focus();el.setSelectionRange(pos,pos);}});
modal.addEventListener('click',ev=>{if(ev.target===modal){const r=modal.getBoundingClientRect();if(ev.clientX<r.left||ev.clientX>r.right||ev.clientY<r.top||ev.clientY>r.bottom)modal.close();}});

function updateDateRange(form) {
  if(!form||!['truck-form','discount-form'].includes(form.id))return;
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
  if(['discount-start','discount-end','truck-start','truck-end'].includes(ev.target.id))updateDateRange(ev.target.form);
  if(ev.target.id==='truck-monthly')ev.target.setCustomValidity('');
  if(ev.target.id==='transfer-date')updateTransferPreview();
  if(ev.target.id==='activity-end-date')updateActivityEndPreview();
});
document.addEventListener('focusout',ev=>{
  if(ev.target.id!=='truck-monthly')return;
  const n=parseAmount(ev.target.value);
  if(Number.isFinite(n)&&n>0){ev.target.value=amountLabel(n);ev.target.setCustomValidity('');}
  else if(ev.target.value.trim())ev.target.setCustomValidity('Informe um valor válido. Exemplo: 40.000,00.');
});

window.addEventListener('hashchange',()=>{render();window.scrollTo(0,0);});
render();
