export function createCloudClient({url,publishableKey,functionName='fleet-api',fetchImpl=fetch,storage=null}) {
  if(!url?.startsWith('https://')||!publishableKey)throw Error('Configure a conexão com o banco online.');
  let session=null,refreshing=null,companyId='';
  const sessionStore=storage||(()=>{try{return globalThis.sessionStorage;}catch{return null;}})();
  const storageKey='frota-session-v1:'+new URL(url).host+':'+functionName;
  const saveSession=()=>{try{if(session)sessionStore?.setItem(storageKey,JSON.stringify({session,companyId}));else sessionStore?.removeItem(storageKey);}catch{}};
  const clearSession=()=>{session=null;companyId='';saveSession();};
  try{
    const saved=JSON.parse(sessionStore?.getItem(storageKey)||'null');
    if(saved&&typeof saved.session?.access_token==='string'&&typeof saved.session?.refresh_token==='string'&&Number.isFinite(saved.session?.expires_at)){
      session=saved.session;companyId=typeof saved.companyId==='string'?saved.companyId:'';
    }else if(saved)sessionStore?.removeItem(storageKey);
  }catch{try{sessionStore?.removeItem(storageKey);}catch{}}
  const authUrl=path=>url+'/auth/v1/'+path;
  const request=async (endpoint,{method='GET',body,token=null,company=false,raw=false}={})=>{
    const response=await fetchImpl(endpoint,{method,cache:'no-store',headers:{apikey:publishableKey,...(token?{Authorization:'Bearer '+token}:{}),...(company&&companyId?{'X-Fleet-Company':companyId}:{}),...(body&&!raw?{'Content-Type':'application/json'}:{})},body:body?(raw?body:JSON.stringify(body)):undefined});
    let value;try{value=await response.json();}catch{throw Error('O servidor não respondeu corretamente. Tente novamente.');}
    if(!response.ok){const error=Error(value.error||value.msg||value.message||'Não foi possível concluir a solicitação.');error.status=response.status;error.code=value.code;throw error;}
    return value;
  };
  const setSession=value=>{
    if(!value?.access_token||!value?.refresh_token)throw Error('O servidor não retornou uma sessão válida.');
    session={access_token:value.access_token,refresh_token:value.refresh_token,expires_at:Number(value.expires_at)||Math.floor(Date.now()/1000)+(Number(value.expires_in)||3600)};
    saveSession();
  };
  const getToken=async()=>{
    if(!session)throw Error('Faça login para acessar os registros.');
    if(session.expires_at<=Math.floor(Date.now()/1000)+60){
      if(!refreshing)refreshing=request(authUrl('token?grant_type=refresh_token'),{method:'POST',body:{refresh_token:session.refresh_token}}).then(setSession).catch(error=>{if(error.status===400||error.status===401)clearSession();throw error;}).finally(()=>{refreshing=null;});
      await refreshing;
    }
    return session.access_token;
  };
  const api=async(path,body)=>request(url+'/functions/v1/'+functionName+path,{method:body?'POST':'GET',body,token:await getToken(),company:true});
  const access=(body,token=null)=>request(url+'/functions/v1/fleet-access',{method:'POST',body,token});
  return {
    async login(email,password,ticket=null,companyName=null){const value=await request(authUrl('token?grant_type=password'),{method:'POST',body:{email,password}});companyId='';setSession(value);if(ticket){const accepted=await access({action:'accept',ticket,companyName},session.access_token);companyId=accepted.companyId;saveSession();}return api('/api/state');},
    async logout(){try{if(session)await request(authUrl('logout?scope=local'),{method:'POST',token:session.access_token});}finally{clearSession();}},
    forgetSession(){clearSession();},
    async load(){return api('/api/state');},
    async version(){return api('/api/version');},
    async execute(type,payload,expectedRevision){return api('/api/commands',{type,payload,expectedRevision});},
    async inspectInvite(ticket){return access({action:'inspect',ticket});},
    async register(ticket,email,password,companyName){const result=await access({action:'register',ticket,email,password,companyName});companyId=result.companyId;return result;},
    async team(){return api('/api/team');},
    async invite(email,role,party='group'){return api('/api/team/invite',{email,role,party});},
    async updateMember(userId,role,active,party=null){return api('/api/team/status',{userId,role,active,party});},
    async uploadReceipt(requestId,file){const body=new FormData();body.append('requestId',requestId);body.append('file',file,file.name);return request(url+'/functions/v1/'+functionName+'/api/receipts',{method:'POST',body,token:await getToken(),company:true,raw:true});},
    async receiptLink(id){return api('/api/receipts/'+encodeURIComponent(id));},
    async ctes(){return api('/api/ctes');},
    async saveCtePreferences(preferences){return api('/api/ctes/preferences',preferences);},
    async uploadCte({file}){const body=new FormData();body.append('file',file,file.name);return request(url+'/functions/v1/'+functionName+'/api/ctes',{method:'POST',body,token:await getToken(),company:true,raw:true});},
    async cteLink(id){return api('/api/ctes/'+encodeURIComponent(id));},
    hasSession(){return !!session;}
  };
}
