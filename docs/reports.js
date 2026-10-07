import {periodRows,periodLabel,dateLabel,round,money} from './engine.js?v=31';

const reportEscape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const reportSum=(rows,key)=>round(rows.reduce((total,row)=>total+(row[key]||0),0));
const reportMoney=value=>money(value).replace(/^R\$\s*/, '');
const reportRowStatus=row=>row.paid?'Pago':row.closed?'Fechado':'Aberto';
function reportStatus(rows) {
  if(rows.some(row=>!row.closed))return 'Aberto';
  if(rows.some(row=>!row.paid&&row.net>0))return 'Fechados, aguardando pagamento';
  return rows.some(row=>row.paid)?'Pagos':'Fechados';
}
function reportNotes(rows,p) {
  const notes=[];
  for(const row of rows){
    for(const event of row.events){
      const start=[event.start,row.start,p.start].sort().at(-1),end=[event.end,row.end,p.end].sort()[0];
      if(event.kind==='amount'){notes.push(`${row.plate} · Desconto por valor em ${dateLabel(event.start)}: ${money(event.amount)}. Motivo: ${event.note}`);continue;}
      if(!event.count||start>end)continue;
      notes.push(`${row.plate} · ${event.reason} em ${dateLabel(start)}${end!==start?' a '+dateLabel(end):''}: ${event.count} dia(s).${event.note?' '+event.note:''}`);
    }
  }
  return [...new Set(notes)];
}
function reportChunks(items,maxItems,maxLines,lines) {
  const pages=[];let current=[],used=0;
  for(const item of items){const size=lines(item);if(current.length&&(current.length>=maxItems||used+size>maxLines)){pages.push(current);current=[];used=0;}current.push(item);used+=size;}
  if(current.length)pages.push(current);return pages;
}

export function createReport(state,p,{farmId='',onlyPaid=false,closingId='',plate=''}={}) {
  const rows=periodRows(state,p).filter(row=>(!farmId||row.farmId===farmId)&&(!closingId||row.closingId===closingId)&&(!plate||row.plate===plate)&&(!onlyPaid||row.paid));
  const grouped=new Map();
  for(const row of rows){if(!grouped.has(row.farmId))grouped.set(row.farmId,[]);grouped.get(row.farmId).push(row);}
  const pages=[];
  for(const [id,farmRows] of grouped){
    farmRows.sort((a,b)=>a.carrier.localeCompare(b.carrier,'pt-BR')||a.plate.localeCompare(b.plate)||a.start.localeCompare(b.start));
    const mixedFarm=new Set(farmRows.map(reportRowStatus)).size>1;
    const chunks=reportChunks(farmRows,10,22,row=>Math.max(2,Math.ceil(row.carrier.length/22),1+Math.ceil(row.driver.length/22)+(mixedFarm?1:0)));
    chunks.forEach((chunk,index)=>{
      const notes=reportNotes(chunk,p),noteLines=notes.reduce((n,note)=>n+Math.ceil(note.length/95),0);
      const common={farmId:id,farmName:chunk[0].farmName,status:reportStatus(chunk),farmCount:new Set(farmRows.map(row=>row.plate)).size,farmTotal:reportSum(farmRows,'net')};
      pages.push({...common,kind:'trucks',rows:chunk,total:reportSum(chunk,'net'),discount:reportSum(chunk,'discount'),paid:reportSum(chunk.filter(row=>row.paid),'net'),notes:noteLines<=4?notes:[],notesFollow:noteLines>4,multipleChunks:chunks.length>1,lastChunk:index===chunks.length-1});
      if(noteLines>4)for(const noteChunk of reportChunks(notes,18,25,note=>Math.ceil(note.length/95))){pages.push({...common,kind:'notes',notes:noteChunk,rows:[],total:0});}
    });
  }
  return {period:{...p},onlyPaid,closingId,plate,pages,total:reportSum(rows,'net'),farmCount:grouped.size,truckCount:new Set(rows.map(row=>row.plate)).size};
}

