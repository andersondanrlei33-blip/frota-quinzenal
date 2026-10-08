export const CTE_LIMIT=20*1024*1024;
export const CTE_REPORT_COLUMNS=['number','shipper','recipient','serviceTaker','issuer','totalValue','issuedOn','plate','shipperCity','shipperStateRegistration','shipperDocument','recipientCity','recipientStateRegistration','recipientDocument','serviceTakerCity','serviceTakerStateRegistration','serviceTakerDocument','issuerCity','issuerStateRegistration','issuerDocument'];

const decodeXml=text=>String(text||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&#x([\da-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&').replace(/<[^>]+>/g,'').trim();
function xmlElement(xml,name){const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),match=String(xml||'').match(new RegExp(`<(?:(?:[\\w.-]+):)?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${escaped}\\s*>`,'i'));return match?.[1]||'';}
const xmlText=(xml,name)=>decodeXml(xmlElement(xml,name));
const xmlParty=(party,addressName)=>{const address=xmlElement(party,addressName)||party;return {city:xmlText(address,'xMun'),stateRegistration:xmlText(party,'IE'),document:xmlText(party,'CNPJ')||xmlText(party,'CPF')};};
export function parseCteXml(bytes){
 let xml;try{xml=new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,'').trimStart();}catch{throw Error('O XML do CT-e precisa estar em UTF-8 válido.');}
 if(/<!DOCTYPE|<!ENTITY/i.test(xml)||!/^<\?xml\b|^<(?:(?:\w+):)?(?:cteProc|CTe)\b/i.test(xml))throw Error('O arquivo não parece ser um XML de CT-e válido.');
 const cte=xmlElement(xml,'CTe')||xml,inf=xmlElement(cte,'infCte')||cte,ide=xmlElement(inf,'ide'),issuer=xmlElement(inf,'emit'),recipient=xmlElement(inf,'dest'),service=xmlElement(inf,'vPrest'),normalized=xmlElement(inf,'infCTeNorm'),modal=xmlElement(normalized,'infModal'),road=xmlElement(modal,'rodo'),vehicle=xmlElement(road,'veic');
 const shipperParty=xmlElement(inf,'rem'),recipientParty=xmlElement(inf,'dest'),expeditorParty=xmlElement(inf,'exped'),receiverParty=xmlElement(inf,'receb'),issuerName=xmlText(issuer,'xNome'),recipientName=xmlText(recipientParty,'xNome'),shipperName=xmlText(shipperParty,'xNome'),explicitTaker=xmlElement(ide,'toma4')||xmlElement(inf,'toma4'),takerCode=xmlText(xmlElement(ide,'toma3'),'toma'),takerParty=explicitTaker||({0:shipperParty,1:expeditorParty,2:receiverParty,3:recipientParty}[takerCode]||''),serviceTakerName=xmlText(explicitTaker,'xNome')||xmlText(takerParty,'xNome'),rawValue=xmlText(service,'vTPrest'),rawIssued=xmlText(ide,'dhEmi')||xmlText(ide,'dEmi'),issuedOn=rawIssued.match(/^\d{4}-\d{2}-\d{2}/)?.[0]||'',plate=xmlText(vehicle,'placa').toUpperCase().replace(/[^A-Z0-9]/g,''),number=xmlText(ide,'nCT');
 const totalValue=Number(rawValue),parsedDate=new Date(issuedOn+'T00:00:00Z');
 if(!issuerName||!recipientName||!shipperName||!serviceTakerName||!Number.isFinite(totalValue)||totalValue<0||totalValue>999999999999.99||!/^\d{4}-\d{2}-\d{2}$/.test(issuedOn)||!Number.isFinite(parsedDate.getTime())||parsedDate.toISOString().slice(0,10)!==issuedOn||plate.length<7||plate.length>8)throw Error('Não consegui ler todos os dados necessários no XML. Envie o XML original do CT-e, não o DACTE em PDF.');
 return {issuer:issuerName.slice(0,160),recipient:recipientName.slice(0,160),shipper:shipperName.slice(0,160),serviceTaker:serviceTakerName.slice(0,160),participantDetails:{issuer:xmlParty(issuer,'enderEmit'),shipper:xmlParty(shipperParty,'enderReme'),recipient:xmlParty(recipientParty,'enderDest'),serviceTaker:xmlParty(takerParty,'enderToma')},totalValue:Number(totalValue.toFixed(2)),issuedOn,plate,number:number.slice(0,40)};
}

