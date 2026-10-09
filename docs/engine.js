export const SCHEMA = 2;
export const BODY_TYPES = ['Caçamba','Graneleiro'];
export const PAYMENT_METHODS = {pix:'Pix',bank:'Transferência bancária'};
const paymentFields={method:20,holder:100,document:25,pixKey:120,bankName:100,agency:20,account:30,accountType:20};
export function normalizePaymentDetails(input) {
  if(input==null)return null;
  if(typeof input!=='object'||Array.isArray(input))throw Error('Confira os dados de pagamento.');
  const details={};
  for(const [field,max] of Object.entries(paymentFields)){
    if(input[field]!=null&&typeof input[field]!=='string')throw Error('Confira os dados de pagamento.');
    details[field]=String(input[field]||'').trim();
    if(details[field].length>max)throw Error('Um campo dos dados de pagamento está muito longo.');
  }
  if(!details.method)return null;
  if(!['pix','bank'].includes(details.method))throw Error('Selecione Pix ou transferência bancária.');
  if(details.document&&!/^[\d.\-/\s]+$/.test(details.document))throw Error('Confira o CPF ou CNPJ do titular.');
  if(details.accountType&&!['corrente','poupanca','pagamento'].includes(details.accountType))throw Error('Selecione um tipo de conta válido.');
  if(details.method==='pix'){details.bankName='';details.agency='';details.account='';details.accountType='';}
  else details.pixKey='';
  return details;
}
export function paymentDetailsMissing(input) {
  const d=normalizePaymentDetails(input);
  if(!d)return ['forma de pagamento'];
  const missing=[];
  if(!d.holder)missing.push('nome do titular');
  if(![11,14].includes(d.document.replace(/\D/g,'').length))missing.push('CPF ou CNPJ do titular');
  if(d.method==='pix'&&!d.pixKey)missing.push('chave Pix');
  if(d.method==='bank'){
    if(!d.bankName)missing.push('banco');
    if(!d.agency)missing.push('agência');
    if(!d.account)missing.push('conta com dígito');
    if(!d.accountType)missing.push('tipo de conta');
  }
  return missing;
}
export function validatePaymentDetails(input,required=false) {
  const details=normalizePaymentDetails(input);
  if(required&&paymentDetailsMissing(details).length)throw Error('Complete os dados de pagamento: '+paymentDetailsMissing(details).join(', ')+'.');
  return details;
}
export const MODES = {
  daily30: 'Histórico: diária mensal ÷ 30',
  half: 'Mensal fixo: metade por quinzena completa',
  calendar: 'Diária pelos dias reais do mês',
};
export const money = n => new Intl.NumberFormat('pt-BR', {style:'currency', currency:'BRL'}).format(n || 0);
export const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
export const amountLabel = n => Number.isFinite(n) ? new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n) : '';
export function parseAmount(value) {
  if(typeof value==='number') return Number.isFinite(value)?round(value):NaN;
  const s=String(value??'').trim().replace(/^R\$\s*/,'').replace(/\s/g,'');
  if(/^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/.test(s))return round(Number(s.replaceAll('.','').replace(',','.')));
  if(/^\d+\.\d{1,2}$/.test(s))return round(Number(s));
  return NaN;
}
export function dateRangeError(start,end,requiredEnd=true) {
  if(!start || (requiredEnd && !end))return '';
  if(!validDate(start) || (end && !validDate(end)))return 'Informe datas válidas.';
  return end && end<start?'A data final não pode ser anterior à inicial.':'';
}
export function today() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en', {timeZone:'America/Cuiaba',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export const uid = () => crypto.randomUUID();
export function validDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s+'T12:00:00Z');
  return !Number.isNaN(+d) && d.toISOString().slice(0,10) === s;
}
export function shiftDate(s,n) {
  if(!validDate(s))throw Error('Informe uma data válida.');
  return new Date(Date.parse(s+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
}
export function days(a,b) { return Math.max(0, Math.round((new Date(b+'T12:00:00Z')-new Date(a+'T12:00:00Z'))/86400000)+1); }
export function dateList(a,b) {
  if (!validDate(a) || !validDate(b) || a > b) return [];
  const arr=[];
  for (let n=Date.parse(a+'T12:00:00Z'), end=Date.parse(b+'T12:00:00Z'); n<=end; n+=86400000) arr.push(new Date(n).toISOString().slice(0,10));
  return arr;
}
export function period(month,half) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || ![1,2].includes(Number(half))) throw Error('Selecione um mês e uma quinzena válidos.');
  const [y,m]=month.split('-').map(Number), last=new Date(Date.UTC(y,m,0)).getUTCDate();
  return {key:`${month}-${half}`,month,half:Number(half),start:`${month}-${half==1?'01':'16'}`,end:`${month}-${half==1?'15':last}`,monthDays:last};
}
export const dateLabel = s => validDate(s) ? s.split('-').reverse().join('/') : '—';
export const periodLabel = p => `${dateLabel(p.start)} a ${dateLabel(p.end)}`;
export function initialState() {
  return {schema:SCHEMA, farms:[{id:'farm1',name:'Fazenda 1'},{id:'farm2',name:'Fazenda 2'},{id:'farm3',name:'Fazenda 3'},{id:'farm4',name:'Fazenda 4'}],trucks:[],discounts:[],closings:[],invoiceReopens:[],paymentRequests:[],fundingTransfers:[],settings:{mode:'half',fixedMonthlyVersion:1,includeStart:true,includeEnd:true,confirmed:true},updatedAt:null};
}
export function farmHasLinks(state,id) {
  return !!state.paymentRequests?.some(r=>r.snapshot.farmId===id)||state.fundingTransfers?.some(r=>r.farmId===id)||state.trucks.some(t=>t.farmId===id||t.transferIn?.fromFarmId===id||t.transferOut?.toFarmId===id||t.serviceEnded?.revisions?.some(revision=>revision.row?.farmId===id))||state.closings.some(c=>c.farmIds?.includes(id)||c.rows.some(r=>r.farmId===id)||c.calculationRevisions?.some(revision=>revision.previousRows?.some(r=>r.farmId===id)));
}
export function removeFarm(state,id) {
  if(!state.farms.some(f=>f.id===id))throw Error('Esta fazenda não está cadastrada.');
  if(farmHasLinks(state,id))throw Error('Esta fazenda tem registros vinculados. Use Inativar para preservar o histórico.');
  if(state.farms.length===1)throw Error('Cadastre outra fazenda antes de remover a última.');
  state.farms=state.farms.filter(f=>f.id!==id);
}
export function setFarmActive(state,id,active) {
  const farm=state.farms.find(f=>f.id===id);if(!farm)throw Error('Esta fazenda não está cadastrada.');
  if(typeof active!=='boolean')throw Error('Informe uma situação válida para a fazenda.');
  farm.active=active;
}
export function eligibleRange(truck,p,settings) {
  let start=truck.start, end=truck.end || p.end;
  if (!settings.includeStart && !truck.transferIn) start = shiftDate(start,1);
  if (truck.end && !settings.includeEnd && !truck.transferOut) end = shiftDate(end,-1);
  start = start > p.start ? start : p.start;
  end = end < p.end ? end : p.end;
  return {start,end,count:days(start,end)};
}
export const isAmountDiscount=d=>d?.kind==='amount';
export const amountDiscountTotal=row=>round((row.events||[]).filter(isAmountDiscount).reduce((total,event)=>total+event.amount,0));
export function calculate(truck,p,settings,discounts,farms=[],allowOverLimit=false) {
  const r=eligibleRange(truck,p,settings);
  const dates=new Set(dateList(r.start,r.end));
  const events=discounts.filter(d=>d.truckId===truck.id && d.start<=r.end && d.end>=r.start);
  const deducted=new Set();
  for (const e of events.filter(e=>!isAmountDiscount(e))) for (const d of dateList(e.start,e.end)) if (dates.has(d)) deducted.add(d);
  const periodDays=days(p.start,p.end);
  const mode=settings.fixedMonthlyVersion?'half':settings.mode;
  const rate=settings.fixedMonthlyVersion?fixedPeriodAmount(truck.monthly,p)/periodDays:truck.monthly/(mode==='half'?2*periodDays:mode==='calendar'?p.monthDays:30);
  const payableDays=Math.max(0,r.count-deducted.size);
  const amount=round(events.filter(isAmountDiscount).reduce((total,event)=>total+event.amount,0)),gross=round(rate*r.count),beforeAmount=round(rate*payableDays);
  if(amount>beforeAmount&&!allowOverLimit)throw Error('Os descontos por valor excedem o saldo desta placa na quinzena. Confira o valor e os descontos por dias.');
  const net=round(Math.max(0,beforeAmount-amount)),discount=round(gross-net);
  return {truckId:truck.id,plate:truck.plate,driver:truck.driver,carrier:truck.carrier,bodyType:truck.bodyType||'',axles:truck.axles??null,farmId:truck.farmId,farmName:farms.find(f=>f.id===truck.farmId)?.name || 'Fazenda não encontrada',monthly:truck.monthly,contractStart:truck.start,contractEnd:truck.end || '',start:r.count?r.start:'',end:r.count?r.end:'',eligibleDays:r.count,discountDays:deducted.size,payableDays,rate,gross,discount,net,events:events.map(e=>({...e,count:isAmountDiscount(e)?0:dateList(e.start,e.end).filter(d=>dates.has(d)).length})).filter(e=>isAmountDiscount(e)||e.count),paid:null};
}
export function draft(state,p) {
  const booked=new Map(periodClosings(state,p).flatMap(c=>c.rows.map(r=>[r.truckId,r]))),groups=new Map();
  const rows=state.trucks.map(t=>calculate(t,p,state.settings,state.discounts,state.farms,booked.has(t.id))).filter(r=>r.eligibleDays>0);
  for(const row of rows){if(!groups.has(row.plate))groups.set(row.plate,[]);groups.get(row.plate).push(row);}
  for(const group of groups.values()){
    if(group.length<2)continue;
    const pending=group.filter(r=>!booked.has(r.truckId)).sort((a,b)=>a.start.localeCompare(b.start));
    if(!pending.length)continue;
    const gross=Math.round(round(group.reduce((n,r)=>{const source=booked.get(r.truckId)||r;return n+source.rate*source.eligibleDays;},0))*100);
    const net=Math.round(round(group.reduce((n,r)=>{const source=booked.get(r.truckId)||r;return n+source.rate*source.payableDays;},0))*100)-group.reduce((n,r)=>n+Math.round(amountDiscountTotal(booked.get(r.truckId)||r)*100),0);
    const currentNet=group.reduce((n,r)=>n+Math.round((booked.get(r.truckId)||r).net*100),0);
    const currentDiscount=group.reduce((n,r)=>n+Math.round((booked.get(r.truckId)||r).discount*100),0);
    const adjust=(key,delta,candidates)=>{
      for(const r of [...candidates].reverse()){
        if(!delta)break;
        const old=Math.round(r[key]*100),change=delta>0?delta:Math.max(delta,-old);
        r[key]=(old+change)/100;if(change)r.roundingAdjusted=true;delta-=change;
      }
      if(delta)throw Error('Não foi possível conciliar o arredondamento desta placa.');
    };
    adjust('net',net-currentNet,pending.filter(r=>r.payableDays>0));
    adjust('discount',gross-net-currentDiscount,pending.filter(r=>r.discountDays>0||amountDiscountTotal(r)>0));
    pending.forEach(r=>r.gross=round(r.net+r.discount));
  }
  return rows.sort((a,b)=>a.farmName.localeCompare(b.farmName,'pt-BR') || a.plate.localeCompare(b.plate));
}
export function overlaps(a,b,c,d) { return a<=d && c<=b; }
export function periodClosings(state,p) {return state.closings.filter(c=>c.period.key===p.key);}
export function farmClosing(state,p,farmId) {return periodClosings(state,p).find(c=>(c.farmIds||state.farms.map(f=>f.id)).includes(farmId));}
const invoiceReopenKey=(periodKey,farmId)=>`${periodKey}|${farmId}`;
export function invoiceReopened(state,p,farmId) {return (state.invoiceReopens||[]).includes(invoiceReopenKey(p.key,farmId));}
export function pendingRows(state,p) {
  const closedTrucks=new Set(periodClosings(state,p).flatMap(c=>c.rows.map(r=>r.truckId)));
  return draft(state,p).filter(r=>!closedTrucks.has(r.truckId));
}
export function openFarmIds(state,p) {
  const pendingFarms=new Set(pendingRows(state,p).map(r=>r.farmId));
  return state.farms.filter(f=>(f.active!==false||pendingFarms.has(f.id))&&(!farmClosing(state,p,f.id)||pendingFarms.has(f.id))).map(f=>f.id);
}
export function periodRows(state,p) {
  const saved=periodClosings(state,p);
  return [...saved.flatMap(c=>c.rows.map(r=>({...r,closed:true,closingId:c.id,closedDate:c.closedDate}))),...pendingRows(state,p).map(r=>({...r,closed:false,closingId:'',complementary:!!farmClosing(state,p,r.farmId)}))].sort((a,b)=>a.farmName.localeCompare(b.farmName,'pt-BR')||a.plate.localeCompare(b.plate));
}
export function closingPreview(state,p,farmId='') {
  const farmIds=farmId?[farmId]:openFarmIds(state,p);
  if(!farmIds.length)throw Error('Todas as fazendas já estão fechadas nesta quinzena.');
  const pending=pendingRows(state,p);
  for(const id of farmIds){const farm=state.farms.find(f=>f.id===id);if(!farm)throw Error('Selecione uma fazenda válida.');if(farm.active===false&&!pending.some(r=>r.farmId===id))throw Error('Esta fazenda está inativa e não tem caminhões pendentes nesta quinzena.');if(farmClosing(state,p,id)&&!pending.some(r=>r.farmId===id))throw Error('Esta fazenda já está fechada e não tem novas placas pendentes nesta quinzena.');if(farmClosing(state,p,id)&&pending.some(r=>r.farmId===id)&&!invoiceReopened(state,p,id))throw Error('Reabra a quinzena para emitir uma nova fatura antes de fechar estas placas.');}
  const rows=pending.filter(r=>farmIds.includes(r.farmId));
  if(!rows.length&&!draft(state,p).length&&!periodClosings(state,p).length)throw Error('Não há caminhões no período para as fazendas selecionadas.');
  return {farmIds,rows,complementFarmIds:farmIds.filter(id=>!!farmClosing(state,p,id))};
}
export function saveClosing(state,p,farmId='',id=uid(),closedDate=today()) {
  if(!state.settings.confirmed)throw Error('Defina a regra de cálculo primeiro.');
  const preview=closingPreview(state,p,farmId);
  const c={id,period:{...p},farmIds:[...preview.farmIds],kind:preview.complementFarmIds.length?'complement':'initial',settings:structuredClone(state.settings),closedDate,rows:structuredClone(preview.rows)};
  state.closings.push(c);state.invoiceReopens=(state.invoiceReopens||[]).filter(key=>!preview.farmIds.some(farmId=>key===invoiceReopenKey(p.key,farmId)));return c;
}
export function reopenForInvoice(state,p,farmId='') {
  const pendingFarms=new Set(pendingRows(state,p).map(row=>row.farmId));
  const farmIds=[...new Set(periodClosings(state,p).flatMap(c=>c.farmIds).filter(id=>(!farmId||id===farmId)&&pendingFarms.has(id)))];
  if(!farmIds.length)throw Error(farmId?'Cadastre primeiro uma nova placa pendente nesta fazenda para emitir outra fatura.':'Não há novas placas pendentes nas fazendas fechadas desta quinzena.');
  state.invoiceReopens=[...new Set([...(state.invoiceReopens||[]),...farmIds.map(id=>invoiceReopenKey(p.key,id))])];
  return farmIds;
}
export function reopenClosing(state,p,farmId='',closingId='') {
  const matching=periodClosings(state,p).filter(c=>(!farmId||c.farmIds.includes(farmId))&&(!closingId||c.id===closingId));
  if(!matching.length)throw Error('Não há fechamento salvo para esta seleção.');
  if(state.fundingTransfers?.some(t=>t.period.key===p.key&&t.status!=='cancelled'&&matching.some(c=>c.rows.some(r=>r.farmId===t.farmId&&(!farmId||farmId===t.farmId)))))throw Error('Cancele a solicitação de recibo desta fazenda antes de reabrir a quinzena. Transferências já efetuadas não podem ser reabertas.');
  const affected=matching.flatMap(c=>c.rows.filter(r=>!farmId||r.farmId===farmId));
  if(affected.some(r=>r.paid))throw Error('Há pagamentos registrados nessa seleção. Desfaça esses registros antes de reabrir.');
  if(affected.some(r=>r.requestId))throw Error('Cancele as solicitações de pagamento desta seleção antes de reabrir o fechamento.');
  state.closings=state.closings.flatMap(c=>{
    if(!matching.includes(c))return [c];
    if(!farmId)return [];
    const remaining=c.farmIds.filter(id=>id!==farmId);
    return remaining.length?[{...c,farmIds:remaining,rows:c.rows.filter(r=>r.farmId!==farmId)}]:[];
  });
  state.invoiceReopens=(state.invoiceReopens||[]).filter(key=>!key.startsWith(`${p.key}|`)||farmId&&key!==invoiceReopenKey(p.key,farmId));
}
export function reopenTruckClosing(state,p,closingId,truckId) {
  const closing=periodClosings(state,p).find(item=>item.id===closingId);
  if(!closing)throw Error('Este fechamento não está mais disponível.');
  const row=closing.rows.find(item=>item.truckId===truckId);
  if(!row)throw Error('Este caminhão não faz parte do fechamento selecionado.');
  if(state.fundingTransfers?.some(t=>t.period.key===p.key&&t.farmId===row.farmId&&t.status!=='cancelled'))throw Error('Cancele a solicitação de recibo desta fazenda antes de reabrir. Transferências já efetuadas não podem ser reabertas.');
  if(row.paid)throw Error('Este caminhão já tem pagamento registrado. Corrija o pagamento antes de reabrir.');
  if(row.requestId||state.paymentRequests?.some(request=>request.period.key===p.key&&request.snapshot.truckId===truckId&&request.snapshot.farmId===row.farmId&&['pending','paid'].includes(request.status)))throw Error('Cancele a solicitação de pagamento desta placa antes de reabrir.');
  const remainingRows=closing.rows.filter(item=>item.truckId!==truckId);
  if(!remainingRows.length){state.closings=state.closings.filter(item=>item.id!==closingId);return;}
  const remainingFarmIds=closing.farmIds.filter(id=>remainingRows.some(item=>item.farmId===id));
  state.closings=state.closings.map(item=>item.id===closingId?{...item,rows:remainingRows,farmIds:remainingFarmIds}:item);
}
export function discountLocked(d,state) {
  return state.closings.some(c=>c.rows.some(r=>r.truckId===d.truckId)&&overlaps(c.period.start,c.period.end,d.start,d.end));
}
export function validateTruck(t,state,requireDetails=false) {
  if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(t.plate)) throw Error('Informe uma placa válida, como ABC1D23 ou ABC1234.');
  if (!t.driver.trim() || !t.carrier.trim()) throw Error('Informe o motorista e o transportador.');
  const farm=state.farms.find(f=>f.id===t.farmId),existing=state.trucks.find(x=>x.id===t.id);
  if (!farm) throw Error('Selecione uma fazenda.');
  if(farm.active===false&&(!existing||existing.farmId!==t.farmId))throw Error('Reative esta fazenda antes de cadastrar ou alocar um caminhão nela.');
  if (!Number.isFinite(t.monthly) || t.monthly<=0 || t.monthly>10000000) throw Error('Informe um valor mensal maior que zero.');
  validatePaymentDetails(t.paymentDetails);
  if((requireDetails||t.bodyType) && !BODY_TYPES.includes(t.bodyType))throw Error('Selecione caçamba ou graneleiro.');
  if((requireDetails||t.axles!=null) && (!Number.isInteger(t.axles)||t.axles<1||t.axles>99))throw Error('Informe uma quantidade inteira de eixos, de 1 a 99.');
  if (!validDate(t.start) || (t.end && (!validDate(t.end) || t.end<t.start))) throw Error('O encerramento precisa ser igual ou posterior ao início.');
  if(t.serviceEnded&&(!validDate(t.serviceEnded.date)||t.end!==t.serviceEnded.date))throw Error('Use Encerrar atividades para revisar a data do encerramento.');
  if(t.transferIn){
    const from=state.trucks.find(x=>x.id===t.transferIn.fromTruckId);
    if(!from||!validDate(t.transferIn.date)||t.start!==t.transferIn.date||from.transferOut?.toTruckId!==t.id||from.transferOut.date!==t.start||from.end!==shiftDate(t.start,-1)||from.farmId!==t.transferIn.fromFarmId||from.transferOut.toFarmId!==t.farmId||from.plate!==t.plate)throw Error('As datas, placa e fazendas estão vinculadas à transferência.');
  }
  if(t.transferOut){
    const to=state.trucks.find(x=>x.id===t.transferOut.toTruckId);
    if(!to||!validDate(t.transferOut.date)||t.end!==shiftDate(t.transferOut.date,-1)||to.transferIn?.fromTruckId!==t.id||to.start!==t.transferOut.date||to.farmId!==t.transferOut.toFarmId||to.transferIn.fromFarmId!==t.farmId||to.plate!==t.plate)throw Error('As datas, placa e fazendas estão vinculadas à transferência.');
  }
  if(existing && existing.farmId!==t.farmId && state.closings.some(c=>c.rows.some(r=>r.truckId===t.id)))throw Error('Esta contratação já tem fechamento. Use Transferir fazenda para registrar a mudança com data e preservar o histórico.');
  const duplicate=state.trucks.find(x=>x.id!==t.id && x.plate===t.plate && overlaps(x.start,x.end||'9999-12-31',t.start,t.end||'9999-12-31'));
  if (duplicate) throw Error('Já existe um contrato desta placa com datas sobrepostas.');
  if (state.discounts.some(d=>d.truckId===t.id && (d.start<t.start || (t.end && d.end>t.end)))) throw Error('Há descontos fora das novas datas do contrato. Ajuste os descontos primeiro.');
}
export function previewTransfer(state,truckId,toFarmId,date) {
  const t=state.trucks.find(t=>t.id===truckId);
  if(!t)throw Error('Selecione um caminhão cadastrado.');
  if(t.transferOut)throw Error('Este período já foi transferido. Use o cadastro da fazenda de destino.');
  if(!state.farms.some(f=>f.id===toFarmId)||toFarmId===t.farmId)throw Error('Selecione uma fazenda de destino diferente da atual.');
  if(state.farms.find(f=>f.id===toFarmId).active===false)throw Error('Reative a fazenda de destino antes de transferir o caminhão.');
  if(!validDate(date)||date<=t.start)throw Error('A transferência deve ser posterior à entrada nesta fazenda. Para mudar desde o início, use Editar.');
  if(t.end&&date>t.end)throw Error('A transferência deve ocorrer dentro do período contratado.');
  const conflicts=state.closings.flatMap(c=>c.rows.filter(r=>r.truckId===t.id&&r.end>=date).map(r=>({closingId:c.id,period:c.period,farmId:r.farmId,farmName:r.farmName,plate:r.plate,paid:!!r.paid})));
  return {truckId,plate:t.plate,fromFarmId:t.farmId,fromFarmName:state.farms.find(f=>f.id===t.farmId).name,toFarmId,toFarmName:state.farms.find(f=>f.id===toFarmId).name,date,lastOldDay:shiftDate(date,-1),monthly:t.monthly,conflicts,canTransfer:!conflicts.length};
}
export function transferTruck(state,truckId,toFarmId,date,note='',newId=uid()) {
  const plan=previewTransfer(state,truckId,toFarmId,date);
  if(!plan.canTransfer)throw Error('Há fechamento salvo nos dias afetados. Revise e reabra esse período antes de transferir.');
  if(state.trucks.some(t=>t.id===newId))throw Error('O cadastro de destino já existe.');
  const next=structuredClone(state),from=next.trucks.find(t=>t.id===truckId),oldEnd=from.end||'';
  const to={...from,id:newId,farmId:toFarmId,start:date,end:oldEnd,transferIn:{fromTruckId:truckId,fromFarmId:from.farmId,fromFarmName:plan.fromFarmName,date,note:String(note).trim().slice(0,300)}};
  delete to.transferOut;
  from.end=plan.lastOldDay;
  delete from.serviceEnded;
  from.transferOut={toTruckId:newId,toFarmId,toFarmName:plan.toFarmName,date,note:String(note).trim().slice(0,300)};
  next.trucks.push(to);
  next.discounts=next.discounts.flatMap(d=>{
    if(d.truckId!==truckId||d.end<date)return [d];
    if(d.start>=date)return [{...d,truckId:newId}];
    return [{...d,end:plan.lastOldDay},{...d,id:uid(),truckId:newId,start:date}];
  });
  validateState(next);
  state.trucks=next.trucks;state.discounts=next.discounts;
  return to;
}
export function latestTruck(state,id) {
  let t=state.trucks.find(t=>t.id===id);const seen=new Set();
  while(t?.transferOut){if(seen.has(t.id))throw Error('O histórico de transferências está inconsistente.');seen.add(t.id);t=state.trucks.find(x=>x.id===t.transferOut.toTruckId);}
  if(!t)throw Error('Selecione um caminhão cadastrado.');return t;
}
function prepareEndActivities(state,id,date) {
  const current=latestTruck(state,id);
  if(!validDate(date)||date<current.start)throw Error('O último dia de serviço deve ser igual ou posterior à entrada no período atual da fazenda.');
  if(!state.settings.confirmed)throw Error('Confira e salve a regra de cálculo antes de encerrar.');
  const p=period(date.slice(0,7),Number(date.slice(8))<=15?1:2),family=new Set();let ancestor=current;
  while(ancestor){if(family.has(ancestor.id))throw Error('O histórico desta placa está inconsistente.');family.add(ancestor.id);ancestor=ancestor.transferIn?state.trucks.find(t=>t.id===ancestor.transferIn.fromTruckId):null;}
  const existing=periodClosings(state,p).find(c=>c.rows.some(r=>r.truckId===current.id));
  if(state.closings.some(c=>c.period.key>=p.key&&c.rows.some(r=>family.has(r.truckId)&&r.requestId&&!r.paid)))throw Error('Cancele a solicitação de pagamento antes de revisar o encerramento desta placa.');
  if(current.serviceEnded?.date===date&&existing&&!pendingRows(state,p).some(r=>family.has(r.truckId))){
    const all=periodClosings(state,p).flatMap(c=>c.rows).filter(r=>family.has(r.truckId));
    return {next:structuredClone(state),truckId:current.id,plate:current.plate,farmName:state.farms.find(f=>f.id===current.farmId).name,date,period:p,rows:all,pending:[],conflicts:[],revisions:[],cancelled:[],alreadyEnded:true,existingId:existing.id};
  }
  const next=structuredClone(state),t=next.trucks.find(t=>t.id===current.id),previous=t.serviceEnded||{};
  t.end=date;t.serviceEnded={...previous,date,periodKey:p.key};
  const cancelled=[];
  next.discounts=next.discounts.flatMap(d=>{
    if(d.truckId!==t.id||d.end<=date)return [d];
    cancelled.push(structuredClone(d));
    return d.start>date?[]:[{...d,end:date}];
  });
  const conflicts=[];
  for(const c of state.closings)for(const r of c.rows){
    if(!family.has(r.truckId)||!r.paid||c.period.key<p.key)continue;
    const registered=next.trucks.find(t=>t.id===r.truckId),expected=calculate({...registered,start:r.contractStart||registered.start,monthly:r.monthly},c.period,c.settings,next.discounts,next.farms);
    if(expected.start!==r.start||expected.end!==r.end||expected.eligibleDays!==r.eligibleDays||expected.discountDays!==r.discountDays)conflicts.push({closingId:c.id,period:c.period,truckId:r.truckId,plate:r.plate,farmId:r.farmId,farmName:r.farmName,paid:true});
  }
  const revisions=[];
  next.closings=next.closings.flatMap(c=>{
    const removed=c.rows.filter(r=>family.has(r.truckId)&&!r.paid&&(c.period.start>date||(r.truckId===t.id&&c.period.key===p.key)));
    if(!removed.length)return [c];
    for(const r of removed)revisions.push({closingId:c.id,period:structuredClone(c.period),endDate:c.activityEndDate||'',row:structuredClone(r)});
    const rows=c.rows.filter(r=>!removed.includes(r));
    const removedFarms=new Set(removed.map(r=>r.farmId)),farmIds=c.farmIds.filter(f=>!removedFarms.has(f)||rows.some(r=>r.farmId===f));
    return farmIds.length?[{...c,farmIds,rows}]:[];
  });
  const booked=periodClosings(next,p).flatMap(c=>c.rows).filter(r=>family.has(r.truckId)),bookedIds=new Set(booked.map(r=>r.truckId));
  const pending=pendingRows(next,p).filter(r=>family.has(r.truckId));
  if(!bookedIds.has(t.id)&&!pending.some(r=>r.truckId===t.id))pending.push(calculate(t,p,next.settings,next.discounts,next.farms));
  validateState(next);
  return {next,truckId:t.id,plate:t.plate,farmName:next.farms.find(f=>f.id===t.farmId).name,date,period:p,rows:[...booked,...pending],pending,conflicts,revisions,cancelled,alreadyEnded:false};
}
export function previewEndActivities(state,id,date) {
  const plan=prepareEndActivities(state,id,date);
  const total=round(plan.rows.reduce((n,r)=>n+r.net,0)),paid=round(plan.rows.filter(r=>r.paid).reduce((n,r)=>n+r.net,0));
  return {...plan,next:undefined,canEnd:!plan.conflicts.length,total,paid,balance:round(total-paid)};
}
export function endActivities(state,id,date,note='',closingId=uid(),closedDate=today()) {
  const plan=prepareEndActivities(state,id,date);
  if(plan.conflicts.length)throw Error('A data altera dias de um pagamento registrado. Revise esse pagamento antes de encerrar.');
  if(plan.alreadyEnded){state.trucks.find(t=>t.id===plan.truckId).serviceEnded.note=String(note).trim().slice(0,300);return state.closings.find(c=>c.id===plan.existingId);}
  if(state.closings.some(c=>c.id===closingId))throw Error('O fechamento de encerramento já existe.');
  const next=plan.next,t=next.trucks.find(t=>t.id===plan.truckId),previous=state.trucks.find(t=>t.id===plan.truckId)?.serviceEnded||{};
  let c;
  if(plan.pending.length){
    c={id:closingId,period:plan.period,farmIds:[...new Set(plan.pending.map(r=>r.farmId))],kind:'activity-end',activityEndDate:date,settings:structuredClone(next.settings),closedDate,rows:structuredClone(plan.pending)};
    next.closings.push(c);
  } else c=periodClosings(next,plan.period).find(c=>c.rows.some(r=>r.truckId===t.id));
  t.serviceEnded={date,periodKey:plan.period.key,closingId:c?.id||'',closedDate,note:String(note).trim().slice(0,300),revisions:[...(previous.revisions||[]),...plan.revisions],cancelledDiscounts:[...(previous.cancelledDiscounts||[]),...plan.cancelled]};
  validateState(next);
  state.trucks=next.trucks;state.discounts=next.discounts;state.closings=next.closings;
  return c;
}
export function validateDiscount(d,state,checkBudget=true) {
  const t=state.trucks.find(t=>t.id===d.truckId);
  if (!t) throw Error('Selecione um caminhão cadastrado.');
  if (!validDate(d.start) || !validDate(d.end)) throw Error('Confira as datas do desconto.');
  if(d.end<d.start)throw Error('A data final não pode ser anterior à inicial.');
  if (days(d.start,d.end)>366) throw Error('Lance descontos com duração de até 366 dias.');
  if (d.start<t.start || (t.end && d.end>t.end)) throw Error('O desconto deve estar dentro do período contratado.');
  if(d.kind!==undefined&&!['days','amount'].includes(d.kind))throw Error('Selecione um tipo de desconto válido.');
  if(typeof d.note!=='string')throw Error('Informe o motivo do desconto.');
  if(isAmountDiscount(d)){
    if(d.start!==d.end)throw Error('Informe uma única data para o desconto por valor.');
    if(!Number.isFinite(d.amount)||d.amount<=0||d.amount>10000000||round(d.amount)!==d.amount)throw Error('Informe um valor de desconto maior que zero, com até duas casas decimais.');
    if(d.reason!=='Valor'||!d.note.trim())throw Error('Informe obrigatoriamente o motivo do desconto por valor.');
    const p=period(d.start.slice(0,7),Number(d.start.slice(8))<=15?1:2),range=eligibleRange(t,p,state.settings);if(d.start<range.start||d.start>range.end)throw Error('A data do desconto por valor deve ser um dia considerado no pagamento.');
  }else{
    if(d.amount!==undefined)throw Error('Escolha desconto por valor para informar um valor em reais.');
    if(!['Falta','Oficina','Outro'].includes(d.reason)||(d.reason==='Outro'&&!d.note.trim()))throw Error('Informe o motivo do desconto.');
    if(state.discounts.some(x=>x.id!==d.id&&x.truckId===d.truckId&&!isAmountDiscount(x)&&overlaps(x.start,x.end,d.start,d.end)))throw Error('Esta placa já tem desconto em uma dessas datas. Cada dia pode ser descontado apenas uma vez.');
  }
  const prior=state.discounts.find(x=>x.id===d.id);
  if (discountLocked(d,state)||(prior&&discountLocked(prior,state))) throw Error('Há uma quinzena fechada desta fazenda nessas datas. Reabra o fechamento antes de alterar o desconto.');
  if(checkBudget){
    const proposed=[...state.discounts.filter(event=>event.id!==d.id),d],affected=new Map();
    for(const event of proposed.filter(event=>event.truckId===t.id&&isAmountDiscount(event))){const p=period(event.start.slice(0,7),Number(event.start.slice(8))<=15?1:2);if(!discountLocked(event,state))affected.set(p.key,p);}
    for(const p of affected.values())calculate(t,p,state.settings,proposed,state.farms);
  }
}
export function csv(rows) {
  const cell=x=>{let s=String(x??'');if(/^[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  return '\uFEFF'+rows.map(r=>r.map(cell).join(';')).join('\r\n');
}
function fixedPeriodAmount(monthly,p) {
  const first=round(monthly/2);
  return p.half===1?first:round(monthly-first);
}
export function applyFixedMonthlyRule(state) {
  state.settings={...state.settings,mode:'half',fixedMonthlyVersion:1,confirmed:true};
  const previous=new Map(),changed=new Set();
  for(const c of state.closings){
    previous.set(c.id,{settings:structuredClone(c.settings),rows:structuredClone(c.rows.filter(r=>!r.paid))});
    for(const r of c.rows){
      const used=r.calculationSettings||c.settings;
      if(r.paid||r.requestId||(used.mode==='half'&&used.fixedMonthlyVersion===1))continue;
      const rate=fixedPeriodAmount(r.monthly,c.period)/days(c.period.start,c.period.end);
      r.rate=rate;r.gross=round(rate*r.eligibleDays);r.net=round(rate*r.payableDays-amountDiscountTotal(r));if(r.net<0)throw Error('Os descontos por valor excedem o saldo do fechamento.');r.discount=round(r.gross-r.net);
      r.calculationSettings={...used,mode:'half',fixedMonthlyVersion:1};delete r.roundingAdjusted;changed.add(c.id);
    }
  }
  const groups=new Map();
  for(const c of state.closings)for(const r of c.rows){const key=c.period.key+'|'+r.plate;if(!groups.has(key))groups.set(key,[]);groups.get(key).push({closing:c,row:r});}
  for(const items of groups.values()){
    if(!items.some(x=>changed.has(x.closing.id)))continue;
    const pending=items.filter(x=>!x.row.paid).sort((a,b)=>a.row.start.localeCompare(b.row.start));if(!pending.length)continue;
    const gross=Math.round(round(items.reduce((n,x)=>n+x.row.rate*x.row.eligibleDays,0))*100),net=Math.round(round(items.reduce((n,x)=>n+x.row.rate*x.row.payableDays,0))*100)-items.reduce((n,x)=>n+Math.round(amountDiscountTotal(x.row)*100),0);
    const currentNet=items.reduce((n,x)=>n+Math.round(x.row.net*100),0),currentDiscount=items.reduce((n,x)=>n+Math.round(x.row.discount*100),0);
    const adjust=(field,delta,candidates)=>{
      for(const x of [...candidates].reverse()){
        if(!delta)break;const old=Math.round(x.row[field]*100),amount=delta>0?delta:Math.max(delta,-old);
        x.row[field]=(old+amount)/100;if(amount){x.row.roundingAdjusted=true;changed.add(x.closing.id);}delta-=amount;
      }
      if(delta)throw Error('Confira os pagamentos antigos antes de ajustar a regra mensal desta placa.');
    };
    adjust('net',net-currentNet,pending.filter(x=>x.row.payableDays>0));adjust('discount',gross-net-currentDiscount,pending.filter(x=>x.row.discountDays>0||amountDiscountTotal(x.row)>0));
    pending.forEach(x=>x.row.gross=round(x.row.net+x.row.discount));
  }
  for(const c of state.closings){
    if(!changed.has(c.id))continue;
    const old=previous.get(c.id),changedAmounts=c.rows.filter(r=>!r.paid).some(r=>{const p=old.rows.find(x=>x.truckId===r.truckId);return p&&(p.net!==r.net||p.gross!==r.gross||p.discount!==r.discount);});
    if(changedAmounts)c.calculationRevisions=[...(c.calculationRevisions||[]),{reason:'fixed-monthly',date:today(),previousSettings:old.settings,previousRows:old.rows}];
    if(!c.rows.some(r=>r.paid)){c.settings={...c.settings,mode:'half',fixedMonthlyVersion:1};c.rows.forEach(r=>{if(!r.paid)delete r.calculationSettings;});}
  }
  return state;
}
export function migrateState(s) {
  if(!s || ![1,SCHEMA].includes(s.schema))throw Error('Este arquivo não é um backup válido do Frota.');
  const result=structuredClone(s);result.paymentRequests??=[];result.fundingTransfers??=[];result.invoiceReopens??=[];
  if(s.schema===1){
    result.schema=SCHEMA;
    result.trucks=result.trucks?.map(t=>({...t,bodyType:t.bodyType||'',axles:t.axles??null}));
    result.closings=result.closings?.map(c=>({...c,farmIds:c.farmIds||result.farms.map(f=>f.id),rows:c.rows.map(r=>({...r,bodyType:r.bodyType||'',axles:r.axles??null}))}));
  }
  return result;
}
export function validateState(input) {
  const s=migrateState(input);
  if (!s || s.schema!==SCHEMA || !Array.isArray(s.farms) || !s.farms.length || !Array.isArray(s.trucks) || !Array.isArray(s.discounts) || !Array.isArray(s.closings) || !Array.isArray(s.paymentRequests) || !Array.isArray(s.fundingTransfers) || !MODES[s.settings?.mode] || typeof s.settings.includeStart!=='boolean' || typeof s.settings.includeEnd!=='boolean') throw Error('Este arquivo não é um backup válido do Frota.');
  if(!Array.isArray(s.invoiceReopens)||s.invoiceReopens.length>10000||new Set(s.invoiceReopens).size!==s.invoiceReopens.length||s.invoiceReopens.some(key=>typeof key!=='string'||!/^\d{4}-\d{2}-[12]\|[^|]+$/.test(key)))throw Error('Autorizações de nova fatura inválidas no backup.');
  for(const list of [s.farms,s.trucks,s.discounts,s.closings,s.paymentRequests,s.fundingTransfers]) if(list.length>10000 || new Set(list.map(x=>x?.id)).size!==list.length || list.some(x=>typeof x.id!=='string' || !x.id)) throw Error('O backup contém registros inválidos ou duplicados.');
  if(s.farms.some(f=>typeof f.name!=='string' || !f.name.trim()||(f.active!==undefined&&typeof f.active!=='boolean')))throw Error('Confira as fazendas do backup.');
  for(const t of s.trucks) { if(typeof t.driver!=='string'||typeof t.carrier!=='string'||typeof t.plate!=='string')throw Error('Cadastro inválido no backup.'); validateTruck(t,s); }
  for(const d of s.discounts) { if(typeof d.note!=='string') throw Error('Desconto inválido no backup.'); validateDiscount(d,{...s,closings:[]},false); }
  const amountPeriods=new Set();for(const d of s.discounts.filter(isAmountDiscount)){const p=period(d.start.slice(0,7),Number(d.start.slice(8))<=15?1:2),key=d.truckId+'|'+p.key;if(!discountLocked(d,s)&&!amountPeriods.has(key)){calculate(s.trucks.find(t=>t.id===d.truckId),p,s.settings,s.discounts,s.farms);amountPeriods.add(key);}}
  for(const c of s.closings) {
    const expected=period(c.period?.month,c.period?.half);
    if(!Array.isArray(c.rows) || !Array.isArray(c.farmIds)||!c.farmIds.length||new Set(c.farmIds).size!==c.farmIds.length||c.farmIds.some(id=>!s.farms.some(f=>f.id===id)) || !c.settings || !MODES[c.settings.mode] || c.period?.key!==expected.key || c.period.start!==expected.start || c.period.end!==expected.end || !validDate(c.closedDate))throw Error('Fechamento inválido no backup.');
    if(new Set(c.rows.map(r=>r.truckId)).size!==c.rows.length)throw Error('Fechamento com caminhões duplicados.');
    for(const r of c.rows) if(!c.farmIds.includes(r.farmId)||!s.trucks.some(t=>t.id===r.truckId) || typeof r.plate!=='string' || typeof r.carrier!=='string' || typeof r.farmName!=='string' || !Number.isFinite(r.net)||r.net<0 || !Number.isFinite(r.gross)||!Number.isFinite(r.discount) || !Number.isFinite(r.rate)||!Number.isInteger(r.payableDays)||!Array.isArray(r.events) || (r.paid && !validDate(r.paid.date))) throw Error('Valores inválidos em um fechamento.');
    for(const r of c.rows)for(const event of r.events.filter(isAmountDiscount))if(!Number.isFinite(event.amount)||event.amount<=0||round(event.amount)!==event.amount||event.reason!=='Valor'||typeof event.note!=='string'||!event.note.trim()||!validDate(event.start)||event.start!==event.end||event.start<r.start||event.end>r.end||event.count!==0)throw Error('Desconto por valor inválido no histórico do fechamento.');
  }
  const vehicles=s.closings.flatMap(c=>c.rows.map(r=>c.period.key+'|'+r.truckId));
  if(new Set(vehicles).size!==vehicles.length)throw Error('O backup contém placas duplicadas em fechamentos da mesma quinzena.');
  for(const request of s.paymentRequests){
    if(!['pending','paid','cancelled'].includes(request.status)||!validDate(String(request.requestedAt).slice(0,10))||typeof request.requestedBy!=='string'||!request.snapshot||!Number.isFinite(request.snapshot.net)||request.snapshot.net<=0||!Array.isArray(request.paymentHistory))throw Error('Solicitação de pagamento inválida.');
    if(request.snapshot.paymentDetails!==undefined)validatePaymentDetails(request.snapshot.paymentDetails,true);
    const c=s.closings.find(c=>c.id===request.closingId),row=c?.rows.find(r=>r.truckId===request.truckId);
    if(request.status!=='cancelled'&&(!row||row.requestId!==request.id||row.net!==request.snapshot.net||c.period.key!==request.period?.key))throw Error('A solicitação deve preservar o valor e a quinzena do fechamento.');
    if(request.status==='paid'&&(!row.paid?.receipt?.id||row.paid.requestId!==request.id||JSON.stringify(row.paid)!==JSON.stringify(request.payment)))throw Error('Pagamento solicitado exige comprovante e registro consistente.');
    if(request.status==='pending'&&(row.paid||request.payment))throw Error('Situação de pagamento inconsistente.');
  }
  for(const c of s.closings)for(const r of c.rows)if(r.requestId&&!s.paymentRequests.some(q=>q.id===r.requestId&&q.status!=='cancelled'&&q.closingId===c.id&&q.truckId===r.truckId))throw Error('Solicitação vinculada ao fechamento não encontrada.');
  for(const transfer of s.fundingTransfers){
    const p=period(transfer.period?.month,transfer.period?.half);
    if(!s.farms.some(f=>f.id===transfer.farmId)||typeof transfer.farmName!=='string'||!transfer.farmName||transfer.period?.key!==p.key||!Number.isFinite(transfer.amount)||transfer.amount<=0||round(transfer.amount)!==transfer.amount||typeof transfer.description!=='string'||!transfer.description.trim()||transfer.description.length>200||!validDate(String(transfer.requestedAt).slice(0,10))||!['awaiting_receipt','receipt_submitted','transferred','cancelled'].includes(transfer.status))throw Error('Transferência à transportadora inválida.');
    if(transfer.rows!==undefined&&(!Array.isArray(transfer.rows)||!transfer.rows.length||transfer.rows.some(row=>typeof row.truckId!=='string'||!row.truckId||typeof row.plate!=='string'||!row.plate||typeof row.driver!=='string'||!Number.isFinite(row.net)||row.net<=0||round(row.net)!==row.net)||new Set(transfer.rows.map(row=>row.truckId)).size!==transfer.rows.length||round(transfer.rows.reduce((sum,row)=>sum+Math.round(row.net*100),0)/100)!==transfer.amount||typeof transfer.carrierName!=='string'))throw Error('Placas e valores do recibo da transportadora inconsistentes.');
    if(transfer.receiptProfile!==undefined&&(!transfer.receiptProfile||typeof transfer.receiptProfile!=='object'||Array.isArray(transfer.receiptProfile)||Object.values(transfer.receiptProfile).some(value=>typeof value!=='string'||value.length>240)))throw Error('Dados empresariais do recibo inválidos.');
    if(transfer.status==='awaiting_receipt'&&(transfer.receipt||transfer.transfer)||transfer.status==='receipt_submitted'&&(!transfer.receipt?.id||transfer.transfer)||transfer.status==='transferred'&&(!transfer.receipt?.id||!validDate(transfer.transfer?.date)||transfer.transfer.date>today())||transfer.status==='cancelled'&&(!transfer.cancelReason||transfer.transfer))throw Error('Situação do recibo ou da transferência inconsistente.');
  }
  return s;
}

