import {createFleetApi} from './api.js';
import {createReceiptApi} from './receipts.js';
import {createSupabaseBackend,corsResponse,emailAddress,randomTicket,sha256} from './supabase-adapter.js';
const envKey=(modern,legacy)=>{try{const key=JSON.parse(Deno.env.get(modern)||'{}').default;if(key)return key;}catch{}return Deno.env.get(legacy);};
const backend=createSupabaseBackend({url:Deno.env.get('SUPABASE_URL'),publicKey:envKey('SUPABASE_PUBLISHABLE_KEYS','SUPABASE_ANON_KEY'),secretKey:envKey('SUPABASE_SECRET_KEYS','SUPABASE_SERVICE_ROLE_KEY')});
const dataApi=createFleetApi({repository:backend.repository,authenticate:backend.actor});
const receiptApi=createReceiptApi({backend});
const escapeHtml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
async function sendAccessInvite(email,ticket){
  const apiKey=Deno.env.get('RESEND_API_KEY'),from=Deno.env.get('FLEET_EMAIL_FROM');
  if(!apiKey||!from)return {sent:false,message:'O envio por e-mail ainda não está configurado. O link individual foi gerado e pode ser copiado abaixo.'};
  if(/[\r\n]/.test(from)||from.length>200||!(/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(from)||/^[^<>\r\n]{1,80}<[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>$/.test(from))){
    return {sent:false,message:'O endereço remetente configurado para o Resend é inválido. O link individual foi gerado e pode ser copiado abaixo.'};
  }
  const link='https://andersondanrlei33-blip.github.io/frota-quinzenal/#activate='+encodeURIComponent(ticket);
  const safeLink=escapeHtml(link);
  let response;
  try{response=await fetch('https://api.resend.com/emails',{
    method:'POST',
    headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},
    body:JSON.stringify({
      from,to:[email],subject:'Convite para acessar o Controle de Frota',
      text:'Você recebeu acesso ao Controle de Frota. Abra este link para criar sua senha e ativar seu acesso (válido por 72 horas): '+link+'\n\nSe você não esperava este convite, ignore esta mensagem.',
      html:'<!doctype html><html lang="pt-BR"><body style="margin:0;padding:32px;background:#f4f6f3;font-family:Arial,sans-serif;color:#18312d"><main style="max-width:560px;margin:auto;padding:32px;background:#fff;border:1px solid #dce4dc;border-radius:12px"><h1 style="font-size:24px">Acesso ao Controle de Frota</h1><p>Você recebeu um convite para acessar o portal da frota.</p><p>Use o botão abaixo para criar sua senha e concluir o cadastro. Este link é válido por 72 horas.</p><p style="margin:28px 0"><a href="'+safeLink+'" style="display:inline-block;padding:13px 20px;border-radius:8px;background:#246b52;color:#fff;text-decoration:none;font-weight:700">Criar senha e acessar</a></p><p style="font-size:13px;color:#66756e">Se o botão não abrir, copie este endereço para o navegador:<br><a href="'+safeLink+'">'+safeLink+'</a></p><p style="font-size:12px;color:#7a8580">Se você não esperava este convite, ignore esta mensagem.</p></main></body></html>'
    })
  });}catch{return {sent:false,message:'Não foi possível conectar ao Resend. O link individual foi gerado e pode ser copiado abaixo.'};}
  if(response.ok)return {sent:true};
  const message=response.status===401?'A chave do Resend não foi aceita. Confira RESEND_API_KEY.':response.status===403?'O remetente não foi autorizado pelo Resend. Verifique o domínio e FLEET_EMAIL_FROM.':response.status===429?'O Resend limitou temporariamente o envio. Aguarde e tente novamente.':'O Resend não conseguiu enviar o convite. Confira a configuração do remetente.';
  return {sent:false,message:message+' O link individual foi gerado e pode ser copiado abaixo.'};
}
Deno.serve(async request=>{
  if(request.method==='OPTIONS')return corsResponse(new Response(null,{status:204}),request);
  try{
    const path=new URL(request.url).pathname;
    if(path.includes('/api/receipts')||path.includes('/api/funding-receipts'))return corsResponse(await receiptApi(request),request);
    if(path.endsWith('/api/team')||path.endsWith('/api/team/invite')||path.endsWith('/api/team/status')){
      const actor=await backend.actor(request);if(!actor?.userId)return corsResponse(backend.responseJson({error:'Faça login.'},401),request);
      if(!actor.companyId||actor.role!=='admin'||actor.party!=='group')return corsResponse(backend.responseJson({error:'Ação exige um administrador do grupo.'},403),request);
      if(request.method==='GET'&&path.endsWith('/api/team')){
        const members=await backend.service('/rest/v1/fleet_members?'+new URLSearchParams({company_id:'eq.'+actor.companyId,select:'user_id,email,role,party,active',order:'created_at.asc'}));
        return corsResponse(backend.responseJson({members}),request);
      }
      if(request.method==='POST'){
        const text=await request.text();if(text.length>4000)throw Error('Pedido muito grande.');const body=JSON.parse(text);
        if(path.endsWith('/api/team/invite')){
          const email=emailAddress(body.email),role=body.role,party=body.party||'group';if(!['admin','operator','viewer'].includes(role)||!['group','carrier'].includes(party)||role==='admin'&&party!=='group')throw Error('Selecione um perfil válido.');
          const ticket=randomTicket(),expires=new Date(Date.now()+72*3600*1000).toISOString();
          await backend.service('/rest/v1/fleet_invitations',{method:'POST',body:{company_id:actor.companyId,email,role,party,token_hash:await sha256(ticket),expires_at:expires}});
          const delivery=await sendAccessInvite(email,ticket);
          return corsResponse(backend.responseJson({ticket,email,role,party,expiresAt:expires,emailSent:delivery.sent,emailMessage:delivery.message||''}),request);
        }
        if(typeof body.active!=='boolean'||!['admin','operator','viewer'].includes(body.role))throw Error('Confira o perfil e a situação do usuário.');
        const result=await backend.rpc('fleet_change_member',{p_company:actor.companyId,p_actor:actor.userId,p_target:body.userId,p_role:body.role,p_active:body.active,p_party:body.party||null});
        return corsResponse(backend.responseJson(result),request);
      }
      return corsResponse(backend.responseJson({error:'Método não permitido.'},405),request);
    }
    return corsResponse(await dataApi(request),request);
  }catch(error){const status=error.code==='42501'?403:[400,401,403,404,409,429,502,503].includes(error.status)?error.status:400;return corsResponse(backend.responseJson({error:error.code==='42501'?'Esta alteração não é permitida.':error.message||'Não foi possível concluir a solicitação.'},status),request);}
});
