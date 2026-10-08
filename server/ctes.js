export const CTE_LIMIT=20*1024*1024;

async function boundedFormData(request){
 const reader=request.body?.getReader();if(!reader)throw Error('Anexe o CT-e.');
 const chunks=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>CTE_LIMIT+65536){await reader.cancel();throw Error('O CT-e deve ter até 20 MB.');}chunks.push(value);}
 const body=new Uint8Array(size);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}
 return new Request(request.url,{method:'POST',headers:request.headers,body}).formData();
}

export function inspectCte(bytes,name){
 if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>CTE_LIMIT)throw Error('Anexe um CT-e PDF ou XML de até 20 MB.');
 const cleanName=String(name||'').split(/[\\/]/).at(-1).replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,160);
 const ext=cleanName.toLowerCase().split('.').at(-1);let mime;
 if(ext==='pdf'&&new TextDecoder().decode(bytes.slice(0,5))==='%PDF-')mime='application/pdf';
 else if(ext==='xml'){
  let xml;try{xml=new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,'').trimStart();}catch{throw Error('O XML do CT-e precisa estar em UTF-8 válido.');}
  if(!/^<\?xml\b|^<(?:(?:\w+):)?(?:cteProc|CTe|enviCTe)\b/i.test(xml)||/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('O arquivo não parece ser um XML de CT-e válido.');
  mime='application/xml';
 }else throw Error('Use um arquivo de CT-e em PDF ou XML.');
 if(!cleanName)throw Error('O arquivo do CT-e precisa ter um nome válido.');
 return {mime,extension:ext,name:cleanName,size:bytes.length};
}

const safeDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||''))&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
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
   if(!file||typeof file.arrayBuffer!=='function'||file.size>CTE_LIMIT)throw Error('Anexe um CT-e PDF ou XML de até 20 MB.');
   const truckId=String(data.get('truckId')||''),farmId=String(data.get('farmId')||''),number=String(data.get('number')||'').trim().slice(0,40),issuedOn=String(data.get('issuedOn')||'');
   if(!truckId||!farmId||!safeDate(issuedOn))throw Error('Informe a fazenda, a placa e a data de emissão do CT-e.');
   const current=await backend.repository.load(actor.companyId),truck=current.state.trucks?.find(t=>t.id===truckId),farm=current.state.farms?.find(f=>f.id===farmId);
   if(!truck||!farm||truck.farmId!==farmId)throw Error('A placa precisa estar vinculada à fazenda selecionada.');
   const bytes=new Uint8Array(await file.arrayBuffer()),details=inspectCte(bytes,file.name);
   const saved=await backend.ctes.upload(actor,{truckId,farmId,number,issuedOn},bytes,details,{plate:truck.plate,driver:truck.driver,farmName:farm.name});
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