const plain=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleUpperCase('pt-BR');
const amounts=value=>[...String(value||'').matchAll(/(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}/g)].map(match=>Number(match[0].replace(/\./g,'').replace(',','.'))).filter(Number.isFinite);
const dates=value=>[...String(value||'').matchAll(/\b(\d{2})\/(\d{2})\/(\d{2}|\d{4})\b/g)].map(match=>{const year=match[3].length===2?'20'+match[3]:match[3],iso=year+'-'+match[2]+'-'+match[1],date=new Date(iso+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===iso?iso:'';}).filter(Boolean);
export function parseCtePdfText(text){
 const lines=String(text||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean),folded=lines.map(plain);
 let issuer='',recipient='',shipper='',serviceTaker='',totalValue=null,issuedOn='',plate='';
 for(let index=0;index<lines.length;index++){
  const line=lines[index],key=folded[index];
  if(!issuer&&key.includes('DACTE'))issuer=line.slice(0,key.indexOf('DACTE')).replace(/[|·•]+/g,' ').replace(/\bMODAL\b.*$/i,'').trim();
  if(!recipient&&key.includes('DESTINATARIO:')){
   const position=key.indexOf('DESTINATARIO:');recipient=line.slice(position+'DESTINATARIO:'.length).replace(/^\s*[|:–—-]?\s*/,'').replace(/\s*[|]\s*.*$/,'').trim();
  }
  if(!shipper&&key.includes('REMETENTE:')){
   const start=key.indexOf('REMETENTE:')+'REMETENTE:'.length,end=key.indexOf('DESTINATARIO:',start);if(end>start)shipper=line.slice(start,end).replace(/^\s*[|:–—-]?\s*/,'').replace(/\s*[|]\s*.*$/,'').trim();
  }
  if(!serviceTaker&&key.includes('TOMADOR SERVICO:')){
   const start=key.indexOf('TOMADOR SERVICO:')+'TOMADOR SERVICO:'.length,tail=line.slice(start),tailKey=plain(tail),next=['MUNICIPIO:','CEP:','CNPJ/CPF:','ENDERECO:','INSCRICAO ESTADUAL:'].map(label=>tailKey.indexOf(label)).filter(index=>index>=0).sort((a,b)=>a-b)[0];serviceTaker=(next===undefined?tail:tail.slice(0,next)).replace(/^\s*[|:–—-]?\s*/,'').trim();
  }
  if(totalValue===null&&key.includes('VALOR TOTAL DO SERVICO')){
   for(const candidate of lines.slice(index,index+3)){const values=amounts(candidate);if(values.length){totalValue=values.at(-1);break;}}
  }
  if(!issuedOn&&key.includes('DATA EMISSAO')){
   for(const candidate of lines.slice(index,index+4)){const values=dates(candidate);if(values.length){issuedOn=values[0];break;}}
  }
 }
 const observations=folded.findIndex(line=>line.includes('OBSERVACOES'));
 const observationText=(observations>=0?lines.slice(observations+1):lines).join(' '),observationKey=plain(observationText);
 const vehiclePlate=observationKey.match(/(?:PLACAS?\s*(?:DO\s+VEICULO)?\s*[:=]\s*)([A-Z0-9-]{7,8})/);
 const explicit=lines.map((line,index)=>({line,key:folded[index]})).find(item=>item.key.includes('PLACA DO VEICULO')&&item.key.match(/PLACA DO VEICULO\s*[:=]?\s*[A-Z0-9-]{7,8}/));
 plate=(explicit?.key.match(/PLACA DO VEICULO\s*[:=]?\s*([A-Z0-9-]{7,8})/)?.[1]||vehiclePlate?.[1]||'').replace(/[^A-Z0-9]/g,'');
 issuer=issuer.replace(/\s+/g,' ').replace(/\s*\/\s*[A-Z]{2}\s*$/,'').trim();recipient=recipient.replace(/\s+/g,' ').trim();shipper=shipper.replace(/\s+/g,' ').trim();serviceTaker=serviceTaker.replace(/\s+/g,' ').trim();
 const parsedDate=issuedOn?new Date(issuedOn+'T00:00:00Z'):null;
 if(!issuer||issuer.length>160||!recipient||recipient.length>160||!shipper||shipper.length>160||!serviceTaker||serviceTaker.length>160||!Number.isFinite(totalValue)||totalValue<0||totalValue>999999999999.99||!issuedOn||!Number.isFinite(parsedDate?.getTime())||parsedDate.toISOString().slice(0,10)!==issuedOn||plate.length<7||plate.length>8)throw Error('Não consegui ler todos os dados do PDF. Envie o DACTE em PDF com texto selecionável e confira se o documento está legível.');
 const number=plain(lines.join(' ')).match(/(?:NRO\.?\s*DOCUMENTO|NUMERO\s+DO\s+CTE)\s*:?\s*(\d{1,20})/)?.[1]||'';
 const all=lines.join('\n'),stateLabel='(?:INS(?:C|CR)?\\.?\\s*(?:EST(?:ADUAL)?\\.?)?|I\\.?E\\.?)',clean=value=>String(value||'').split(/\s{2,}|\s+(?:CEP|CNPJ|CPF|INSC|INSCR|IE|FONE)\s*:/i)[0].replace(/\s*\/\s*[A-Z]{2}\s*$/,'').trim(),fieldValues=(source,label)=>[...source.matchAll(new RegExp(label+'\\s*:\\s*(.*?)(?=\\s+(?:MUNIC[IÍ]PIO|CIDADE|CEP|CNPJ\\s*\\/\\s*CPF|CPF\\s*\\/\\s*CNPJ|CNPJ|CPF|INS(?:C|CR)?\\.?\\s*(?:EST(?:ADUAL)?\\.?)?|INSCRI[CÇ][AÃ]O\\s+ESTADUAL|I\\.?E\\.?|ENDERE[CÇ]O|FONE)\\s*:|\\n|$)','gi'))].map(match=>clean(match[1])).filter(Boolean),stateValues=source=>[...source.matchAll(new RegExp(stateLabel+'\\s*:\\s*([A-Z0-9./-]+)','gi'))].map(match=>match[1]),numberValues=source=>[...source.matchAll(/(?:CNPJ\s*\/\s*CPF|CPF\s*\/\s*CNPJ|CNPJ|CPF)\s*:\s*([\d./-]{11,18})/gi)].map(match=>match[1]),takerIndex=folded.findIndex(line=>line.includes('TOMADOR SERVICO')),remIndex=all.toLocaleUpperCase('pt-BR').indexOf('REMETENTE:'),detailEnd=takerIndex>=0?lines.slice(0,takerIndex).join('\n'):all,partyText=remIndex>=0?detailEnd.slice(remIndex):detailEnd,cities=fieldValues(partyText,'(?:MUNIC[IÍ]PIO|CIDADE)'),registrations=stateValues(partyText),documents=numberValues(partyText),takerText=takerIndex>=0?lines.slice(takerIndex,takerIndex+4).join(' '):'',participantDetails={issuer:{city:'',stateRegistration:'',document:''},shipper:{city:cities[0]||'',stateRegistration:registrations[0]||'',document:documents[0]||''},recipient:{city:cities[1]||'',stateRegistration:registrations[1]||'',document:documents[1]||''},serviceTaker:{city:fieldValues(takerText,'(?:MUNIC[IÍ]PIO|CIDADE)')[0]||'',stateRegistration:stateValues(takerText)[0]||'',document:numberValues(takerText)[0]||''}};
 const issuerStart=folded.findIndex(line=>line.includes('DACTE')),issuerEnd=folded.findIndex((line,index)=>index>issuerStart&&(line.includes('TIPO DO CT-E')||line.includes('REMETENTE:'))),issuerText=issuerStart>=0?lines.slice(issuerStart,issuerEnd>=0?issuerEnd:issuerStart+8).join('\n'):'';participantDetails.issuer.city=fieldValues(issuerText,'(?:MUNIC[IÍ]PIO|CIDADE)')[0]||issuerText.match(/\b([A-ZÀ-Ü][A-ZÀ-Ü ]{2,})\s*\/\s*[A-Z]{2}\s+CEP\b/i)?.[1]?.trim()||'';participantDetails.issuer.document=numberValues(issuerText)[0]||'';participantDetails.issuer.stateRegistration=stateValues(issuerText)[0]||'';
 if(plain(serviceTaker)===plain(shipper))participantDetails.serviceTaker={...participantDetails.shipper,...participantDetails.serviceTaker};else if(plain(serviceTaker)===plain(recipient))participantDetails.serviceTaker={...participantDetails.recipient,...participantDetails.serviceTaker};
 return {issuer:issuer.slice(0,160),recipient:recipient.slice(0,160),shipper:shipper.slice(0,160),serviceTaker:serviceTaker.slice(0,160),participantDetails,totalValue:Number(totalValue.toFixed(2)),issuedOn,plate,number:number.slice(0,40)};
}

async function boundedFormData(request){
 const reader=request.body?.getReader();if(!reader)throw Error('Anexe o CT-e.');
 const chunks=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>CTE_LIMIT+65536){await reader.cancel();throw Error('O CT-e deve ter até 20 MB.');}chunks.push(value);}
 const body=new Uint8Array(size);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}
 return new Request(request.url,{method:'POST',headers:request.headers,body}).formData();
}

