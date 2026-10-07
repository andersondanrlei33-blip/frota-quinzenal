import {executeCommand} from './commands.js';
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
        const current=await repository.load(actor.companyId);return json({...current,user:{id:actor.userId,email:actor.email||'',role:actor.role}});
      }
      if(request.method==='GET'&&path==='/api/version')return json({revision:await repository.version(actor.companyId),role:actor.role});
      if(request.method==='POST'&&path==='/api/commands'){
        if(actor.role==='viewer')return json({error:'Você tem acesso somente para consulta.'},403);
        const command=await readBody(request);
        if(!Number.isSafeInteger(command.expectedRevision)||command.expectedRevision<0)return json({error:'Informe a versão dos registros.'},400);
        const current=await repository.load(actor.companyId);
        if(current.revision!==command.expectedRevision)return json({error:'Outra pessoa atualizou os registros. Atualize os dados antes de salvar.',revision:current.revision},409);
        const result=executeCommand(current.state,command,actor);
        const saved=await repository.commit(actor.companyId,command.expectedRevision,result.state,result.audit);
        if(!saved)return json({error:'Outra pessoa atualizou os registros. Atualize os dados antes de salvar.'},409);
        return json(saved);
      }
      return json({error:'Rota não encontrada.'},404);
    }catch(error){
      if(error?.code==='DATABASE_UNAVAILABLE')return json({error:'O banco está indisponível. Os dados não foram salvos.'},503);
      return json({error:error.message||'Não foi possível concluir o pedido.'},400);
    }
  };
}
