import {locateRequest,partyOf} from './payment-portal.js';
export const RECEIPT_LIMIT=10*1024*1024;
async function boundedFormData(request){
 const reader=request.body?.getReader();if(!reader)throw Error('Anexe o comprovante.');const chunks=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>RECEIPT_LIMIT+65536){await reader.cancel();throw Error('O comprovante deve ter até 10 MB.');}chunks.push(value);}
 const body=new Uint8Array(size);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}
 return new Request(request.url,{method:'POST',headers:request.headers,body}).formData();
}
export function inspectReceipt(bytes,name){
 if(!(bytes instanceof Uint8Array)||bytes.length===0||bytes.length>RECEIPT_LIMIT)throw Error('Anexe um comprovante de até 10 MB.');
 let mime,extension;
 if(new TextDecoder().decode(bytes.slice(0,5))==='%PDF-'){mime='application/pdf';extension='pdf';}
 else if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value)){mime='image/png';extension='png';}
 else if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255){mime='image/jpeg';extension='jpg';}
 else throw Error('Use um comprovante em PDF, JPG ou PNG.');
 const safeName=String(name||'comprovante.'+extension).split(/[\\/]/).at(-1).replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,160)||'comprovante.'+extension;
 return {mime,extension,name:safeName,size:bytes.length};
}
export function receiptBelongsToHistory(state,requestId,receiptId){
 const request=state.paymentRequests.find(r=>r.id===requestId);return !!request&&(request.payment?.receipt?.id===receiptId||request.paymentHistory.some(item=>item.payment?.receipt?.id===receiptId));
}
export function createReceiptApi({backend}){
 return async request=>{
  const actor=await backend.actor(request);if(!actor?.userId)return backend.responseJson({error:'Faça login.'},401);
  if(!actor.companyId)return backend.responseJson({error:'Sua conta não tem acesso a esta empresa.'},403);
  const path=new URL(request.url).pathname;
  if(request.method==='POST'&&path.endsWith('/api/receipts')){
   if(partyOf(actor)!=='carrier'||actor.role==='viewer')return backend.responseJson({error:'Somente a transportadora pode anexar comprovantes de pagamento.'},403);
   if(Number(request.headers.get('Content-Length'))>RECEIPT_LIMIT+65536)throw Error('O comprovante deve ter até 10 MB.');
   const data=await boundedFormData(request),requestId=String(data.get('requestId')||''),file=data.get('file');
   if(!file||typeof file.arrayBuffer!=='function'||file.size>RECEIPT_LIMIT)throw Error('Anexe um comprovante de até 10 MB.');
   const current=await backend.repository.load(actor.companyId),target=locateRequest(current.state,requestId);
   if(target.request.status!=='pending'||!target.row||target.row.paid)throw Error('A solicitação não está aguardando pagamento.');
   const bytes=new Uint8Array(await file.arrayBuffer()),details=inspectReceipt(bytes,file.name);
   const saved=await backend.receipts.upload(actor,requestId,bytes,details);return backend.responseJson(saved);
  }
  if(request.method==='GET'){
   const id=path.split('/').at(-1);if(!/^[0-9a-f-]{36}$/i.test(id))throw Error('Comprovante inválido.');
   const receipt=await backend.receipts.find(actor.companyId,id),current=await backend.repository.load(actor.companyId);
   if(!receipt||!receiptBelongsToHistory(current.state,receipt.requestId,id))return backend.responseJson({error:'Comprovante não encontrado para esta empresa.'},404);
   return backend.responseJson({name:receipt.name,signedUrl:await backend.receipts.sign(receipt),expiresIn:60});
  }
  return backend.responseJson({error:'Método não permitido.'},405);
 };
}
