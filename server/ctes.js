export const CTE_LIMIT=20*1024*1024;
export const NFE_XML_LIMIT=10*1024*1024;
export const REQUEST_FILE_LIMIT=10*1024*1024;
export const REQUEST_TOTAL_FILE_LIMIT=20*1024*1024;
export const CTE_BILLING_RATE_PER_TON=2.70;
export const CTE_REPORT_COLUMNS=['number','shipper','recipient','serviceTaker','issuer','totalValue','issuedOn','plate','cargoWeight','manifestedNotes','shipperCity','shipperStateRegistration','shipperDocument','recipientCity','recipientStateRegistration','recipientDocument','serviceTakerCity','serviceTakerStateRegistration','serviceTakerDocument','issuerCity','issuerStateRegistration','issuerDocument'];
const businessToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Cuiaba'}).format(new Date());

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
 const accessKey=cleanName.match(/\d{44}/)?.[0]||'';
 return {name:cleanName,mime:'application/pdf',extension:'pdf',size:bytes.length,accessKey};
}
const extractAccessKeys=text=>String(text||'').split(/\r?\n/).map(line=>digits(line)).filter(key=>key.length===44);
const billableTons=(weight,unit)=>{const value=Number(weight);if(!Number.isFinite(value)||value<0)return null;const tons=unit==='t'?value:value/1000;return Number(tons.toFixed(3));};
const billingAmount=(tons,rate=CTE_BILLING_RATE_PER_TON)=>tons==null?null:Number((tons*rate).toFixed(2));
export function extractNfeVehiclePlate(text){
 const normalized=String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleUpperCase('pt-BR');
 const platePattern=/(?:^|[\s:;|/])([A-Z]{3}\s*[-/]?\s*(?:\d[A-Z0-9]\d{2}|\d{4}))(?![A-Z0-9])/g;
 const firstPlate=source=>{
  for(const match of String(source||'').matchAll(platePattern)){
   const plate=match[1].replace(/[^A-Z0-9]/g,'');
   if(/^[A-Z]{3}(?:\d[A-Z0-9]\d{2}|\d{4})$/.test(plate))return plate;
  }
  return '';
 };
 const sources=[],transportStart=normalized.search(/\b(?:TRANSPORTADOR|DADOS\s+DO\s+TRANSPORTADOR|VOLUMES\s+TRANSPORTADOS)\b/);
 if(transportStart>=0)sources.push(normalized.slice(transportStart,transportStart+2600));
 for(const label of normalized.matchAll(/\bPLACA(?:\s+DO)?\s+(?:VEICULO|VEICULO\/UF)|\bPLACA\s*\/\s*UF\b|\bPLACA\b/g))sources.push(normalized.slice(label.index+label[0].length,label.index+label[0].length+500));
 sources.push(normalized);
 for(const source of sources){const plate=firstPlate(source);if(plate)return plate;}
 return '';
}
const nfeDocuments=section=>[...String(section||'').matchAll(/\b(?:\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2}|\d{14}|\d{11})\b/g)].map(match=>digits(match[0]));
const nfeFieldDigits=(section,labels)=>{
 const source=String(section||''),labelPattern=labels.map(label=>label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|');
 for(const match of source.matchAll(new RegExp(`(?:${labelPattern})\\s*(?:[:=]|\\s)?\\s*((?:\\d[.\\-/ ]?){11,18})`,'gi'))){
  const value=digits(match[1]);
  if(value.length===11||value.length===14)return value;
 }
 return '';
};
const nfeFieldStateRegistration=(section)=>{
 const source=String(section||''),labels='(?:INSCRI(?:CAO|ÇAO)|INSCR(?:ICAO|\.?)|I\\.?E\\.?)\\s*(?:ESTADUAL)?';
 for(const match of source.matchAll(new RegExp(`${labels}\\s*(?:[:=]|\\s)?\\s*((?:\\d[.\\-/ ]?){8,18})`,'gi'))){
  const value=digits(match[1]);
  if(value.length>=8&&value.length<=14)return value;
 }
 return '';
};
const nfeStateRegistrationCandidates=(section,document)=>{
 const lines=String(section||'').split(/\r?\n/),values=[];
 for(let index=0;index<lines.length;index++){
  const line=plain(lines[index]).replace(/�/g,' ');
  if(!/(?:INSCRI|INSCR|\bIE\b)/.test(line))continue;
  const nearby=lines.slice(index,index+4).join(' ');
  for(const match of nearby.matchAll(/(?<!\d)(?:\d[.\-/]?){8,14}(?!\d)/g)){
   const value=digits(match[0]);
   if(value.length>=8&&value.length<=14&&value!==document&&!values.includes(value))values.push(value);
  }
 }
 return values;
};
 function nfeParty(section){
 const document=nfeFieldDigits(section,['CNPJ OU CPF','CNPJ / CPF','CPF / CNPJ','CNPJ','CPF'])||nfeDocuments(section).find(value=>value.length===11||value.length===14)||'';
 const stateRegistrations=nfeStateRegistrationCandidates(section,document),stateRegistration=stateRegistrations[0]||nfeFieldStateRegistration(section)||nfeDocuments(section).find(value=>value.length>=8&&value.length<=14&&value!==document)||'';
 return {document,stateRegistration,stateRegistrations};
}
export function extractNfeParties(text){
 const normalized=plain(text).replace(/�/g,' '),startMatch=normalized.match(/DESTINAT\s*RIO\s*(?:\/\s*REMETENTE)?|DESTINATARIO\s*(?:\/\s*REMETENTE)?|REMETENTE\s*\/\s*DESTINATARIO/),start=startMatch?.index??-1;
 if(start<0)return {issuer:{document:'',stateRegistration:''},recipient:{document:'',stateRegistration:''}};
 const end=normalized.slice(start).search(/CALCULO DO (?:IMPOSTO|ICMS)|TRANSPORTADOR\s*\/\s*VOLUMES|TRANSPORTADOR\s*VOLUMES/),recipientEnd=end<0?start+3000:start+end;
 return {issuer:nfeParty(normalized.slice(0,start)),recipient:nfeParty(normalized.slice(start,recipientEnd))};
}
function assertNfePartiesMatchFarm(parties,farm,name){
 const document=digits(farm.cnpj||farm.cpf||farm.document),stateRegistration=digits(farm.stateRegistration);
 if(![11,14].includes(document.length)||stateRegistration.length<8)throw Error(`Complete o CPF/CNPJ e a inscrição estadual da ${farm.name} antes de solicitar CT-e.`);
 const candidates=[parties.issuer,parties.recipient];
 if(candidates.some(party=>party?.document===document&&(party.stateRegistration===stateRegistration||party.stateRegistrations?.includes(stateRegistration))))return parties;
 if(candidates.some(party=>!party?.document||party.document===document&&!party.stateRegistration))throw Error(`Não consegui conferir o CPF/CNPJ e a inscrição estadual no PDF ${name}. Anexe um DANFE legível.`);
 throw Error(`A NF-e ${name} não corresponde à ${farm.name}: CPF/CNPJ e inscrição estadual do emitente ou destinatário devem ser os da fazenda vinculada ao acesso.`);
}
export function assertNfeMatchesFarm(text,farm,name){return assertNfePartiesMatchFarm(extractNfeParties(text),farm,name);}
const parseBrazilianWeight=value=>{const token=String(value||'').trim().replace(/\s/g,'');if(!token)return null;const normalized=token.includes(',')?token.replace(/\./g,'').replace(',','.'):token.replace(/\.(?=\d{3}(?:\D|$))/g,'');const number=Number(normalized);return Number.isFinite(number)&&number>=0?Number(number.toFixed(3)):null;};
export function extractNfeCargoWeight(text){
 const lines=String(text||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean),folded=lines.map(plain),index=folded.findIndex(line=>line.includes('PESO BRUTO'));if(index<0)return {cargoWeight:null,cargoWeightUnit:null};
 const header=folded[index],block=lines.slice(index,index+5).join(' '),direct=block.match(/PESO\s+BRUTO[\s\S]{0,120}?([\d.,]+)\s*(KG|KGS|T|TON|TONELADAS)?\b/i),numberFrom=value=>parseBrazilianWeight(value),unitFrom=value=>/^(T|TON|TONELADAS)$/i.test(value||'')?'t':'kg';
 if(direct){const value=numberFrom(direct[1]);if(value!==null)return {cargoWeight:Number((value*(unitFrom(direct[2])==='t'?1000:1)).toFixed(3)),cargoWeightUnit:'kg'};}
 for(const row of lines.slice(index+1,index+4)){
  const tokens=[...row.matchAll(/(?<![A-Z0-9])\d[\d.,]*(?![A-Z0-9])/g)].map(match=>match[0]);if(!tokens.length)continue;
  const token=header.includes('PESO LIQUIDO')&&tokens.length>1?tokens[1]:tokens[0],value=numberFrom(token);if(value!==null)return {cargoWeight:Number(value.toFixed(3)),cargoWeightUnit:'kg'};
 }
 const productStart=folded.findIndex(line=>line.includes('DADOS DOS PRODUTOS')),productEnd=productStart>=0?folded.findIndex((line,lineIndex)=>lineIndex>productStart&&/(CALCULO DO ISSQN|INFORMACOES COMPLEMENTARES)/.test(line)):-1,productLines=productStart>=0?lines.slice(productStart+1,productEnd>=0?productEnd:productStart+80):[];
 let productKg=0,productKgFound=false;
 for(const row of productLines){
  for(const match of row.matchAll(/\b(?:KG|KGS)\s+([\d.,]+)/gi)){const value=numberFrom(match[1]);if(value!==null){productKg+=value;productKgFound=true;}}
 }
 if(productKgFound)return {cargoWeight:Number(productKg.toFixed(3)),cargoWeightUnit:'kg',cargoWeightSource:'product-quantity',cargoWeightComplete:false};
 return {cargoWeight:null,cargoWeightUnit:null};
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
 const cte=xmlElement(xml,'CTe')||xml,inf=xmlElement(cte,'infCte')||cte,ide=xmlElement(inf,'ide'),issuer=xmlElement(inf,'emit'),recipient=xmlElement(inf,'dest'),service=xmlElement(inf,'vPrest'),normalized=xmlElement(inf,'infCTeNorm'),cargo=xmlElement(normalized,'infCarga'),weightEntry=xmlElements(cargo,'infQ').find(entry=>/PESO/i.test(xmlText(entry,'tpMed'))),weightValue=xmlText(weightEntry||'','qCarga'),weightUnitCode=xmlText(weightEntry||'','cUnid'),cargoWeight=weightValue&&Number.isFinite(Number(weightValue))?Number(Number(weightValue).toFixed(3)):null,cargoWeightUnit=weightUnitCode==='01'?'kg':weightUnitCode==='02'?'t':null,modal=xmlElement(normalized,'infModal'),road=xmlElement(modal,'rodo'),vehicle=xmlElement(road,'veic');
 const shipperParty=xmlElement(inf,'rem'),recipientParty=xmlElement(inf,'dest'),expeditorParty=xmlElement(inf,'exped'),receiverParty=xmlElement(inf,'receb'),issuerName=xmlText(issuer,'xNome'),recipientName=xmlText(recipientParty,'xNome'),shipperName=xmlText(shipperParty,'xNome'),explicitTaker=xmlElement(ide,'toma4')||xmlElement(inf,'toma4'),takerCode=xmlText(xmlElement(ide,'toma3'),'toma'),takerParty=explicitTaker||({0:shipperParty,1:expeditorParty,2:receiverParty,3:recipientParty}[takerCode]||''),serviceTakerName=xmlText(explicitTaker,'xNome')||xmlText(takerParty,'xNome'),rawValue=xmlText(service,'vTPrest'),rawIssued=xmlText(ide,'dhEmi')||xmlText(ide,'dEmi'),issuedOn=rawIssued.match(/^\d{4}-\d{2}-\d{2}/)?.[0]||'',plate=xmlText(vehicle,'placa').toUpperCase().replace(/[^A-Z0-9]/g,''),number=xmlText(ide,'nCT');
 const totalValue=Number(rawValue),parsedDate=new Date(issuedOn+'T00:00:00Z');
 if(!issuerName||!recipientName||!shipperName||!serviceTakerName||!Number.isFinite(totalValue)||totalValue<0||totalValue>999999999999.99||!/^\d{4}-\d{2}-\d{2}$/.test(issuedOn)||!Number.isFinite(parsedDate.getTime())||parsedDate.toISOString().slice(0,10)!==issuedOn||plate.length<7||plate.length>8)throw Error('Não consegui ler todos os dados necessários no XML. Envie o XML original do CT-e, não o DACTE em PDF.');
 const manifestedKeys=[...new Set(xmlElements(xmlElement(normalized,'infDoc'),'infNFe').map(entry=>xmlText(entry,'chave').replace(/\D/g,'')).filter(key=>key.length===44))].slice(0,100);
 return {issuer:issuerName.slice(0,160),recipient:recipientName.slice(0,160),shipper:shipperName.slice(0,160),serviceTaker:serviceTakerName.slice(0,160),participantDetails:{issuer:xmlParty(issuer,'enderEmit'),shipper:xmlParty(shipperParty,'enderReme'),recipient:xmlParty(recipientParty,'enderDest'),serviceTaker:xmlParty(takerParty,'enderToma')},totalValue:Number(totalValue.toFixed(2)),issuedOn,plate,number:number.slice(0,40),cargoWeight,cargoWeightUnit,manifestedNotes:manifestedNotesFromXml(normalized),manifestedKeys};
}

const plain=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleUpperCase('pt-BR');
const amounts=value=>[...String(value||'').matchAll(/(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}/g)].map(match=>Number(match[0].replace(/\./g,'').replace(',','.'))).filter(Number.isFinite);
const dates=value=>[...String(value||'').matchAll(/\b(\d{2})\/(\d{2})\/(\d{2}|\d{4})\b/g)].map(match=>{const year=match[3].length===2?'20'+match[3]:match[3],iso=year+'-'+match[2]+'-'+match[1],date=new Date(iso+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===iso?iso:'';}).filter(Boolean);
export function parseCtePdfText(text){
 const lines=String(text||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean),folded=lines.map(plain);
 let issuer='',recipient='',shipper='',serviceTaker='',totalValue=null,issuedOn='',plate='',cargoWeight=null,cargoWeightUnit=null;
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
 const weightIndex=folded.findIndex(line=>line.includes('PESO BRUTO')||line.includes('PESO DA CARGA')||line.includes('PESO TOTAL'));if(weightIndex>=0){const weightText=lines.slice(weightIndex,weightIndex+3).join(' '),weightMatch=weightText.match(/(?:PESO\s+(?:BRUTO|DA\s+CARGA|TOTAL))\s*[:=]?\s*([\d.,]+)\s*(KG|KGS|T|TON|TONELADAS)?\b/i);if(weightMatch){const token=weightMatch[1],normalizedNumber=token.includes(',')?token.replace(/\./g,'').replace(',','.'):token.replace(/\.(?=\d{3}(?:\D|$))/g,''),value=Number(normalizedNumber);if(Number.isFinite(value)&&value>=0){cargoWeight=Number(value.toFixed(3));cargoWeightUnit=/^(T|TON|TONELADAS)$/i.test(weightMatch[2]||'')?'t':'kg';}}}
 if(cargoWeight===null){for(let index=0;index<lines.length;index++){if(!folded[index].includes('CARGA'))continue;const context=folded.slice(Math.max(0,index-4),index+1).join(' ');if(!context.includes('QTD'))continue;const weightText=lines.slice(index,Math.min(lines.length,index+3)).join(' '),weightMatch=weightText.match(/\b(KG|KGS|TON|TONELADAS|T)\s*([\d.,]+)\b/i);if(!weightMatch)continue;const token=weightMatch[2],normalizedNumber=token.includes(',')?token.replace(/\./g,'').replace(',','.'):token.replace(/\.(?=\d{3}(?:\D|$))/g,''),value=Number(normalizedNumber);if(Number.isFinite(value)&&value>=0){cargoWeight=Number(value.toFixed(3));cargoWeightUnit=/^(T|TON|TONELADAS)$/i.test(weightMatch[1])?'t':'kg';break;}}}
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
 const manifestedKeys=[...new Set(extractAccessKeys(documentBlock))].slice(0,100);
 return {issuer:issuer.slice(0,160),recipient:recipient.slice(0,160),shipper:shipper.slice(0,160),serviceTaker:serviceTaker.slice(0,160),participantDetails,totalValue:Number(totalValue.toFixed(2)),issuedOn,plate,number:number.slice(0,40),cargoWeight,cargoWeightUnit,manifestedNotes:uniqueManifestedNotes,manifestedKeys};
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
export function inspectCtePaymentProof(bytes,name){
 if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>REQUEST_FILE_LIMIT)throw Error('O comprovante deve ter até 10 MB.');
 const cleanName=String(name||'').split(/[\\/]/).at(-1).replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,160),extension=cleanName.toLowerCase().split('.').at(-1),header=new TextDecoder().decode(bytes.slice(0,12));
 const mime=extension==='pdf'&&header.includes('%PDF-')?'application/pdf':extension==='png'&&bytes[0]===0x89&&header.slice(1,4)==='PNG'?'image/png':['jpg','jpeg'].includes(extension)&&bytes[0]===0xff&&bytes[1]===0xd8?'image/jpeg':'';
 if(!cleanName||!mime)throw Error('Anexe um comprovante válido em PDF, JPG ou PNG.');
 return {name:cleanName,mime,extension:extension==='jpeg'?'jpg':extension,size:bytes.length};
}

export function createCteApi({backend,readPdf,readNfePdf=readPdf}){
 return async request=>{
  const actor=await backend.actor(request);if(!actor?.userId)return backend.responseJson({error:'Faça login para acessar o sistema.'},401);
  if(!actor.companyId)return backend.responseJson({error:'Sua conta não tem acesso a esta empresa.'},403);
  const path=new URL(request.url).pathname;
  if(request.method==='GET'&&path.endsWith('/api/ctes')){
   if(!['group','carrier','farm'].includes(actor.party)||actor.party==='farm'&&!actor.farmId)return backend.responseJson({error:'Sua conta não tem uma fazenda vinculada.'},403);
   const farmId=actor.party==='farm'?actor.farmId:null;
   const [rows,current,requests,preferences,billingInvoices]=await Promise.all([backend.ctes.list(actor.companyId,farmId),backend.repository.load(actor.companyId),backend.cteRequests?.list(actor.companyId,farmId)||[],actor.party==='farm'?null:backend.ctes.getPreferences?.(actor.userId,actor.companyId)??null,['group','carrier'].includes(actor.party)?backend.ctes.listBillingInvoices?.(actor.companyId)||[]:[]]);
   const state=current.state||{};
   const farms=(state.farms||[]).filter(f=>!farmId||f.id===farmId);
   if(backend.ctes.download&&backend.ctes.saveWeight){await Promise.all(rows.filter(row=>!row.cargoWeightChecked&&row.objectKey).map(async row=>{try{const bytes=await backend.ctes.download(row),metadata=row.mime==='application/xml'?parseCteXml(bytes):parseCtePdfText(await readPdf(bytes));row.cargoWeight=metadata.cargoWeight;row.cargoWeightUnit=metadata.cargoWeightUnit;row.billableTons=billableTons(metadata.cargoWeight,metadata.cargoWeightUnit);row.billingRate=CTE_BILLING_RATE_PER_TON;row.billingAmount=billingAmount(row.billableTons);row.cargoWeightChecked=true;await backend.ctes.saveWeight(actor.companyId,row.id,metadata.cargoWeight,metadata.cargoWeightUnit);}catch{}}));}
   return backend.responseJson({documents:rows.map(({objectKey,cargoWeightChecked,...row})=>({...row,paymentReceipt:row.paymentReceipt?(({objectKey,uploadedBy,...receipt})=>receipt)(row.paymentReceipt):null})),requests:requests.map(item=>({...item,invoiceFiles:(item.invoiceFiles||[]).map(({objectKey,parties,...file})=>file)})),billingInvoices:billingInvoices.map(({companyId,paymentReceipt,...invoice})=>({...invoice,paymentReceipt:paymentReceipt?(({objectKey,uploadedBy,...receipt})=>receipt)(paymentReceipt):null})),trucks:(state.trucks||[]).filter(t=>!farmId||t.farmId===farmId).map(t=>({id:t.id,plate:t.plate,driver:t.driver,farmId:t.farmId,start:t.start||'',end:t.end||'',serviceEnded:t.serviceEnded||null,transferIn:t.transferIn||null,transferOut:t.transferOut||null})),farms:farms.map(f=>({id:f.id,name:f.name,active:f.active!==false})),preferences});
  }
  if(request.method==='POST'&&path.endsWith('/api/cte-requests')){
   if(actor.party!=='farm'||actor.role==='viewer'||!actor.farmId)return backend.responseJson({error:'Somente o funcionário da fazenda pode solicitar CT-e.'},403);
   const isMultipart=request.headers.get('Content-Type')?.toLowerCase().includes('multipart/form-data'),data=isMultipart?await boundedFormData(request,20*1024*1024+65536):null;
   const text=isMultipart?String(data.get('payload')||''):await request.text();if(text.length>12000)return backend.responseJson({error:'A solicitação excede o tamanho permitido.'},413);
   const body=JSON.parse(text),truckId=String(body.truckId||'');
   const invoiceFiles=[];if(data){if(data.getAll('invoiceFiles').some(file=>file&&typeof file.arrayBuffer==='function'&&file.size))throw Error('Esta solicitação aceita somente PDFs das NF-e.');const pdfFiles=data.getAll('invoicePdfs').filter(file=>file&&typeof file.arrayBuffer==='function'&&file.size);if(pdfFiles.length>10)throw Error('Anexe no máximo 10 PDFs de NF-e por solicitação.');let total=0;for(const file of pdfFiles){if(file.size>REQUEST_FILE_LIMIT)throw Error('Cada PDF deve ter até 10 MB.');total+=file.size;if(total>REQUEST_TOTAL_FILE_LIMIT)throw Error('A soma dos PDFs deve ter até 20 MB por solicitação.');const bytes=new Uint8Array(await file.arrayBuffer()),details=inspectNfePdf(bytes,file.name),text=await readNfePdf(bytes);details.accessKey||=extractAccessKeys(text)[0]||'';details.vehiclePlate=extractNfeVehiclePlate(text);details.parties=extractNfeParties(text);Object.assign(details,extractNfeCargoWeight(text));if(!details.vehiclePlate)throw Error(`Não consegui localizar a placa do veículo no PDF ${details.name}. Confira se o DANFE informa a placa no campo “Placa do veículo”.`);invoiceFiles.push({bytes,details});}const correctionFiles=data.getAll('correctionFile').filter(file=>file&&typeof file.arrayBuffer==='function'&&file.size);if(correctionFiles.length>1)throw Error('Anexe no máximo uma carta de correção por solicitação.');for(const file of correctionFiles){if(file.size>REQUEST_FILE_LIMIT)throw Error('A carta de correção deve ter até 10 MB.');const bytes=new Uint8Array(await file.arrayBuffer()),details=inspectNfePdf(bytes,file.name);details.documentType='correction';invoiceFiles.push({bytes,details});}}
   const invoiceKeys=[];
   if(!/^[\w-]{1,200}$/.test(truckId))throw Error('Selecione o caminhão da solicitação.');
   if(!invoiceFiles.length)throw Error('Anexe ao menos um PDF da NF-e ou DANFE.');
   const note=String(body.note||'').trim();if(note.length>500)throw Error('A observação deve ter até 500 caracteres.');
   const current=await backend.repository.load(actor.companyId),truck=(current.state.trucks||[]).find(item=>item.id===truckId&&item.farmId===actor.farmId&&!item.transferOut&&!item.end&&!item.serviceEnded),farm=(current.state.farms||[]).find(item=>item.id===actor.farmId);
   if(!truck||!farm)throw Error('Este caminhão não está disponível na fazenda vinculada ao seu acesso.');
   for(const {details} of invoiceFiles)if(details.documentType!=='correction')assertNfePartiesMatchFarm(details.parties,farm,details.name);
   const selectedPlate=String(truck.plate||'').toUpperCase().replace(/[^A-Z0-9]/g,'');for(const {details} of invoiceFiles)if(details.documentType!=='correction'&&details.vehiclePlate!==selectedPlate)throw Error(`A placa selecionada (${truck.plate}) é diferente da placa ${details.vehiclePlate} informada na NF-e ${details.name}. Confira o caminhão e os PDFs antes de solicitar.`);
   const noteFiles=invoiceFiles.filter(file=>file.details.documentType!=='correction'),plates=[...new Set(noteFiles.map(file=>file.details.vehiclePlate).filter(Boolean))];
   if(plates.length>1)throw Error(`As NF-e anexadas informam placas diferentes (${plates.join(' e ')}). Selecione somente notas da mesma placa para este manifesto.`);
   const requestedKeys=noteFiles.map(file=>file.details.accessKey).filter(Boolean);if(new Set(requestedKeys).size!==requestedKeys.length)throw Error('A mesma NF-e foi anexada mais de uma vez nesta solicitação.');
   if(requestedKeys.length){const [priorRequests,priorDocuments]=await Promise.all([backend.cteRequests.list(actor.companyId),backend.ctes.list(actor.companyId)]),known=new Set();for(const prior of priorRequests)if(prior.status!=='cancelled'&&prior.status!=='canceled')for(const file of prior.invoiceFiles||[]){const key=file.accessKey||String(file.name||'').match(/\d{44}/)?.[0];if(key)known.add(key);}for(const doc of priorDocuments){let keys=doc.participantDetails?.manifestedKeys||doc.manifestedKeys||[];if(!keys.length&&doc.objectKey&&backend.ctes.download){try{const bytes=await backend.ctes.download(doc),parsed=doc.mime==='application/xml'?parseCteXml(bytes):parseCtePdfText(await readPdf(bytes));keys=parsed.manifestedKeys||[];}catch{}}for(const key of keys)if(/^\d{44}$/.test(String(key)))known.add(String(key));}const duplicate=requestedKeys.find(key=>known.has(key));if(duplicate)throw Error(`A NF-e com chave ${duplicate} já foi solicitada ou manifestada em um CT-e. Confira as solicitações concluídas antes de continuar.`);}
   invoiceKeys.push(...requestedKeys);
   const saved=await backend.cteRequests.create(actor,truck,farm,invoiceKeys,note,invoiceFiles);return backend.responseJson(saved,201);
  }
  const cancelRequestMatch=path.match(/\/api\/cte-requests\/([0-9a-f-]{36})\/cancel$/i);
  if(request.method==='POST'&&cancelRequestMatch){
   const pending=await backend.cteRequests.find(actor.companyId,cancelRequestMatch[1]);
   if(!pending||pending.status!=='pending')return backend.responseJson({error:'Esta solicitação não está mais pendente.'},404);
   if(actor.role==='viewer'||!['group','carrier','farm'].includes(actor.party)||actor.party==='farm'&&actor.farmId!==pending.farmId)return backend.responseJson({error:'Você não pode cancelar a solicitação desta fazenda.'},403);
   return backend.responseJson({request:await backend.cteRequests.cancel(actor.companyId,pending.id)});
  }
  const requestFileMatch=path.match(/\/api\/cte-requests\/([0-9a-f-]{36})\/files\/([0-9a-f-]{36})$/i);
  if(request.method==='GET'&&requestFileMatch){
   if(!['farm','carrier','group'].includes(actor.party))return backend.responseJson({error:'Acesso não permitido.'},403);
   const item=await backend.cteRequests?.find(actor.companyId,requestFileMatch[1]);if(!item||actor.party==='farm'&&item.farmId!==actor.farmId)return backend.responseJson({error:'XML de NF-e não encontrado para esta solicitação.'},404);
   const invoiceFile=item.invoiceFiles?.find(file=>file.id===requestFileMatch[2]);if(!invoiceFile)return backend.responseJson({error:'XML de NF-e não encontrado.'},404);
   return backend.responseJson({name:invoiceFile.name,mime:invoiceFile.mime,signedUrl:await backend.cteRequests.signFile(invoiceFile),expiresIn:120});
  }
  if(request.method==='POST'&&path.endsWith('/api/cte-billing-invoices')){
   if(actor.party!=='group'||!['admin','operator'].includes(actor.role))return backend.responseJson({error:'Somente usuários autorizados do grupo podem emitir faturas.'},403);
   const text=await request.text();if(text.length>40000)return backend.responseJson({error:'Pedido muito grande.'},413);const body=JSON.parse(text),documentIds=body.documentIds,dueOn=String(body.dueOn||'');
   if(!Array.isArray(documentIds)||!documentIds.length||documentIds.length>500||documentIds.some(id=>typeof id!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))||new Set(documentIds).size!==documentIds.length)return backend.responseJson({error:'Selecione de 1 a 500 CT-es diferentes para faturar.'},400);
   const dueDate=/^\d{4}-\d{2}-\d{2}$/.test(dueOn)?new Date(dueOn+'T00:00:00Z'):null;if(!dueDate||!Number.isFinite(dueDate.getTime())||dueDate.toISOString().slice(0,10)!==dueOn||dueOn<businessToday())return backend.responseJson({error:'Informe um vencimento válido a partir de hoje.'},400);
   const invoice=await backend.ctes.issueBillingInvoice(actor,documentIds,dueOn);return backend.responseJson({invoice},201);
  }
  const invoicePaymentMatch=path.match(/\/api\/cte-billing-invoices\/([0-9a-f-]{36})\/payment-proof$/i);
  if(invoicePaymentMatch&&request.method==='POST'){
   if(actor.party!=='group'||!['admin','operator'].includes(actor.role))return backend.responseJson({error:'Somente usuários autorizados do grupo podem quitar faturas.'},403);
   const data=await boundedFormData(request,REQUEST_FILE_LIMIT+65536),file=data.get('paymentProof');if(!file||typeof file.arrayBuffer!=='function'||!file.size)throw Error('Anexe o comprovante do pagamento.');const bytes=new Uint8Array(await file.arrayBuffer()),details=inspectCtePaymentProof(bytes,file.name),result=await backend.ctes.payBillingInvoice(actor,invoicePaymentMatch[1],bytes,details);return backend.responseJson(result,201);
  }
  if(invoicePaymentMatch&&request.method==='GET'){
   if(!['group','carrier'].includes(actor.party)||actor.party==='group'&&!['admin','operator','viewer'].includes(actor.role))return backend.responseJson({error:'Acesso não permitido.'},403);const invoices=await backend.ctes.listBillingInvoices?.(actor.companyId)||[],invoice=invoices.find(item=>item.id===invoicePaymentMatch[1]);if(!invoice||!invoice.paymentReceipt)return backend.responseJson({error:'Comprovante não encontrado para esta fatura.'},404);return backend.responseJson({name:invoice.paymentReceipt.name,mime:invoice.paymentReceipt.mime,signedUrl:await backend.ctes.signInvoicePaymentProof(invoice.paymentReceipt),expiresIn:120});
  }
  const paymentProofMatch=path.match(/\/api\/ctes\/([0-9a-f-]{36})\/payment-proof$/i);
  if(request.method==='POST'&&path.endsWith('/api/cte-payment-batches')){
   const canPayFarm=actor.party==='farm'&&actor.role!=='viewer'&&actor.farmId;
   if(!canPayFarm)return backend.responseJson({error:'Somente usuários autorizados da fazenda podem enviar o comprovante.'},403);
   const data=await boundedFormData(request,REQUEST_FILE_LIMIT+65536),file=data.get('paymentProof');let documentIds=[];
   try{documentIds=JSON.parse(String(data.get('documentIds')||''));}catch{}
   if(!Array.isArray(documentIds)||!documentIds.length||documentIds.length>500||documentIds.some(id=>typeof id!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))||new Set(documentIds).size!==documentIds.length)return backend.responseJson({error:'Selecione de 1 a 500 CT-es diferentes para pagar.'},400);
   if(!file||typeof file.arrayBuffer!=='function'||!file.size)throw Error('Anexe o comprovante de pagamento.');
   const bytes=new Uint8Array(await file.arrayBuffer()),details=inspectCtePaymentProof(bytes,file.name),documents=await backend.ctes.recordPaymentBatch(actor,documentIds,bytes,details);
   return backend.responseJson({documents:documents.map(document=>({id:document.id,paidAt:document.paymentReceipt?.paidAt,paymentReceipt:(({objectKey,uploadedBy,...receipt})=>receipt)(document.paymentReceipt)}))},201);
  }
  if(request.method==='POST'&&paymentProofMatch){
   if(actor.party!=='farm'||actor.role==='viewer'||!actor.farmId)return backend.responseJson({error:'Somente um usuário autorizado da fazenda pode enviar o comprovante.'},403);
   const data=await boundedFormData(request,REQUEST_FILE_LIMIT+65536),file=data.get('paymentProof');if(!file||typeof file.arrayBuffer!=='function'||!file.size)throw Error('Anexe o comprovante de pagamento.');
   const bytes=new Uint8Array(await file.arrayBuffer()),details=inspectCtePaymentProof(bytes,file.name),document=await backend.ctes.recordPayment(actor,paymentProofMatch[1],bytes,details);
   return backend.responseJson({document:{id:document.id,paidAt:document.paymentReceipt?.paidAt,paymentReceipt:(({objectKey,uploadedBy,...receipt})=>receipt)(document.paymentReceipt)}},201);
  }
  if(request.method==='GET'&&paymentProofMatch){
   if(!['group','carrier','farm'].includes(actor.party))return backend.responseJson({error:'Acesso não permitido.'},403);
   const document=await backend.ctes.find(actor.companyId,paymentProofMatch[1]);if(!document||actor.party==='farm'&&document.farmId!==actor.farmId)return backend.responseJson({error:'Comprovante não encontrado para esta fazenda.'},404);
   if(!document.paymentReceipt)return backend.responseJson({error:'Este CT-e ainda não tem comprovante de pagamento.'},404);
   return backend.responseJson({name:document.paymentReceipt.name,mime:document.paymentReceipt.mime,signedUrl:await backend.ctes.signPaymentProof(document.paymentReceipt),expiresIn:120});
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
   const dataRequestId=String(data.get('requestId')||'').trim(),cteRequest=dataRequestId?await backend.cteRequests?.find(actor.companyId,dataRequestId):null,confirmPlateCorrection=data.get('confirmPlateCorrection')==='true',confirmWeightCheck=data.get('confirmWeightCheck')==='true',confirmHighValue=data.get('confirmHighValue')==='true';
   const highValueThreshold=10000;
   if(cte.totalValue>highValueThreshold&&!confirmHighValue){const formatted=cte.totalValue.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}),error=Error(`O valor do CT-e é ${formatted}, acima de R$ 10.000,00. Confira o valor e confirme antes de enviar.`);error.code='CTE_HIGH_VALUE';throw error;}
   if(dataRequestId&&(!cteRequest||cteRequest.status!=='pending'))throw Error('A solicitação não está mais pendente. Atualize a fila da fazenda.');
   if(cteRequest){const requestedNumbers=[...new Set(cteRequest.invoiceKeys.map(key=>String(Number(String(key).replace(/\D/g,'').slice(25,34)))))],manifested=new Set((cte.manifestedNotes||[]).map(note=>String(Number(String(note).replace(/\D/g,''))))),missing=requestedNumbers.filter(number=>!manifested.has(number));if(missing.length)throw Error(`O CT-e não manifestou a(s) NF-e ${missing.join(', ')} solicitada(s) pela fazenda. A solicitação contém ${requestedNumbers.length} nota(s); confira se todas foram incluídas no mesmo CT-e ou envie o XML original.`);const manifestedKeys=new Set(cte.manifestedKeys||[]),missingKeys=manifestedKeys.size?cteRequest.invoiceKeys.filter(key=>!manifestedKeys.has(key)):[];if(missingKeys.length)throw Error(`O XML do CT-e não contém a chave de acesso da(s) NF-e ${missingKeys.join(', ')} solicitada(s). Confira os documentos manifestados.`);}
   const current=await backend.repository.load(actor.companyId),normalizePlate=value=>String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,''),plateMatches=(current.state.trucks||[]).filter(t=>normalizePlate(t.plate)===cte.plate),dateMatches=plateMatches.filter(t=>(!t.start||t.start<=cte.issuedOn)&&(!t.end||t.end>=cte.issuedOn));
   const correctionFiles=(cteRequest?.invoiceFiles||[]).filter(file=>file.documentType==='correction'||/carta[-_ ]?corre[cç][aã]o|correction/i.test(file.name||'')),requestedTruck=cteRequest?(current.state.trucks||[]).find(t=>t.id===cteRequest.truckId&&t.farmId===cteRequest.farmId):null,plateMismatch=Boolean(cteRequest&&cte.plate!==normalizePlate(cteRequest.plate));
   if(cteRequest){
    if(!requestedTruck)throw Error('O caminhão vinculado à solicitação não está mais cadastrado nesta fazenda. Atualize os dados antes de enviar.');
    if(plateMismatch&&(!correctionFiles.length||!confirmPlateCorrection))throw Error( correctionFiles.length?'O CT-e informa a placa '+cte.plate+', mas a solicitação é da placa '+cteRequest.plate+'. Confira a carta de correção e marque a confirmação antes de enviar.':'A placa do CT-e precisa ser a mesma placa informada na solicitação da fazenda.');
    const requestFarm=(current.state.farms||[]).find(item=>item.id===cteRequest.farmId),notes=(cteRequest.invoiceFiles||[]).filter(file=>!correctionFiles.includes(file));
    if(!requestFarm||!notes.length)throw Error('A solicitação não tem fazenda e NF-e válidas para conferência. Solicite um novo pedido.');
    for(const note of notes){let noteText='';if(!note.parties||note.cargoWeight==null){noteText=await readNfePdf(await backend.cteRequests.downloadFile(note));if(!note.parties)note.parties=extractNfeParties(noteText);if(note.cargoWeight==null)Object.assign(note,extractNfeCargoWeight(noteText));}assertNfePartiesMatchFarm(note.parties,requestFarm,note.name);}
   }
   let weightConference=null;
   if(cteRequest){
    const invoiceWeightFiles=(cteRequest.invoiceFiles||[]).filter(file=>!correctionFiles.includes(file)),invoiceWeights=invoiceWeightFiles.map(file=>{const value=Number(file.cargoWeight),unit=file.cargoWeightUnit||'kg';return Number.isFinite(value)&&value>=0?value*(unit==='t'?1000:1):null;}),cteWeight=Number(cte.cargoWeight),cteWeightKg=Number.isFinite(cteWeight)&&cteWeight>=0?cteWeight*(cte.cargoWeightUnit==='t'?1000:1):null;
    const partial=invoiceWeightFiles.filter(file=>file.cargoWeightSource==='product-quantity'||file.cargoWeightComplete===false).map(file=>file.name).filter(Boolean);
    if(cteWeightKg===null||!invoiceWeights.length||invoiceWeights.some(value=>value===null)||partial.length){
     const missing=invoiceWeightFiles.filter((_,index)=>invoiceWeights[index]===null).map(file=>file.name).filter(Boolean),reason=cteWeightKg===null?'Não consegui ler o peso no CT-e.':missing.length?`Não consegui ler o peso da NF-e ${missing.join(', ')}.`:partial.length?`A NF-e ${partial.join(', ')} tem quantidade em KG nos produtos, mas não informa o peso bruto total.`:'Não consegui ler o peso de todas as NF-e desta solicitação.';
     if(!confirmWeightCheck){const error=Error(reason+' Confira os documentos e confirme se deseja enviar mesmo sem a comparação automática.');error.code='CTE_WEIGHT_UNAVAILABLE';throw error;}
     weightConference={status:'unavailable',cteWeightKg,nfeWeightKg:null,confirmedBy:actor.userId,confirmedAt:new Date().toISOString()};
    }else{
     const nfeWeightKg=Number(invoiceWeights.reduce((sum,value)=>sum+value,0).toFixed(3)),differenceKg=Number(Math.abs(cteWeightKg-nfeWeightKg).toFixed(3)),matches=differenceKg<=Math.max(1,nfeWeightKg*0.00001);
     if(!matches&&!confirmWeightCheck){const error=Error(`Peso diferente: CT-e ${cteWeightKg.toLocaleString('pt-BR')} kg; NF-e ${nfeWeightKg.toLocaleString('pt-BR')} kg (diferença de ${differenceKg.toLocaleString('pt-BR')} kg). Confira os documentos e confirme se deseja enviar mesmo assim.`);error.code='CTE_WEIGHT_MISMATCH';throw error;}
     weightConference={status:matches?'match':'different',cteWeightKg,nfeWeightKg,differenceKg,...(!matches?{confirmedBy:actor.userId,confirmedAt:new Date().toISOString()}:{})};
    }
   }
   const truck=cteRequest?requestedTruck:dateMatches.length===1?dateMatches[0]:dateMatches.length===0&&plateMatches.length===1?plateMatches[0]:null;
   if(!cteRequest&&!plateMatches.length)throw Error('Não encontrei a placa '+cte.plate+' cadastrada. Confira a placa no cadastro do caminhão e tente novamente.');
   if(!truck)throw Error('Encontrei mais de um cadastro para a placa '+cte.plate+' e não consigo identificar a fazenda com segurança. Confira os períodos e as transferências desse caminhão.');
   const farm=current.state.farms?.find(f=>f.id===truck.farmId);if(!farm)throw Error('A fazenda vinculada à placa não foi encontrada.');
   if(cteRequest&&farm.id!==cteRequest.farmId)throw Error('O CT-e não corresponde à fazenda da solicitação.');
   const linkedPlate=truck.plate,billedTons=billableTons(cte.cargoWeight,cte.cargoWeightUnit),participantDetails={...(cte.participantDetails||{}),...(cte.manifestedKeys?.length?{manifestedKeys:cte.manifestedKeys}:{}),...(weightConference?{weightConference}:{}),...(cte.totalValue>highValueThreshold?{highValueAlert:{threshold:highValueThreshold,confirmedBy:actor.userId,confirmedAt:new Date().toISOString()}}:{}),...(plateMismatch?{plateCorrection:{documentPlate:cte.plate,linkedPlate,files:correctionFiles.map(file=>file.name),confirmedBy:actor.userId,confirmedAt:new Date().toISOString()}}:{})},metadata={...cte,plate:linkedPlate,participantDetails,truckId:truck.id,farmId:farm.id,billingRate:CTE_BILLING_RATE_PER_TON,billableTons:billedTons,billingAmount:billingAmount(billedTons),...(cteRequest?{requestId:cteRequest.id}:{})};
   const saved=await backend.ctes.upload(actor,metadata,bytes,details,{plate:linkedPlate,driver:truck.driver,farmName:farm.name});
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

