import {accruedRows,period,periodRows,today} from './engine.js';

export const CTE_LIMIT=20*1024*1024;
export const NFE_XML_LIMIT=10*1024*1024;
export const REQUEST_FILE_LIMIT=10*1024*1024;
export const REQUEST_TOTAL_FILE_LIMIT=20*1024*1024;
export const CTE_REPORT_COLUMNS=['number','shipper','recipient','serviceTaker','issuer','totalValue','issuedOn','plate','manifestedNotes','shipperCity','shipperStateRegistration','shipperDocument','recipientCity','recipientStateRegistration','recipientDocument','serviceTakerCity','serviceTakerStateRegistration','serviceTakerDocument','issuerCity','issuerStateRegistration','issuerDocument'];

const decodeXml=text=>String(text||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&#x([\da-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&').replace(/<[^>]+>/g,'').trim();
function xmlElement(xml,name){const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),match=String(xml||'').match(new RegExp(`<(?:(?:[\\w.-]+):)?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${escaped}\\s*>`,'i'));return match?.[1]||'';}
const xmlText=(xml,name)=>decodeXml(xmlElement(xml,name));
function xmlElements(xml,name){const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return [...String(xml||'').matchAll(new RegExp(`<(?:(?:[\\w.-]+):)?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${escaped}\\s*>`,'gi'))].map(match=>match[1]);}
export function inspectNfeXml(bytes,name){
 if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>NFE_XML_LIMIT)throw Error('Cada XML de NF-e deve ter até 10 MB.');
 let xml;try{xml=new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,'').trimStart();}catch{throw Error('O XML da NF-e precisa estar em UTF-8 válido.');}
 const rootName=xml.replace(/^(?:<\?xml\b[\s\S]*?\?>\s*)?/i,'').match(/^<(?:(?:[\w.-]+):)?(nfeProc|NFe)\b/i)?.[1];
 if(/<!DOCTYPE|<!ENTITY/i.test(xml)||!rootName||!new RegExp(`<\\/(?:(?:[\\w.-]+):)?${rootName}\\s*>\\s*$`,'i').test(xml))throw Error('O arquivo não parece ser um XML de NF-e válido.');
 const keyFromId=xml.match(/<(?:(?:[\w.-]+):)?infNFe\b[^>]*\bId\s*=\s*["']NFe(\d{44})["']/i)?.[1],keyFromProtocol=xmlText(xml,'chNFe').replace(/\D/g,'');
 const accessKey=keyFromId||keyFromProtocol;
 if(!accessKey||accessKey.length!==44)throw Error('Não encontrei a chave de acesso de 44 dígitos neste XML de NF-e.');
 const cleanName=String(name||'').split(/[\\/]/).at(-1).replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,160);
 if(!cleanName||cleanName.toLowerCase().split('.').at(-1)!=='xml')throw Error('Anexe somente arquivos XML de NF-e.');
 return {name:cleanName,mime:'application/xml',extension:'xml',size:bytes.length,accessKey};
}
export function inspectNfePdf(bytes,name){
 if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>REQUEST_FILE_LIMIT)throw Error('Cada PDF da NF-e deve ter até 10 MB.');
 const cleanName=String(name||'').split(/[\\/]/).at(-1).replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,160);
 if(!cleanName||cleanName.toLowerCase().split('.').at(-1)!=='pdf'||!new TextDecoder().decode(bytes.slice(0,8)).includes('%PDF-'))throw Error('Anexe somente arquivos PDF válidos da NF-e.');
 return {name:cleanName,mime:'application/pdf',extension:'pdf',size:bytes.length,accessKey:''};
}
export function extractNfeVehiclePlate(text){
 const normalized=String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleUpperCase('pt-BR');
 const header=normalized.indexOf('PLACA DO VEICULO');if(header<0)return '';
 const section=normalized.slice(header+'PLACA DO VEICULO'.length).split(/\b(?:ENDERECO|DADOS DOS PRODUTOS)\b/,1)[0].slice(0,1600);
 const match=section.match(/\b([A-Z]{3}\s*-?\s*[A-Z0-9]{4})\b/);
 const plate=match?.[1].replace(/[^A-Z0-9]/g,'')||'';
 return plate.length===7?plate:'';
}
const manifestedNotesFromXml=normalized=>{
 const documents=xmlElement(normalized,'infDoc'),notes=[];
 for(const entry of xmlElements(documents,'infNFe')){const accessKey=xmlText(entry,'chave').replace(/\D/g,'');if(accessKey.length===44)notes.push(String(Number(accessKey.slice(25,34))));}
 for(const entry of xmlElements(documents,'infNF')){const number=xmlText(entry,'nDoc').trim();if(number)notes.push(number);}
 return [...new Set(notes)].slice(0,100);
};
const digits=value=>String(value||'').replace(/\D/g,'');
const formatCnpj=value=>{const n=digits(value);return n.length===14?n.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5'):String(value||'');};
const formatCpf=value=>{const n=digits(value);return n.length===11?n.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/,'$1.$2.$3-$4'):String(value||'');};
const xmlParty=(party,addressName)=>{const address=xmlElement(party,addressName)||party;return {city:xmlText(address,'xMun'),stateRegistration:xmlText(party,'IE'),cnpj:formatCnpj(xmlText(party,'CNPJ')),cpf:formatCpf(xmlText(party,'CPF'))};};
export function parseCteXml(bytes){
 let xml;try{xml=new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,'').trimStart();}catch{throw Error('O XML do CT-e precisa estar em UTF-8 válido.');}
 if(/<!DOCTYPE|<!ENTITY/i.test(xml)||!/^<\?xml\b|^<(?:(?:\w+):)?(?:cteProc|CTe)\b/i.test(xml))throw Error('O arquivo não parece ser um XML de CT-e válido.');
 const cte=xmlElement(xml,'CTe')||xml,inf=xmlElement(cte,'infCte')||cte,ide=xmlElement(inf,'ide'),issuer=xmlElement(inf,'emit'),recipient=xmlElement(inf,'dest'),service=xmlElement(inf,'vPrest'),normalized=xmlElement(inf,'infCTeNorm'),modal=xmlElement(normalized,'infModal'),road=xmlElement(modal,'rodo'),vehicle=xmlElement(road,'veic');
 const shipperParty=xmlElement(inf,'rem'),recipientParty=xmlElement(inf,'dest'),expeditorParty=xmlElement(inf,'exped'),receiverParty=xmlElement(inf,'receb'),issuerName=xmlText(issuer,'xNome'),recipientName=xmlText(recipientParty,'xNome'),shipperName=xmlText(shipperParty,'xNome'),explicitTaker=xmlElement(ide,'toma4')||xmlElement(inf,'toma4'),takerCode=xmlText(xmlElement(ide,'toma3'),'toma'),takerParty=explicitTaker||({0:shipperParty,1:expeditorParty,2:receiverParty,3:recipientParty}[takerCode]||''),serviceTakerName=xmlText(explicitTaker,'xNome')||xmlText(takerParty,'xNome'),rawValue=xmlText(service,'vTPrest'),rawIssued=xmlText(ide,'dhEmi')||xmlText(ide,'dEmi'),issuedOn=rawIssued.match(/^\d{4}-\d{2}-\d{2}/)?.[0]||'',plate=xmlText(vehicle,'placa').toUpperCase().replace(/[^A-Z0-9]/g,''),number=xmlText(ide,'nCT');
 const totalValue=Number(rawValue),parsedDate=new Date(issuedOn+'T00:00:00Z');
 if(!issuerName||!recipientName||!shipperName||!serviceTakerName||!Number.isFinite(totalValue)||totalValue<0||totalValue>999999999999.99||!/^\d{4}-\d{2}-\d{2}$/.test(issuedOn)||!Number.isFinite(parsedDate.getTime())||parsedDate.toISOString().slice(0,10)!==issuedOn||plate.length<7||plate.length>8)throw Error('Não consegui ler todos os dados necessários no XML. Envie o XML original do CT-e, não o DACTE em PDF.');
 return {issuer:issuerName.slice(0,160),recipient:recipientName.slice(0,160),shipper:shipperName.slice(0,160),serviceTaker:serviceTakerName.slice(0,160),participantDetails:{issuer:xmlParty(issuer,'enderEmit'),shipper:xmlParty(shipperParty,'enderReme'),recipient:xmlParty(recipientParty,'enderDest'),serviceTaker:xmlParty(takerParty,'enderToma')},totalValue:Number(totalValue.toFixed(2)),issuedOn,plate,number:number.slice(0,40),manifestedNotes:manifestedNotesFromXml(normalized)};
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
 const documentStart=folded.findIndex(line=>line.includes('DOCUMENTOS ORIGINARIOS')),documentEnd=documentStart>=0?folded.findIndex((line,index)=>index>documentStart&&line.includes('OBSERVACOES')):-1,documentBlock=documentStart>=0?lines.slice(documentStart+1,documentEnd>=0?documentEnd:undefined).join('\n'):'';
 const manifestedNotes=[];
 for(const match of documentBlock.matchAll(/\bN\s*F\s*[-.]?\s*E\b([\s\S]*?)(?=\bN\s*F\s*[-.]?\s*E\b|$)/gi)){
  const row=match[1].split(/\r?\n/,1)[0].replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b|\b\d{14}\b|\b\d{11}\b/g,' '),seriesNumber=row.match(/\b\d{1,3}\s*\/\s*(\d{1,12})\b/),plainNumber=seriesNumber?null:row.match(/\b(\d{1,12})\b/);
  const value=seriesNumber?.[1]||plainNumber?.[1];if(value)manifestedNotes.push(String(Number(value)));
 }
 const uniqueManifestedNotes=[...new Set(manifestedNotes)].slice(0,100);
 const all=lines.join('\n'),stateLabel='(?:INS(?:C|CR)?\\.?\\s*(?:EST(?:ADUAL)?\\.?)?|I\\.?E\\.?)',clean=value=>String(value||'').split(/\s{2,}|\s+(?:CEP|CNPJ|CPF|INSC|INSCR|IE|FONE)\s*:/i)[0].replace(/\s*\/\s*[A-Z]{2}\s*$/,'').trim(),fieldValues=(source,label)=>[...source.matchAll(new RegExp(label+'\\s*:\\s*(.*?)(?=\\s+(?:MUNIC[IÍ]PIO|CIDADE|CEP|CNPJ\\s*\\/\\s*CPF|CPF\\s*\\/\\s*CNPJ|CNPJ|CPF|INS(?:C|CR)?\\.?\\s*(?:EST(?:ADUAL)?\\.?)?|INSCRI[CÇ][AÃ]O\\s+ESTADUAL|I\\.?E\\.?|ENDERE[CÇ]O|FONE)\\s*:|\\n|$)','gi'))].map(match=>clean(match[1])).filter(Boolean),stateValues=source=>[...source.matchAll(new RegExp(stateLabel+'\\s*:\\s*([A-Z0-9./-]+)','gi'))].map(match=>match[1]),documentValues=source=>[...source.matchAll(/(?:CNPJ\s*\/\s*CPF|CPF\s*\/\s*CNPJ|CNPJ|CPF)\s*:\s*([\d./-]{11,18})/gi)].map(match=>{const value=match[1],length=digits(value).length;return {cnpj:length===14?formatCnpj(value):'',cpf:length===11?formatCpf(value):''};}),takerIndex=folded.findIndex(line=>line.includes('TOMADOR SERVICO')),remIndex=all.toLocaleUpperCase('pt-BR').indexOf('REMETENTE:'),detailEnd=takerIndex>=0?lines.slice(0,takerIndex).join('\n'):all,partyText=remIndex>=0?detailEnd.slice(remIndex):detailEnd,cities=fieldValues(partyText,'(?:MUNIC[IÍ]PIO|CIDADE)'),registrations=stateValues(partyText),documents=documentValues(partyText),takerText=takerIndex>=0?lines.slice(takerIndex,takerIndex+4).join(' '):'',participantDetails={issuer:{city:'',stateRegistration:'',cnpj:'',cpf:''},shipper:{city:cities[0]||'',stateRegistration:registrations[0]||'',...(documents[0]||{cnpj:'',cpf:''})},recipient:{city:cities[1]||'',stateRegistration:registrations[1]||'',...(documents[1]||{cnpj:'',cpf:''})},serviceTaker:{city:fieldValues(takerText,'(?:MUNIC[IÍ]PIO|CIDADE)')[0]||'',stateRegistration:stateValues(takerText)[0]||'',...(documentValues(takerText)[0]||{cnpj:'',cpf:''})}};
 const issuerStart=folded.findIndex(line=>line.includes('DACTE')),issuerEnd=folded.findIndex((line,index)=>index>issuerStart&&(line.includes('TIPO DO CT-E')||line.includes('REMETENTE:'))),issuerText=issuerStart>=0?lines.slice(issuerStart,issuerEnd>=0?issuerEnd:issuerStart+8).join('\n'):'';participantDetails.issuer.city=fieldValues(issuerText,'(?:MUNIC[IÍ]PIO|CIDADE)')[0]||issuerText.match(/\b([A-ZÀ-Ü][A-ZÀ-Ü ]{2,})\s*\/\s*[A-Z]{2}\s+CEP\b/i)?.[1]?.trim()||'';Object.assign(participantDetails.issuer,documentValues(issuerText)[0]||{cnpj:'',cpf:''});participantDetails.issuer.stateRegistration=stateValues(issuerText)[0]||'';
 if(plain(serviceTaker)===plain(shipper)||plain(serviceTaker)===plain(recipient)){const party=plain(serviceTaker)===plain(shipper)?participantDetails.shipper:participantDetails.recipient;for(const key of ['city','stateRegistration','cnpj','cpf'])participantDetails.serviceTaker[key]||=party[key]||'';}
 return {issuer:issuer.slice(0,160),recipient:recipient.slice(0,160),shipper:shipper.slice(0,160),serviceTaker:serviceTaker.slice(0,160),participantDetails,totalValue:Number(totalValue.toFixed(2)),issuedOn,plate,number:number.slice(0,40),manifestedNotes:uniqueManifestedNotes};
}

