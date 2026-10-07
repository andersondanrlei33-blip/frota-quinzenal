import {createFleetApi} from './api.js';
import {createSupabaseBackend,corsResponse,emailAddress,randomTicket,sha256} from './supabase-adapter.js';
const envKey=(modern,legacy)=>{try{const key=JSON.parse(Deno.env.get(modern)||'{}').default;if(key)return key;}catch{}return Deno.env.get(legacy);};
const backend=createSupabaseBackend({url:Deno.env.get('SUPABASE_URL'),publicKey:envKey('SUPABASE_PUBLISHABLE_KEYS','SUPABASE_ANON_KEY'),secretKey:envKey('SUPABASE_SECRET_KEYS','SUPABASE_SERVICE_ROLE_KEY')});
const dataApi=createFleetApi({repository:backend.repository,authenticate:backend.actor});
Deno.serve(async request=>{
  if(request.method==='OPTIONS')return corsResponse(new Response(null,{status:204}),request);
  try{
    const path=new URL(request.url).pathname;
    if(path.endsWith('/api/team')||path.endsWith('/api/team/invite')||path.endsWith('/api/team/status')){
      const actor=await backend.actor(request);if(!actor?.userId)return corsResponse(backend.responseJson({error:'Faça login.'},401),request);
      if(!actor.companyId||actor.role!=='admin')return corsResponse(backend.responseJson({error:'Ação exige um administrador.'},403),request);
      if(request.method==='GET'&&path.endsWith('/api/team')){
        const members=await backend.service('/rest/v1/fleet_members?'+new URLSearchParams({company_id:'eq.'+actor.companyId,select:'user_id,email,role,active',order:'created_at.asc'}));
        return corsResponse(backend.responseJson({members}),request);
      }
      if(request.method==='POST'){
        const text=await request.text();if(text.length>4000)throw Error('Pedido muito grande.');const body=JSON.parse(text);
        if(path.endsWith('/api/team/invite')){
          const email=emailAddress(body.email),role=body.role;if(!['admin','operator','viewer'].includes(role))throw Error('Selecione um perfil válido.');
          const ticket=randomTicket(),expires=new Date(Date.now()+72*3600*1000).toISOString();
          await backend.service('/rest/v1/fleet_invitations',{method:'POST',body:{company_id:actor.companyId,email,role,token_hash:await sha256(ticket),expires_at:expires}});
          return corsResponse(backend.responseJson({ticket,email,role,expiresAt:expires}),request);
        }
        if(typeof body.active!=='boolean'||!['admin','operator','viewer'].includes(body.role))throw Error('Confira o perfil e a situação do usuário.');
        const result=await backend.rpc('fleet_change_member',{p_company:actor.companyId,p_actor:actor.userId,p_target:body.userId,p_role:body.role,p_active:body.active});
        return corsResponse(backend.responseJson(result),request);
      }
      return corsResponse(backend.responseJson({error:'Método não permitido.'},405),request);
    }
    return corsResponse(await dataApi(request),request);
  }catch(error){return corsResponse(backend.responseJson({error:error.code==='42501'?'Esta alteração não é permitida.':error.message||'Não foi possível concluir a solicitação.'},error.code==='42501'?403:400),request);}
});
