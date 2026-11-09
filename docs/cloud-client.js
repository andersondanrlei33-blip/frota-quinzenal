export function createCloudClient({url,publishableKey,functionName='fleet-api',fetchImpl=fetch,storage=null}) {
  if(!url?.startsWith('https://')||!publishableKey)throw Error('Configure a conexão com o banco online.');
  let session=null,refreshing=null,companyId='',generation=0;
  const sessionListeners=new Set();
  const assertGeneration=expected=>{if(expected!==generation)throw Object.assign(Error('A sessão mudou. Repita a operação na conta atual.'),{code:'SESSION_CHANGED'});};
  const sessionStore=storage||(()=>{try{return globalThis.sessionStorage;}catch{return null;}})();
  const storageKey='frota-session-v1:'+new URL(url).host+':'+functionName;
  const saveSession=()=>{try{if(session)sessionStore?.setItem(storageKey,JSON.stringify({session,companyId}));else sessionStore?.removeItem(storageKey);}catch{}};
  const clearSession=(reason='logout')=>{generation++;session=null;refreshing=null;companyId='';saveSession();for(const listener of sessionListeners)listener(reason);};
  try{
    const saved=JSON.parse(sessionStore?.getItem(storageKey)||'null');
    if(saved&&typeof saved.session?.access_token==='string'&&typeof saved.session?.refresh_token==='string'&&Number.isFinite(saved.session?.expires_at)){
      session=saved.session;companyId=typeof saved.companyId==='string'?saved.companyId:'';
    }else if(saved)sessionStore?.removeItem(storageKey);
  }catch{try{sessionStore?.removeItem(storageKey);}catch{}}
  const authUrl=path=>url+'/auth/v1/'+path;
  const request=async (endpoint,{method='GET',body,token=null,company=false,raw=false,expected=generation}={})=>{
    assertGeneration(expected);
    let response;
    try{response=await fetchImpl(endpoint,{method,cache:'no-store',headers:{apikey:publishableKey,...(token?{Authorization:'Bearer '+token}:{}),...(company&&companyId?{'X-Fleet-Company':companyId}:{}),...(body&&!raw?{'Content-Type':'application/json'}:{})},body:body?(raw?body:JSON.stringify(body)):undefined});}
    catch(error){assertGeneration(expected);throw error;}
    assertGeneration(expected);
    let value;try{value=await response.json();}catch{assertGeneration(expected);throw Error('O servidor não respondeu corretamente. Tente novamente.');}
    assertGeneration(expected);
    if(!response.ok){const error=Error(value.error||value.msg||value.message||'Não foi possível concluir a solicitação.');error.status=response.status;error.code=value.code;if(Array.isArray(value.issues))error.issues=value.issues;throw error;}
    return value;
  };
  const setSession=value=>{
    if(!value?.access_token||!value?.refresh_token)throw Error('O servidor não retornou uma sessão válida.');
    session={access_token:value.access_token,refresh_token:value.refresh_token,expires_at:Number(value.expires_at)||Math.floor(Date.now()/1000)+(Number(value.expires_in)||3600)};
    saveSession();
  };
  const getToken=async(expected)=>{
    assertGeneration(expected);
    if(!session)throw Error('Faça login para acessar os registros.');
    if(session.expires_at<=Math.floor(Date.now()/1000)+60){
      if(!refreshing){
        const pending=request(authUrl('token?grant_type=refresh_token'),{method:'POST',body:{refresh_token:session.refresh_token},expected}).then(value=>{assertGeneration(expected);setSession(value);}).catch(error=>{assertGeneration(expected);if(error.status===400||error.status===401)clearSession();throw error;}).finally(()=>{if(refreshing===pending)refreshing=null;});
        refreshing=pending;
      }
      await refreshing;
    }
    assertGeneration(expected);
    if(!session)throw Error('Faça login para acessar os registros.');
    return session.access_token;
  };
  const api=async(path,body,raw=false)=>{
    const expected=generation,token=await getToken(expected);
    let value;try{value=await request(url+'/functions/v1/'+functionName+path,{method:body?'POST':'GET',body,token,company:true,raw,expected});}catch(error){assertGeneration(expected);if(error.status===401)clearSession();throw error;}
    assertGeneration(expected);return value;
  };
  const access=(body,token=null)=>request(url+'/functions/v1/fleet-access',{method:'POST',body,token});
  return {
    async login(email,password,ticket=null,companyName=null){clearSession('login');const expected=generation,value=await request(authUrl('token?grant_type=password'),{method:'POST',body:{email,password},expected});assertGeneration(expected);setSession(value);if(ticket){const accepted=await access({action:'accept',ticket,companyName},session.access_token);assertGeneration(expected);companyId=accepted.companyId;saveSession();}const data=await api('/api/state');assertGeneration(expected);return data;},
    async logout(){const token=session?.access_token;clearSession();if(token)await request(authUrl('logout?scope=local'),{method:'POST',token});},
    forgetSession(){clearSession();},
    sessionGeneration(){return generation;},
    onSessionInvalidated(listener){sessionListeners.add(listener);return ()=>sessionListeners.delete(listener);},
    async load(){return api('/api/state');},
    async version(){return api('/api/version');},
    async execute(type,payload,expectedRevision){return api('/api/commands',{type,payload,expectedRevision});},
    async inspectInvite(ticket){return access({action:'inspect',ticket});},
    async register(ticket,email,password,companyName){const expected=generation,result=await access({action:'register',ticket,email,password,companyName});assertGeneration(expected);companyId=result.companyId;return result;},
    async team(){return api('/api/team');},
    async invite(email,role,party='group',farmId=null,farmIds=[]){return api('/api/team/invite',{email,role,party,farmId,farmIds});},
    async updateMember(userId,role,active,party=null,farmId=null,farmIds=[]){return api('/api/team/status',{userId,role,active,party,farmId,farmIds});},
    async uploadReceipt(requestId,file){const body=new FormData();body.append('requestId',requestId);body.append('file',file,file.name);return api('/api/receipts',body,true);},
    async receiptLink(id){return api('/api/receipts/'+encodeURIComponent(id));},
    async ctes(filters={}){const query=new URLSearchParams(filters);return api('/api/ctes'+(query.size?'?'+query.toString():''));},
    async requestCte(payload){return api('/api/cte-requests',payload,payload instanceof FormData);},
    async cancelCteRequest(requestId){return api('/api/cte-requests/'+encodeURIComponent(requestId)+'/cancel',{});},
    async rejectCteRequest(requestId,reason){return api('/api/cte-requests/'+encodeURIComponent(requestId)+'/reject',{reason});},
    async cteRequestFileLink(requestId,fileId){return api('/api/cte-requests/'+encodeURIComponent(requestId)+'/files/'+encodeURIComponent(fileId));},
    async saveCtePreferences(preferences){return api('/api/ctes/preferences',preferences);},
    async uploadCte({file,requestId='',confirmPlateCorrection=false,confirmWeightCheck=false,confirmHighValue=false,confirmFarmMismatch=false,confirmAlerts=false}){const body=new FormData();body.append('file',file,file.name);if(requestId)body.append('requestId',requestId);if(confirmPlateCorrection)body.append('confirmPlateCorrection','true');if(confirmWeightCheck)body.append('confirmWeightCheck','true');if(confirmHighValue)body.append('confirmHighValue','true');if(confirmFarmMismatch)body.append('confirmFarmMismatch','true');if(confirmAlerts)body.append('confirmAlerts','true');return api('/api/ctes',body,true);},
    async cteLink(id){return api('/api/ctes/'+encodeURIComponent(id));},
    async submitCtePaymentProofBatch(documentIds,file){const body=new FormData();body.append('documentIds',JSON.stringify(documentIds));body.append('paymentProof',file,file.name);return api('/api/cte-payment-batches',body,true);},
    async issueCteBillingInvoice({documentIds,dueOn}){return api('/api/cte-billing-invoices',{documentIds,dueOn});},
    async payCteBillingInvoice(invoiceId,file){const body=new FormData();body.append('paymentProof',file,file.name);return api('/api/cte-billing-invoices/'+encodeURIComponent(invoiceId)+'/payment-proof',body,true);},
    async cteInvoicePaymentProofLink(invoiceId){return api('/api/cte-billing-invoices/'+encodeURIComponent(invoiceId)+'/payment-proof');},
    async ctePaymentProofLink(id){return api('/api/ctes/'+encodeURIComponent(id)+'/payment-proof');},
    hasSession(){return !!session;}
  };
}


