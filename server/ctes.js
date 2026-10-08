export const CTE_LIMIT=20*1024*1024;

const decodeXml=text=>String(text||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&#x([\da-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&').replace(/<[^>]+>/g,'').trim();
function xmlElement(xml,name){const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),match=String(xml||'').match(new RegExp(`<(?:(?:[\\w.-]+):)?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${escaped}\\s*>`,'i'));return match?.[1]||'';}
const xmlText=(xml,name)=>decodeXml(xmlElement(xml,name));
export function parseCteXml(bytes){
 let xml;try{xml=new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,'').trimStart();}catch{throw Error('O XML do CT-e precisa estar em UTF-8 válido.');}
 if(/<!DOCTYPE|<!ENTITY/i.test(xml)||!/^<\?xml\b|^<(?:(?:\w+):)?(?:cteProc|CTe)\b/i.test(xml))throw Error('O arquivo não parece ser um XML de CT-e válido.');
 const cte=xmlElement(xml,'CTe')||xml,inf=xmlElement(cte,'infCte')||cte,ide=xmlElement(inf,'ide'),issuer=xmlElement(inf,'emit'),recipient=xmlElement(inf,'dest'),service=xmlElement(inf,'vPrest'),normalized=xmlElement(inf,'infCTeNorm'),modal=xmlElement(normalized,'infModal'),road=xmlElement(modal,'rodo'),vehicle=xmlElement(road,'veic');
 const issuerName=xmlText(issuer,'xNome'),recipientName=xmlText(recipient,'xNome'),rawValue=xmlText(service,'vTPrest'),rawIssued=xmlText(ide,'dhEmi')||xmlText(ide,'dEmi'),issuedOn=rawIssued.match(/^\d{4}-\d{2}-\d{2}/)?.[0]||'',plate=xmlText(vehicle,'placa').toUpperCase().replace(/[^A-Z0-9]/g,''),number=xmlText(ide,'nCT');
 const totalValue=Number(rawValue),parsedDate=new Date(issuedOn+'T00:00:00Z');
 if(!issuerName||!recipientName||!Number.isFinite(totalValue)||totalValue<0||totalValue>999999999999.99||!/^\d{4}-\d{2}-\d{2}$/.test(issuedOn)||!Number.isFinite(parsedDate.getTime())||parsedDate.toISOString().slice(0,10)!==issuedOn||plate.length<7||plate.length>8)throw Error('Não consegui ler todos os dados necessários no XML. Envie o XML original do CT-e, não o DACTE em PDF.');
 return {issuer:issuerName.slice(0,160),recipient:recipientName.slice(0,160),totalValue:Number(totalValue.toFixed(2)),issuedOn,plate,number:number.slice(0,40)};
}

async function boundedFormData(request){
 const reader=request.body?.getReader();if(!reader)throw Error('Anexe o CT-e.');
 const chunks=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>CTE_LIMIT+65536){await reader.cancel();throw Error('O CT-e deve ter até 20 MB.');}chunks.push(value);}
 const body=new Uint8Array(size);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}
 return new Request(request.url,{method:'POST',headers:request.headers,body}).formData();
}

export function inspectCte(bytes,name){
 if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>CTE_LIMIT)throw Error('Anexe o XML original do CT-e, de até 20 MB.');
 const cleanName=String(name||'').split(/[\\/]/).at(-1).replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,160);
 const ext=cleanName.toLowerCase().split('.').at(-1);let mime;
 if(ext==='xml'){parseCteXml(bytes);mime='application/xml';}
 else throw Error('Para leitura automática, envie o XML original do CT-e. O DACTE em PDF não contém os dados estruturados.');
 if(!cleanName)throw Error('O arquivo do CT-e precisa ter um nome válido.');
 return {mime,extension:ext,name:cleanName,size:bytes.length};
}

export function createCteApi({backend}){
 return async request=>{
  const actor=await backend.actor(request);if(!actor?.userId)return backend.responseJson({error:'Faça login para acessar o sistema.'},401);
  if(!actor.companyId)return backend.responseJson({error:'Sua conta não tem acesso a esta empresa.'},403);
  const path=new URL(request.url).pathname;
  if(request.method==='GET'&&path.endsWith('/api/ctes')){
   const [rows,current]=await Promise.all([backend.ctes.list(actor.companyId),backend.repository.load(actor.companyId)]);
   const state=current.state||{};
   return backend.responseJson({documents:rows.map(({objectKey,...row})=>row),trucks:(state.trucks||[]).map(t=>({id:t.id,plate:t.plate,driver:t.driver,farmId:t.farmId})),farms:(state.farms||[]).map(f=>({id:f.id,name:f.name,active:f.active!==false}))});
  }
  if(request.method==='POST'&&path.endsWith('/api/ctes')){
   if(actor.party!=='carrier'||actor.role==='viewer')return backend.responseJson({error:'Somente a transportadora pode enviar CT-es.'},403);
   if(Number(request.headers.get('Content-Length'))>CTE_LIMIT+65536)throw Error('O CT-e deve ter até 20 MB.');
   const data=await boundedFormData(request),file=data.get('file');
   if(!file||typeof file.arrayBuffer!=='function'||file.size>CTE_LIMIT)throw Error('Anexe o XML original do CT-e, de até 20 MB.');
   const bytes=new Uint8Array(await file.arrayBuffer()),details=inspectCte(bytes,file.name),cte=parseCteXml(bytes);
   const current=await backend.repository.load(actor.companyId),normalizePlate=value=>String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,''),truckMatches=(current.state.trucks||[]).filter(t=>normalizePlate(t.plate)===cte.plate&&(!t.start||t.start<=cte.issuedOn)&&(!t.end||t.end>=cte.issuedOn));
   if(truckMatches.length!==1)throw Error(truckMatches.length?'Encontrei mais de um cadastro para essa placa nesta data. Corrija o cadastro do caminhão antes de enviar.':'Não encontrei essa placa cadastrada na data de emissão do CT-e. Cadastre ou transfira o caminhão com a data correta e tente novamente.');
   const truck=truckMatches[0],farm=current.state.farms?.find(f=>f.id===truck.farmId);if(!farm)throw Error('A fazenda vinculada à placa não foi encontrada.');
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