export function reportMarkup(report) {
  const p=report.period,monthName=new Date(`${p.month}-02T12:00:00Z`).toLocaleDateString('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'});
  return report.pages.map((page,index)=>{
    const mixed=new Set(page.rows.map(reportRowStatus)).size>1;
    const paidRows=page.rows.filter(row=>row.paid),paidDates=[...new Set(paidRows.map(row=>row.paid.date))].sort();
    const paymentText=paidDates.length===1?`${paidRows.length===page.rows.length?'Pagamento registrado':'Pagamentos registrados'} em ${dateLabel(paidDates[0])}.`:paidDates.length?`Pagamentos registrados de ${dateLabel(paidDates[0])} a ${dateLabel(paidDates.at(-1))}.`:'';
    const totalLabel=page.status==='Pagos'?'Total pago':'Total líquido';
    const notes=page.notes.length?`<div class="report-notes"><h3>Observações</h3>${page.notes.map(note=>`<p>${reportEscape(note)}</p>`).join('')}</div>`:'';
    return `<article class="report-sheet" aria-label="${reportEscape(page.farmName)}, página ${index+1}">
      <header class="report-head"><div class="report-brand">frota<span>.</span></div><h1>Relatório quinzenal</h1><h2>${reportEscape(page.farmName)}</h2><div class="report-period"><div><strong>${p.half}ª quinzena de ${reportEscape(monthName)}</strong><p>${reportEscape(periodLabel(p))}</p></div><span class="report-status ${page.status==='Pagos'?'settled':''}">${reportEscape(page.status)}</span></div></header>
      ${page.kind==='trucks'?`<div class="report-count">${new Set(page.rows.map(row=>row.plate)).size} caminhão(ões)${page.multipleChunks?` nesta página · ${page.farmCount} na fazenda`:''}${report.plate?' · Placa: '+reportEscape(report.plate):''}${report.onlyPaid?' · Somente pagos':''}</div>
      <table class="report-table"><colgroup><col style="width:30%"><col style="width:23%"><col style="width:11%"><col style="width:17%"><col style="width:19%"></colgroup><thead><tr><th>Placa / motorista</th><th>Transportador</th><th class="report-days">Dias a pagar</th><th class="num">Descontos (R$)</th><th class="num">Líquido (R$)</th></tr></thead><tbody>${page.rows.map(row=>`<tr><td><div class="report-truck-heading"><strong>${reportEscape(row.plate)}</strong><span class="report-start">Início: ${dateLabel(row.contractStart)}</span></div><span class="report-driver">${reportEscape(row.driver)}</span>${mixed?`<span class="report-row-status">${row.paid?'Pago em '+dateLabel(row.paid.date):reportRowStatus(row)}</span>`:''}</td><td>${reportEscape(row.carrier)}</td><td class="report-days">${row.payableDays}</td><td class="num">${row.discount?reportMoney(row.discount):'—'}</td><td class="num">${reportMoney(row.net)}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="3">${page.multipleChunks?'SUBTOTAL DESTA PÁGINA':report.plate?'TOTAL DA PLACA NA FAZENDA':'TOTAL DA FAZENDA'}</td><td class="num">${reportMoney(page.discount)}</td><td class="num">${reportMoney(page.total)}</td></tr></tfoot></table>
      <div class="report-total"><strong>${totalLabel}${page.multipleChunks?' nesta página':''}</strong><strong>${money(page.total)}</strong></div>
      ${page.multipleChunks&&page.lastChunk?`<div class="report-farm-total">Total líquido da fazenda <strong>${money(page.farmTotal)}</strong></div>`:''}
      ${page.paid>0&&page.status!=='Pagos'?`<p class="report-payment-summary">Pago: ${money(page.paid)} · Saldo a pagar: ${money(round(page.total-page.paid))}</p>`:''}
      ${notes}${page.notesFollow?'<p class="report-continuation">As observações destes caminhões estão na página seguinte.</p>':''}
      ${paymentText?`<p class="report-payment-date">${reportEscape(paymentText)}</p>`:''}`:`<div class="report-notes-page"><h2>Observações</h2>${notes}</div>`}
      ${report.farmCount>1&&index===report.pages.length-1?`<div class="report-grand-total"><strong>Total líquido ${report.plate?'da placa':'da quinzena'}${report.onlyPaid?' · pagos':''}</strong><strong>${money(report.total)}</strong></div>`:''}
      <footer class="report-footer"><span>${reportEscape(page.farmName)} · ${reportEscape(monthName)}</span><span>Página ${index+1} de ${report.pages.length}</span></footer>
    </article>`;
  }).join('');
}