export function inspectCte(bytes,name){
 if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>CTE_LIMIT)throw Error('Anexe o PDF ou XML do CT-e, de até 20 MB.');
 const cleanName=String(name||'').split(/[\\/]/).at(-1).replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,160);
 const ext=cleanName.toLowerCase().split('.').at(-1);let mime;
 if(ext==='xml'){parseCteXml(bytes);mime='application/xml';}
 else if(ext==='pdf'&&new TextDecoder().decode(bytes.slice(0,8)).includes('%PDF-'))mime='application/pdf';
 else throw Error('Envie o PDF do DACTE ou o XML original do CT-e.');
 if(!cleanName)throw Error('O arquivo do CT-e precisa ter um nome válido.');
 return {mime,extension:ext,name:cleanName,size:bytes.length};
}

export function createCteApi({backend,readPdf}){
 return async request=>{
  const actor=await backend.actor(request);if(!actor?.userId)return backend.responseJson({error:'Faça login para acessar o sistema.'},401);
  if(!actor.companyId)return backend.responseJson({error:'Sua conta não tem acesso a esta empresa.'},403);
  const path=new URL(request.url).pathname;
  if(request.method==='GET'&&path.endsWith('/api/ctes')){
   const [rows,current,preferences]=await Promise.all([backend.ctes.list(actor.companyId),backend.repository.load(actor.companyId),backend.ctes.getPreferences?.(actor.userId,actor.companyId)??null]);
   const state=current.state||{};
   return backend.responseJson({documents:rows.map(({objectKey,...row})=>row),trucks:(state.trucks||[]).map(t=>({id:t.id,plate:t.plate,driver:t.driver,farmId:t.farmId})),farms:(state.farms||[]).map(f=>({id:f.id,name:f.name,active:f.active!==false})),preferences});
  }
  if(request.method==='POST'&&path.endsWith('/api/ctes/preferences')){
   const text=await request.text();if(text.length>8192)return backend.responseJson({error:'Personalização muito grande.'},413);const body=JSON.parse(text),visibleColumns=body.visibleColumns,order=body.columnOrder;
   if(!Array.isArray(visibleColumns)||!visibleColumns.length||!Array.isArray(order)||visibleColumns.length>CTE_REPORT_COLUMNS.length||order.length!==CTE_REPORT_COLUMNS.length||new Set(order).size!==order.length||order.some(field=>!CTE_REPORT_COLUMNS.includes(field))||new Set(visibleColumns).size!==visibleColumns.length||visibleColumns.some(field=>!CTE_REPORT_COLUMNS.includes(field))||visibleColumns.some(field=>!order.includes(field)))return backend.responseJson({error:'Selecione ao menos uma coluna válida para o relatório.'},400);
   const preferences=await backend.ctes.savePreferences(actor.userId,actor.companyId,{visibleColumns,columnOrder:order});return backend.responseJson({preferences});
  }
  if(request.method==='POST'&&path.endsWith('/api/ctes')){
   if(actor.party!=='carrier'||actor.role==='viewer')return backend.responseJson({error:'Somente a transportadora pode enviar CT-es.'},403);
   if(Number(request.headers.get('Content-Length'))>CTE_LIMIT+65536)throw Error('O CT-e deve ter até 20 MB.');
   const data=await boundedFormData(request),file=data.get('file');
   if(!file||typeof file.arrayBuffer!=='function'||file.size>CTE_LIMIT)throw Error('Anexe o PDF ou XML do CT-e, de até 20 MB.');
   const bytes=new Uint8Array(await file.arrayBuffer()),details=inspectCte(bytes,file.name),cte=details.extension==='xml'?parseCteXml(bytes):parseCtePdfText(await readPdf(bytes));
   const current=await backend.repository.load(actor.companyId),normalizePlate=value=>String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,''),plateMatches=(current.state.trucks||[]).filter(t=>normalizePlate(t.plate)===cte.plate),dateMatches=plateMatches.filter(t=>(!t.start||t.start<=cte.issuedOn)&&(!t.end||t.end>=cte.issuedOn));
   const truck=dateMatches.length===1?dateMatches[0]:dateMatches.length===0&&plateMatches.length===1?plateMatches[0]:null;
   if(!plateMatches.length)throw Error('Não encontrei a placa '+cte.plate+' cadastrada. Confira a placa no cadastro do caminhão e tente novamente.');
   if(!truck)throw Error('Encontrei mais de um cadastro para a placa '+cte.plate+' e não consigo identificar a fazenda com segurança. Confira os períodos e as transferências desse caminhão.');
   const farm=current.state.farms?.find(f=>f.id===truck.farmId);if(!farm)throw Error('A fazenda vinculada à placa não foi encontrada.');
   const metadata={truckId:truck.id,farmId:farm.id,...cte};
   const saved=await backend.ctes.upload(actor,metadata,bytes,details,{plate:cte.plate,driver:truck.driver,farmName:farm.name});
   return backend.responseJson(saved,201);
  }
  const match=path.match(/\/api\/ctes\/([0-9a-f-]{36})$/i);
  if(request.method==='GET'&&match){
   const doc=await backend.ctes.find(actor.companyId,match[1]);if(!doc)return backend.responseJson({error:'CT-e não encontrado para esta empresa.'},404);
   return backend.responseJson({name:doc.name,mime:doc.mime,signedUrl:await backend.ctes.sign(doc),expiresIn:120});
  }
  return backend.responseJson({error:'Método não permitido.'},405);
 };
}
