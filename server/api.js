import {executeCommand} from './commands.js';
import {presentState,authorizePortalCommand} from './payment-portal.js';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
async function readBody(request,maxBytes=10_000_000){
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw Error('Envie os dados em JSON.');
  if(Number(request.headers.get('Content-Length'))>maxBytes)throw Error('O pedido excede o tamanho permitido.');
  const reader=request.body?.getReader();if(!reader)throw Error('Informe os dados do pedido.');
  const chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw Error('O pedido excede o tamanho permitido.');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function createFleetApi({repository,authenticate}){
  if(!repository||typeof authenticate!=='function')throw Error('Configure banco de dados e autenticação.');
  return async function handle(request){
    try{
      const actor=await authenticate(request);
      if(!actor?.userId)return json({error:'Faça login para acessar o sistema.'},401);
      if(!actor.companyId||!['admin','operator','viewer'].includes(actor.role))return json({error:'Sua conta não tem acesso a esta empresa.'},403);
      const url=new URL(request.url),path=url.pathname.slice(url.pathname.indexOf('/api/'));
      if(request.method==='GET'&&path==='/api/state'){
        const current=await repository.load(actor.companyId);return json(presentState(current,actor));
      }
      if(request.method==='GET'&&path==='/api/version')return json({revision:await repository.version(actor.companyId),role:actor.role,party:actor.party||'group'});
      if(request.method==='POST'&&path==='/api/commands'){
        if(actor.role==='viewer')return json({error:'Você tem acesso somente para consulta.'},403);
        const command=await readBody(request);
        if(!command||typeof command.type!=='string'||!command.payload||typeof command.payload!=='object'||Array.isArray(command.payload))return json({error:'Comando inválido.'},400);
        authorizePortalCommand(command,actor);
        if(!Number.isSafeInteger(command.expectedRevision)||command.expectedRevision<0)return json({error:'Informe a versão dos registros.'},400);
        const current=await repository.load(actor.companyId);
        if(current.revision!==command.expectedRevision)return json({error:'Outra pessoa atualizou os registros. Atualize os dados antes de salvar.',revision:current.revision},409);
        const receipt=command.type==='payment.record'?await repository.verifyReceipt?.(actor,command.payload.receiptId,command.payload.requestId):command.type==='payment.record-batch'?await repository.verifyReceipt?.(actor,command.payload.receiptId,command.payload.requestIds?.[0]):null;
        const fundingReceipt=command.type==='funding.receipt'?await repository.verifyFundingReceipt?.(actor,command.payload.receiptId,command.payload.id):null;
        const result=executeCommand(current.state,command,actor,{receipt,fundingReceipt});
        const saved=await repository.commit(actor.companyId,command.expectedRevision,result.state,result.audit);
        if(!saved)return json({error:'Outra pessoa atualizou os registros. Atualize os dados antes de salvar.'},409);
        return json(presentState(saved,actor));
      }
      return json({error:'Rota não encontrada.'},404);
    }catch(error){
      if(error?.code==='DATABASE_UNAVAILABLE')return json({error:'O banco está indisponível. Os dados não foram salvos.'},503);
      return json({error:error.message||'Não foi possível concluir o pedido.'},[400,401,403,404,409].includes(error.status)?error.status:400);
    }
  };
}
