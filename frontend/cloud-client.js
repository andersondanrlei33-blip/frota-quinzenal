export function createCloudClient({url,publishableKey,functionName='fleet-api',fetchImpl=fetch}) {
  if(!url?.startsWith('https://')||!publishableKey)throw Error('Configure a conexão com o banco online.');
  let session=null,refreshing=null,companyId='';
  const authUrl=path=>url+'/auth/v1/'+path;
  const request=async (endpoint,{method='GET',body,token=null,company=false}={})=>{
    const response=await fetchImpl(endpoint,{method,cache:'no-store',headers:{apikey:publishableKey,...(token?{Authorization:'Bearer '+token}:{}),...(company&&companyId?{'X-Fleet-Company':companyId}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    let value;try{value=await response.json();}catch{throw Error('O servidor não respondeu corretamente. Tente novamente.');}
    if(!response.ok){const error=Error(value.error||value.msg||value.message||'Não foi possível concluir a solicitação.');error.status=response.status;error.code=value.code;throw error;}
    return value;
  };
  const setSession=value=>{session={...value,expires_at:Math.floor(Date.now()/1000)+(value.expires_in||3600)};};
  const getToken=async()=>{
    if(!session)throw Error('Faça login para acessar os registros.');
    if(session.expires_at<=Math.floor(Date.now()/1000)+60){
      if(!refreshing)refreshing=request(authUrl('token?grant_type=refresh_token'),{method:'POST',body:{refresh_token:session.refresh_token}}).then(setSession).catch(error=>{session=null;throw error;}).finally(()=>{refreshing=null;});
      await refreshing;
    }
    return session.access_token;
  };
  const api=async(path,body)=>request(url+'/functions/v1/'+functionName+path,{method:body?'POST':'GET',body,token:await getToken(),company:true});
  const access=(body,token=null)=>request(url+'/functions/v1/fleet-access',{method:'POST',body,token});
  return {
    async login(email,password,ticket=null,companyName=null){const value=await request(authUrl('token?grant_type=password'),{method:'POST',body:{email,password}});setSession(value);if(ticket){const accepted=await access({action:'accept',ticket,companyName},session.access_token);companyId=accepted.companyId;}return api('/api/state');},
    async logout(){try{if(session)await request(authUrl('logout?scope=local'),{method:'POST',token:session.access_token});}finally{session=null;companyId='';}},
    async load(){return api('/api/state');},
    async version(){return api('/api/version');},
    async execute(type,payload,expectedRevision){return api('/api/commands',{type,payload,expectedRevision});},
    async inspectInvite(ticket){return access({action:'inspect',ticket});},
    async register(ticket,email,password,companyName){const result=await access({action:'register',ticket,email,password,companyName});companyId=result.companyId;return result;},
    async team(){return api('/api/team');},
    async invite(email,role){return api('/api/team/invite',{email,role});},
    async updateMember(userId,role,active){return api('/api/team/status',{userId,role,active});},
    hasSession(){return !!session;}
  };
}
