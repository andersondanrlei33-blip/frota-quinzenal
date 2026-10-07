const responseJson=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
export function createSupabaseBackend({url,publicKey,secretKey,fetchImpl=fetch}){
  if(!url||!publicKey||!secretKey)throw Error('Configure o banco e a autenticação do servidor.');
  const serviceHeaders={apikey:secretKey,...(secretKey.startsWith('ey')?{Authorization:'Bearer '+secretKey}:{}),'Content-Type':'application/json'};
  async function service(path,{method='GET',body}={}){
    const response=await fetchImpl(url+path,{method,headers:serviceHeaders,body:body===undefined?undefined:JSON.stringify(body)});
    const raw=await response.text();let data;try{data=raw?JSON.parse(raw):null;}catch{data=null;}
    if(!response.ok){const error=Error(data?.message||data?.msg||'Não foi possível acessar o banco.');error.code=data?.code||data?.error_code;error.status=response.status;throw error;}
    return data;
  }
  const rpc=(name,body)=>service('/rest/v1/rpc/'+name,{method:'POST',body});
  async function user(request){
    const authorization=request.headers.get('Authorization');if(!authorization?.startsWith('Bearer '))return null;
    const response=await fetchImpl(url+'/auth/v1/user',{headers:{apikey:publicKey,Authorization:authorization}});
    if(!response.ok)return null;const profile=await response.json();return profile?.id&&profile.email_confirmed_at?profile:null;
  }
  async function actor(request){
    const profile=await user(request);if(!profile)return null;
    const requested=request.headers.get('X-Fleet-Company');
    const params=new URLSearchParams({select:'company_id,user_id,email,role,active',user_id:'eq.'+profile.id,active:'eq.true',order:'created_at.asc'});
    if(requested){if(!/^[0-9a-f-]{36}$/i.test(requested))return {userId:profile.id};params.set('company_id','eq.'+requested);}
    const memberships=await service('/rest/v1/fleet_members?'+params);
    const membership=memberships?.[0];return membership?{userId:profile.id,email:profile.email,companyId:membership.company_id,role:membership.role}:{userId:profile.id,email:profile.email};
  }
  const repository={
    async load(companyId){const result=await rpc('fleet_load_state',{p_company:companyId});if(!result)throw Error('Empresa não encontrada.');return result;},
    async version(companyId){const result=await service('/rest/v1/fleet_companies?'+new URLSearchParams({id:'eq.'+companyId,select:'revision'}));return result?.[0]?.revision;},
    async commit(companyId,revision,state,audit){const result=await rpc('fleet_commit_state',{p_company:companyId,p_actor:audit.actorId,p_expected:revision,p_state:state,p_action:audit.action});return result?.conflict?null:result;}
  };
  return {service,rpc,user,actor,repository,responseJson};
}
export async function sha256(value){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(hash)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
export function randomTicket(){return [...crypto.getRandomValues(new Uint8Array(32))].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
export function emailAddress(value){const email=String(value||'').trim().toLowerCase();if(email.length>254||!/^\S+@\S+\.\S+$/.test(email))throw Error('Informe um e-mail válido.');return email;}
export function passwordValue(value){if(typeof value!=='string'||value.length<6||new TextEncoder().encode(value).length>72)throw Error('Use uma senha com pelo menos 6 caracteres, sem exceder o limite permitido.');return value;}
export function corsResponse(response,request){
  const origin=request.headers.get('Origin'),allowed=new Set(['https://andersondanrlei33-blip.github.io','https://frota-quinzenal.andersondanrlei33.chatgpt.site']);
  const headers=new Headers(response.headers);if(origin&&allowed.has(origin))headers.set('Access-Control-Allow-Origin',origin);
  headers.set('Vary','Origin');headers.set('Access-Control-Allow-Headers','authorization,apikey,content-type,x-fleet-company');headers.set('Access-Control-Allow-Methods','GET,POST,OPTIONS');headers.set('Cache-Control','private, no-store');
  return new Response(response.body,{status:response.status,headers});
}
