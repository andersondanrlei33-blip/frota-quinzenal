import {createSupabaseBackend,corsResponse,emailAddress,passwordValue,sha256} from './supabase-adapter.js';
const envKey=(modern,legacy)=>{try{const key=JSON.parse(Deno.env.get(modern)||'{}').default;if(key)return key;}catch{}return Deno.env.get(legacy);};
const backend=createSupabaseBackend({url:Deno.env.get('SUPABASE_URL'),publicKey:envKey('SUPABASE_PUBLISHABLE_KEYS','SUPABASE_ANON_KEY'),secretKey:envKey('SUPABASE_SECRET_KEYS','SUPABASE_SERVICE_ROLE_KEY')});
Deno.serve(async request=>{
  if(request.method==='OPTIONS')return corsResponse(new Response(null,{status:204}),request);
  try{
    if(request.method!=='POST')return corsResponse(backend.responseJson({error:'Método não permitido.'},405),request);
    const text=await request.text();if(text.length>4000)throw Error('Pedido muito grande.');const body=JSON.parse(text);
    if(!/^[a-f0-9]{64}$/.test(body.ticket||''))throw Error('Link de acesso inválido.');
    const hash=await sha256(body.ticket),invitation=await backend.rpc('fleet_inspect_invitation',{p_hash:hash});
    if(!invitation)throw Error('Link inválido, utilizado ou expirado.');
    if(body.action==='inspect')return corsResponse(backend.responseJson(invitation),request);
    let profile;
    if(body.action==='register'){
      const email=emailAddress(body.email);if(invitation.email&&invitation.email.toLowerCase()!==email)throw Error('Use o e-mail do convite.');
      const password=passwordValue(body.password);
      if(invitation.firstAccess&&(!String(body.companyName||'').trim()||String(body.companyName).trim().length>120))throw Error('Informe o nome da empresa.');
      try{const created=await backend.service('/auth/v1/admin/users',{method:'POST',body:{email,password,email_confirm:true}});profile=created.user||created;}
      catch(error){if(['email_exists','user_already_exists'].includes(error.code)||/already.*(?:registered|exists)/i.test(error.message||''))return corsResponse(backend.responseJson({error:'Este e-mail já tem uma conta. Entre com a senha existente para aceitar o convite.',code:'ACCOUNT_EXISTS'},409),request);throw error;}
    }else if(body.action==='accept'){
      profile=await backend.user(request);if(!profile)return corsResponse(backend.responseJson({error:'Faça login para aceitar este convite.'},401),request);
      if(invitation.email&&invitation.email.toLowerCase()!==profile.email.toLowerCase())throw Error('Entre com o e-mail do convite.');
    }else throw Error('Ação inválida.');
    const result=await backend.rpc('fleet_accept_invitation',{p_hash:hash,p_user:profile.id,p_email:profile.email,p_company_name:invitation.firstAccess?String(body.companyName||'').trim():null});
    return corsResponse(backend.responseJson(result),request);
  }catch(error){return corsResponse(backend.responseJson({error:error.message||'Não foi possível configurar o acesso.'},400),request);}
});
