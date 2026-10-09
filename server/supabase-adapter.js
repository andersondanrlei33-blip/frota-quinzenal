const responseJson=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
export function createSupabaseBackend({url,publicKey,secretKey,fetchImpl=fetch}){
  if(!url||!publicKey||!secretKey)throw Error('Configure o banco e a autenticação do servidor.');
  const serviceHeaders={apikey:secretKey,...(secretKey.startsWith('ey')?{Authorization:'Bearer '+secretKey}:{}),'Content-Type':'application/json'};
  async function service(path,{method='GET',body,prefer}={}){
    const response=await fetchImpl(url+path,{method,headers:{...serviceHeaders,...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body)});
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
    const params=new URLSearchParams({select:'company_id,user_id,email,role,party,farm_id,active',user_id:'eq.'+profile.id,active:'eq.true',order:'created_at.asc'});
    if(requested){if(!/^[0-9a-f-]{36}$/i.test(requested))return {userId:profile.id};params.set('company_id','eq.'+requested);}
    const memberships=await service('/rest/v1/fleet_members?'+params);
    const membership=memberships?.[0];return membership?{userId:profile.id,email:profile.email,companyId:membership.company_id,role:membership.role,party:membership.party,farmId:membership.farm_id||null}:{userId:profile.id,email:profile.email};
  }
  const repository={
    async load(companyId){const result=await rpc('fleet_load_state',{p_company:companyId});if(!result)throw Error('Empresa não encontrada.');return result;},
    async version(companyId){const result=await service('/rest/v1/fleet_companies?'+new URLSearchParams({id:'eq.'+companyId,select:'revision'}));return result?.[0]?.revision;},
    async commit(companyId,revision,state,audit){const result=await rpc('fleet_commit_state',{p_company:companyId,p_actor:audit.actorId,p_expected:revision,p_state:state,p_action:audit.action});return result?.conflict?null:result;}
  };
  const bucket='fleet-receipts',objectPath=key=>key.split('/').map(encodeURIComponent).join('/');
  const mapReceipt=r=>r?{id:r.id,companyId:r.company_id,requestId:r.request_id,uploadedBy:r.uploaded_by,name:r.file_name,mime:r.content_type,size:r.size_bytes,objectKey:r.object_key}:null;
  const receipts={
    async find(companyId,id){if(!/^[0-9a-f-]{36}$/i.test(id||''))return null;const rows=await service('/rest/v1/fleet_receipts?'+new URLSearchParams({id:'eq.'+id,company_id:'eq.'+companyId,select:'*'}));return mapReceipt(rows?.[0]);},
    async upload(who,requestId,bytes,details){
      const id=crypto.randomUUID(),key=who.companyId+'/'+id+'/comprovante.'+details.extension;
      const response=await fetchImpl(url+'/storage/v1/object/'+bucket+'/'+objectPath(key),{method:'POST',headers:{...serviceHeaders,'Content-Type':details.mime,'x-upsert':'false','Cache-Control':'no-store'},body:bytes});
      if(!response.ok)throw Error('Não foi possível guardar o comprovante. Tente novamente.');
      try{await service('/rest/v1/fleet_receipts',{method:'POST',body:{id,company_id:who.companyId,request_id:requestId,uploaded_by:who.userId,object_key:key,file_name:details.name,content_type:details.mime,size_bytes:details.size}});}
      catch(error){await service('/storage/v1/object/'+bucket,{method:'DELETE',body:{prefixes:[key]}}).catch(()=>{});throw error;}
      return {id,name:details.name,mime:details.mime,size:details.size};
    },
    async sign(receipt){const result=await service('/storage/v1/object/sign/'+bucket+'/'+objectPath(receipt.objectKey),{method:'POST',body:{expiresIn:60}});const returned=result?.signedURL||result?.signedUrl;if(!returned)throw Error('Não foi possível abrir o comprovante.');const signed=new URL(returned.startsWith('/storage/')?returned:'/storage/v1'+returned,url);if(signed.origin!==new URL(url).origin||!signed.pathname.startsWith('/storage/v1/object/sign/'+bucket+'/'))throw Error('Endereço de comprovante inválido.');return signed.href;}
  };
  const fundingReceipts={
    async find(companyId,id){if(!/^[0-9a-f-]{36}$/i.test(id||''))return null;const rows=await service('/rest/v1/fleet_funding_receipts?'+new URLSearchParams({id:'eq.'+id,company_id:'eq.'+companyId,select:'*'}));const row=rows?.[0];return row?{id:row.id,companyId:row.company_id,transferId:row.transfer_id,uploadedBy:row.uploaded_by,name:row.file_name,mime:row.content_type,size:row.size_bytes,objectKey:row.object_key}:null;},
    async upload(who,transferId,bytes,details){
      const id=crypto.randomUUID(),key=who.companyId+'/funding/'+id+'/recibo.'+details.extension;
      const response=await fetchImpl(url+'/storage/v1/object/'+bucket+'/'+objectPath(key),{method:'POST',headers:{...serviceHeaders,'Content-Type':details.mime,'x-upsert':'false','Cache-Control':'no-store'},body:bytes});
      if(!response.ok)throw Error('Não foi possível guardar o recibo assinado. Tente novamente.');
      try{await service('/rest/v1/fleet_funding_receipts',{method:'POST',body:{id,company_id:who.companyId,transfer_id:transferId,uploaded_by:who.userId,object_key:key,file_name:details.name,content_type:details.mime,size_bytes:details.size}});}
      catch(error){await service('/storage/v1/object/'+bucket,{method:'DELETE',body:{prefixes:[key]}}).catch(()=>{});throw error;}
      return {id,name:details.name,mime:details.mime,size:details.size};
    },
    sign:receipts.sign
  };
  const mapCte=r=>r?{id:r.id,companyId:r.company_id,farmId:r.farm_id,farmName:r.farm_name,truckId:r.truck_id,plate:r.plate,driver:r.driver,number:r.cte_number,issuer:r.issuer,recipient:r.recipient,shipper:r.shipper||'Não identificado',serviceTaker:r.service_taker||'Não identificado',participantDetails:r.participant_details||{},manifestedNotes:r.manifested_notes||[],totalValue:Number(r.total_value),issuedOn:r.issued_on,uploadedBy:r.uploaded_by,uploadedAt:r.created_at,name:r.file_name,mime:r.content_type,size:r.size_bytes,requestId:r.request_id||null,objectKey:r.object_key}:null;
  const mapCteRequest=r=>r?{id:r.id,companyId:r.company_id,farmId:r.farm_id,farmName:r.farm_name,truckId:r.truck_id,plate:r.plate,driver:r.driver,invoiceKeys:r.invoice_keys||[],invoiceFiles:(r.invoice_files||[]).map(file=>({id:file.id,name:file.name,mime:file.mime,size:file.size,accessKey:file.accessKey,objectKey:file.objectKey})),note:r.note||'',status:r.status,requestedBy:r.requested_by,requestedEmail:r.requested_email,requestedAt:r.created_at,documentId:r.cte_document_id||null,updatedAt:r.updated_at}:null;
  const cteInvoiceBucket='fleet-cte-invoices';
  const cteRequests={
    async list(companyId,farmId=null){const query=new URLSearchParams({company_id:'eq.'+companyId,select:'*',order:'created_at.desc'});if(farmId)query.set('farm_id','eq.'+farmId);return (await service('/rest/v1/fleet_cte_requests?'+query)||[]).map(mapCteRequest);},
    async find(companyId,id){if(!/^[0-9a-f-]{36}$/i.test(id||''))return null;const rows=await service('/rest/v1/fleet_cte_requests?'+new URLSearchParams({id:'eq.'+id,company_id:'eq.'+companyId,select:'*'}));return mapCteRequest(rows?.[0]);},
    async create(actor,truck,farm,invoiceKeys,note,invoiceFiles=[]){const requestId=crypto.randomUUID(),stored=[];try{for(const {bytes,details} of invoiceFiles){const id=crypto.randomUUID(),key=actor.companyId+'/'+requestId+'/'+id+'.xml',response=await fetchImpl(url+'/storage/v1/object/'+cteInvoiceBucket+'/'+objectPath(key),{method:'POST',headers:{...serviceHeaders,'Content-Type':'application/xml','x-upsert':'false','Cache-Control':'no-store'},body:bytes});if(!response.ok)throw Error('Não foi possível guardar o XML '+details.name+'. Tente novamente.');stored.push({id,name:details.name,mime:'application/xml',size:details.size,accessKey:details.accessKey,objectKey:key});}const rows=await service('/rest/v1/fleet_cte_requests',{method:'POST',prefer:'return=representation',body:{id:requestId,company_id:actor.companyId,farm_id:farm.id,farm_name:farm.name,truck_id:truck.id,plate:truck.plate,driver:truck.driver,invoice_keys:invoiceKeys,invoice_files:stored,note,requested_by:actor.userId,requested_email:actor.email||''}});return mapCteRequest(rows?.[0]);}catch(error){if(stored.length)await service('/storage/v1/object/'+cteInvoiceBucket,{method:'DELETE',body:{prefixes:stored.map(file=>file.objectKey)}}).catch(()=>{});throw error;}},
    async signFile(file){const result=await service('/storage/v1/object/sign/'+cteInvoiceBucket+'/'+objectPath(file.objectKey),{method:'POST',body:{expiresIn:120,download:file.name}});const returned=result?.signedURL||result?.signedUrl;if(!returned)throw Error('Não foi possível baixar o XML da NF-e.');const signed=new URL(returned.startsWith('/storage/')?returned:'/storage/v1'+returned,url);if(signed.origin!==new URL(url).origin||!signed.pathname.startsWith('/storage/v1/object/sign/'+cteInvoiceBucket+'/'))throw Error('Endereço do XML inválido.');return signed.href;},
    async markIssued(companyId,requestId,documentId){const rows=await service('/rest/v1/fleet_cte_requests?'+new URLSearchParams({id:'eq.'+requestId,company_id:'eq.'+companyId,status:'eq.pending',select:'id'}),{method:'PATCH',prefer:'return=representation',body:{status:'issued',cte_document_id:documentId,updated_at:new Date().toISOString()}});if(!rows?.length)throw Error('Esta solicitação já foi atendida ou cancelada. Atualize a lista e tente novamente.');}
  };
  const ctes={
    async getPreferences(userId,companyId){const rows=await service('/rest/v1/fleet_cte_report_preferences?'+new URLSearchParams({user_id:'eq.'+userId,company_id:'eq.'+companyId,select:'visible_columns,column_order'}));const row=rows?.[0];return row?{visibleColumns:row.visible_columns,columnOrder:row.column_order}:null;},
    async savePreferences(userId,companyId,preferences){await service('/rest/v1/fleet_cte_report_preferences?on_conflict=user_id%2Ccompany_id',{method:'POST',prefer:'resolution=merge-duplicates',body:{user_id:userId,company_id:companyId,visible_columns:preferences.visibleColumns,column_order:preferences.columnOrder} });return preferences;},
    async list(companyId,farmId=null){const query=new URLSearchParams({company_id:'eq.'+companyId,select:'*',order:'issued_on.desc,created_at.desc'});if(farmId)query.set('farm_id','eq.'+farmId);const rows=await service('/rest/v1/fleet_cte_documents?'+query);return (rows||[]).map(mapCte);},
    async find(companyId,id){if(!/^[0-9a-f-]{36}$/i.test(id||''))return null;const rows=await service('/rest/v1/fleet_cte_documents?'+new URLSearchParams({id:'eq.'+id,company_id:'eq.'+companyId,select:'*'}));return mapCte(rows?.[0]);},
    async upload(who,metadata,bytes,details,snapshot){
      const id=crypto.randomUUID(),key=who.companyId+'/ctes/'+id+'/cte.'+details.extension;
      const response=await fetchImpl(url+'/storage/v1/object/'+bucket+'/'+objectPath(key),{method:'POST',headers:{...serviceHeaders,'Content-Type':details.mime,'x-upsert':'false','Cache-Control':'no-store'},body:bytes});
      if(!response.ok)throw Error('Não foi possível guardar o CT-e. Tente novamente.');
      try{await service('/rest/v1/fleet_cte_documents',{method:'POST',body:{id,company_id:who.companyId,farm_id:metadata.farmId,farm_name:snapshot.farmName,truck_id:metadata.truckId,plate:snapshot.plate,driver:snapshot.driver,cte_number:metadata.number||null,issuer:metadata.issuer,recipient:metadata.recipient,shipper:metadata.shipper,service_taker:metadata.serviceTaker,participant_details:metadata.participantDetails||{},manifested_notes:metadata.manifestedNotes||[],total_value:metadata.totalValue,issued_on:metadata.issuedOn,uploaded_by:who.userId,request_id:metadata.requestId||null,object_key:key,file_name:details.name,content_type:details.mime,size_bytes:details.size}});if(metadata.requestId)await cteRequests.markIssued(who.companyId,metadata.requestId,id);}
      catch(error){if(metadata.requestId)await service('/rest/v1/fleet_cte_documents?'+new URLSearchParams({id:'eq.'+id,company_id:'eq.'+who.companyId}),{method:'DELETE'}).catch(()=>{});await service('/storage/v1/object/'+bucket,{method:'DELETE',body:{prefixes:[key]}}).catch(()=>{});if(error.code==='23505')throw Error('Já existe um CT-e com este número nesta empresa. Confira o documento.');throw error;}
      return {id,name:details.name,mime:details.mime,size:details.size};
    },
    async sign(document){const result=await service('/storage/v1/object/sign/'+bucket+'/'+objectPath(document.objectKey),{method:'POST',body:{expiresIn:120,download:document.name}});const returned=result?.signedURL||result?.signedUrl;if(!returned)throw Error('Não foi possível baixar o CT-e.');const signed=new URL(returned.startsWith('/storage/')?returned:'/storage/v1'+returned,url);if(signed.origin!==new URL(url).origin||!signed.pathname.startsWith('/storage/v1/object/sign/'+bucket+'/'))throw Error('Endereço de CT-e inválido.');return signed.href;}
  };
  repository.verifyReceipt=async(who,id,requestId)=>{const receipt=await receipts.find(who.companyId,id);if(!receipt||receipt.requestId!==requestId||receipt.uploadedBy!==who.userId)throw Error('Anexe um comprovante válido para esta solicitação.');const check=await fetchImpl(url+'/storage/v1/object/'+bucket+'/'+objectPath(receipt.objectKey),{method:'HEAD',headers:serviceHeaders});if(!check.ok)throw Error('O arquivo do comprovante não está disponível. Anexe novamente.');return receipt;};
  repository.verifyFundingReceipt=async(who,id,transferId)=>{const receipt=await fundingReceipts.find(who.companyId,id);if(!receipt||receipt.transferId!==transferId||receipt.uploadedBy!==who.userId)throw Error('Anexe o recibo assinado da transportadora para esta transferência.');const check=await fetchImpl(url+'/storage/v1/object/'+bucket+'/'+objectPath(receipt.objectKey),{method:'HEAD',headers:serviceHeaders});if(!check.ok)throw Error('O arquivo do recibo não está disponível. Anexe novamente.');return receipt;};
  return {service,rpc,user,actor,repository,receipts,fundingReceipts,ctes,cteRequests,responseJson};
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