async function boundedFormData(request,limit=CTE_LIMIT+65536){
 const reader=request.body?.getReader();if(!reader)throw Error('Anexe o CT-e.');
 const chunks=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw Error('Os arquivos anexados excedem o limite de tamanho permitido.');}chunks.push(value);}
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

export function createCteApi({backend,readPdf,readNfePdf=readPdf}){
 return async request=>{
  const actor=await backend.actor(request);if(!actor?.userId)return backend.responseJson({error:'Faça login para acessar o sistema.'},401);
  if(!actor.companyId)return backend.responseJson({error:'Sua conta não tem acesso a esta empresa.'},403);
  const path=new URL(request.url).pathname;
  if(request.method==='GET'&&path.endsWith('/api/ctes')){
   if(!['group','carrier','farm'].includes(actor.party)||actor.party==='farm'&&!actor.farmId)return backend.responseJson({error:'Sua conta não tem uma fazenda vinculada.'},403);
   const farmId=actor.party==='farm'?actor.farmId:null;
   const [rows,current,requests,preferences]=await Promise.all([backend.ctes.list(actor.companyId,farmId),backend.repository.load(actor.companyId),backend.cteRequests?.list(actor.companyId,farmId)||[],actor.party==='farm'?null:backend.ctes.getPreferences?.(actor.userId,actor.companyId)??null]);
   const state=current.state||{};
   const farms=(state.farms||[]).filter(f=>!farmId||f.id===farmId);
   const query=new URL(request.url).searchParams,month=query.get('month')||'',half=Number(query.get('half')),validAccrualPeriod=/^\d{4}-(0[1-9]|1[0-2])$/.test(month)&&[1,2].includes(half),accrualPeriod=validAccrualPeriod?period(month,half):null,asOf=today(),accrualSource=(actor.party==='carrier'||actor.party==='farm')&&accrualPeriod?(asOf<accrualPeriod.start?[]:accrualPeriod.end<asOf?periodRows(state,accrualPeriod):accruedRows(state,accrualPeriod,asOf)):null,accruals=accrualSource?.filter(row=>(actor.party!=='farm'||row.farmId===farmId)&&!state.trucks.find(truck=>truck.id===row.truckId)?.sample).map(({truckId,plate,driver,farmId,farmName,eligibleDays,payableDays,gross,discount,net})=>({truckId,plate,driver,farmId,farmName,eligibleDays,payableDays,gross,discount,net}));
   return backend.responseJson({documents:rows.map(({objectKey,...row})=>row),requests:requests.map(item=>({...item,invoiceFiles:(item.invoiceFiles||[]).map(({objectKey,...file})=>file)})),trucks:(state.trucks||[]).filter(t=>!farmId||t.farmId===farmId).map(t=>({id:t.id,plate:t.plate,driver:t.driver,farmId:t.farmId,start:t.start||'',end:t.end||'',serviceEnded:t.serviceEnded||null,transferIn:t.transferIn||null,transferOut:t.transferOut||null})),farms:farms.map(f=>({id:f.id,name:f.name,active:f.active!==false})),...(accruals?{accrualRows:accruals}:{}),preferences});
  }
  if(request.method==='POST'&&path.endsWith('/api/cte-requests')){
   if(actor.party!=='farm'||actor.role==='viewer'||!actor.farmId)return backend.responseJson({error:'Somente o funcionário da fazenda pode solicitar CT-e.'},403);
   const isMultipart=request.headers.get('Content-Type')?.toLowerCase().includes('multipart/form-data'),data=isMultipart?await boundedFormData(request,20*1024*1024+65536):null;
   const text=isMultipart?String(data.get('payload')||''):await request.text();if(text.length>12000)return backend.responseJson({error:'A solicitação excede o tamanho permitido.'},413);
   const body=JSON.parse(text),truckId=String(body.truckId||'');
   const invoiceFiles=[];if(data){if(data.getAll('invoiceFiles').some(file=>file&&typeof file.arrayBuffer==='function'&&file.size))throw Error('Esta solicitação aceita somente PDFs das NF-e.');const pdfFiles=data.getAll('invoicePdfs').filter(file=>file&&typeof file.arrayBuffer==='function'&&file.size);if(pdfFiles.length>10)throw Error('Anexe no máximo 10 PDFs de NF-e por solicitação.');let total=0;for(const file of pdfFiles){if(file.size>REQUEST_FILE_LIMIT)throw Error('Cada PDF deve ter até 10 MB.');total+=file.size;if(total>REQUEST_TOTAL_FILE_LIMIT)throw Error('A soma dos PDFs deve ter até 20 MB por solicitação.');const bytes=new Uint8Array(await file.arrayBuffer()),details=inspectNfePdf(bytes,file.name),text=await readNfePdf(bytes);details.vehiclePlate=extractNfeVehiclePlate(text);if(!details.vehiclePlate)throw Error(`Não consegui localizar a placa do veículo no PDF ${details.name}. Confira se o DANFE informa a placa no campo “Placa do veículo”.`);invoiceFiles.push({bytes,details});}}
   const invoiceKeys=[];
   if(!/^[\w-]{1,200}$/.test(truckId))throw Error('Selecione o caminhão da solicitação.');
   if(!invoiceFiles.length)throw Error('Anexe ao menos um PDF da NF-e ou DANFE.');
   const note=String(body.note||'').trim();if(note.length>500)throw Error('A observação deve ter até 500 caracteres.');
   const current=await backend.repository.load(actor.companyId),truck=(current.state.trucks||[]).find(item=>item.id===truckId&&item.farmId===actor.farmId&&!item.transferOut&&!item.end&&!item.serviceEnded),farm=(current.state.farms||[]).find(item=>item.id===actor.farmId);
   if(!truck||!farm)throw Error('Este caminhão não está disponível na fazenda vinculada ao seu acesso.');
   const selectedPlate=String(truck.plate||'').toUpperCase().replace(/[^A-Z0-9]/g,'');for(const {details} of invoiceFiles)if(details.vehiclePlate!==selectedPlate)throw Error(`A placa selecionada (${truck.plate}) é diferente da placa ${details.vehiclePlate} informada na NF-e ${details.name}. Confira o caminhão e os PDFs antes de solicitar.`);
   const saved=await backend.cteRequests.create(actor,truck,farm,invoiceKeys,note,invoiceFiles);return backend.responseJson(saved,201);
  }
  const requestFileMatch=path.match(/\/api\/cte-requests\/([0-9a-f-]{36})\/files\/([0-9a-f-]{36})$/i);
  if(request.method==='GET'&&requestFileMatch){
   if(!['farm','carrier','group'].includes(actor.party))return backend.responseJson({error:'Acesso não permitido.'},403);
   const item=await backend.cteRequests?.find(actor.companyId,requestFileMatch[1]);if(!item||actor.party==='farm'&&item.farmId!==actor.farmId)return backend.responseJson({error:'XML de NF-e não encontrado para esta solicitação.'},404);
   const invoiceFile=item.invoiceFiles?.find(file=>file.id===requestFileMatch[2]);if(!invoiceFile)return backend.responseJson({error:'XML de NF-e não encontrado.'},404);
   return backend.responseJson({name:invoiceFile.name,mime:invoiceFile.mime,signedUrl:await backend.cteRequests.signFile(invoiceFile),expiresIn:120});
  }
  if(request.method==='POST'&&path.endsWith('/api/ctes/preferences')){
   if(actor.party==='farm')return backend.responseJson({error:'A personalização do relatório não está disponível neste acesso.'},403);
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
   const dataRequestId=String(data.get('requestId')||'').trim(),cteRequest=dataRequestId?await backend.cteRequests?.find(actor.companyId,dataRequestId):null;
   if(dataRequestId&&(!cteRequest||cteRequest.status!=='pending'))throw Error('A solicitação não está mais pendente. Atualize a fila da fazenda.');
   if(cteRequest){const requestedNumbers=cteRequest.invoiceKeys.map(key=>String(Number(String(key).replace(/\D/g,'').slice(25,34)))),manifested=new Set((cte.manifestedNotes||[]).map(note=>String(Number(String(note).replace(/\D/g,'')))));if(requestedNumbers.some(number=>!manifested.has(number)))throw Error('Não encontrei no CT-e todas as NF-e solicitadas pela fazenda. Confira a manifestação das notas ou envie o XML original do CT-e.');}
   const current=await backend.repository.load(actor.companyId),normalizePlate=value=>String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,''),plateMatches=(current.state.trucks||[]).filter(t=>normalizePlate(t.plate)===cte.plate),dateMatches=plateMatches.filter(t=>(!t.start||t.start<=cte.issuedOn)&&(!t.end||t.end>=cte.issuedOn));
   const truck=dateMatches.length===1?dateMatches[0]:dateMatches.length===0&&plateMatches.length===1?plateMatches[0]:null;
   if(cteRequest&&(!truck||truck.id!==cteRequest.truckId||cte.plate!==normalizePlate(cteRequest.plate)))throw Error('A placa do CT-e precisa ser a mesma placa informada na solicitação da fazenda.');
   if(!plateMatches.length)throw Error('Não encontrei a placa '+cte.plate+' cadastrada. Confira a placa no cadastro do caminhão e tente novamente.');
   if(!truck)throw Error('Encontrei mais de um cadastro para a placa '+cte.plate+' e não consigo identificar a fazenda com segurança. Confira os períodos e as transferências desse caminhão.');
   const farm=current.state.farms?.find(f=>f.id===truck.farmId);if(!farm)throw Error('A fazenda vinculada à placa não foi encontrada.');
   if(cteRequest&&farm.id!==cteRequest.farmId)throw Error('O CT-e não corresponde à fazenda da solicitação.');
   const metadata={truckId:truck.id,farmId:farm.id,...cte,...(cteRequest?{requestId:cteRequest.id}:{})};
   const saved=await backend.ctes.upload(actor,metadata,bytes,details,{plate:cte.plate,driver:truck.driver,farmName:farm.name});
   return backend.responseJson(saved,201);
  }
  const match=path.match(/\/api\/ctes\/([0-9a-f-]{36})$/i);
  if(request.method==='GET'&&match){
   const doc=await backend.ctes.find(actor.companyId,match[1]);if(!doc)return backend.responseJson({error:'CT-e não encontrado para esta empresa.'},404);
   if(actor.party==='farm'&&(!actor.farmId||doc.farmId!==actor.farmId))return backend.responseJson({error:'CT-e não encontrado para esta fazenda.'},404);
   return backend.responseJson({name:doc.name,mime:doc.mime,signedUrl:await backend.ctes.sign(doc),expiresIn:120});
  }
  return backend.responseJson({error:'Método não permitido.'},405);
 };
}
