import test from 'node:test';
import assert from 'node:assert/strict';
import {createCteApi,inspectCte} from '../server/ctes.js';

const companyId='11111111-1111-4111-8111-111111111111',userId='22222222-2222-4222-8222-222222222222',documentId='33333333-3333-4333-8333-333333333333';
const xml=new TextEncoder().encode('<?xml version="1.0"?><cteProc xmlns="http://www.portalfiscal.inf.br/cte"></cteProc>');
const pdf=new TextEncoder().encode('%PDF-1.7 fake');
const state={farms:[{id:'farm-a',name:'Fazenda A',active:true},{id:'farm-b',name:'Fazenda B',active:true}],trucks:[{id:'truck-a',plate:'ABC1D23',driver:'João',farmId:'farm-a'}]};
function setup({party='carrier',role='operator'}={}){
 const calls={};
 const backend={
  actor:async()=>({userId,email:'user@example.com',companyId,party,role}),
  responseJson:(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}}),
  repository:{load:async()=>({state})},
  ctes:{
   list:async()=>[{id:documentId,farmId:'farm-a',farmName:'Fazenda A',truckId:'truck-a',plate:'ABC1D23',driver:'João',number:'123',issuedOn:'2026-10-08',uploadedAt:'2026-10-08T12:00:00Z',name:'cte.xml',mime:'application/xml',size:xml.length,objectKey:companyId+'/ctes/'+documentId+'/cte.xml'}],
   upload:async(actor,metadata,bytes,details,snapshot)=>{calls.upload={actor,metadata,bytes,details,snapshot};return {id:documentId,name:details.name,mime:details.mime,size:details.size};},
   find:async(idCompany,id)=>idCompany===companyId&&id===documentId?{name:'cte.xml',mime:'application/xml',objectKey:companyId+'/ctes/'+documentId+'/cte.xml'}:null,
   sign:async()=> 'https://storage.example/signed?download=cte.xml'
  }
 };
 return {api:createCteApi({backend}),calls};
}
const formRequest=({farmId='farm-a',truckId='truck-a',number='123',issuedOn='2026-10-08',fileName='cte.xml',bytes=xml}={})=>{
 const form=new FormData();form.append('farmId',farmId);form.append('truckId',truckId);form.append('number',number);form.append('issuedOn',issuedOn);form.append('file',new Blob([bytes],{type:fileName.endsWith('.xml')?'application/xml':'application/pdf'}),fileName);
 return new Request('https://example.test/api/ctes',{method:'POST',body:form});
};

test('valida PDF e XML de CT-e e rejeita outros formatos e XMLs inválidos',()=>{
 assert.equal(inspectCte(pdf,'documento.pdf').mime,'application/pdf');
 assert.equal(inspectCte(xml,'documento.xml').mime,'application/xml');
 assert.throws(()=>inspectCte(pdf,'documento.xml'),/XML de CT-e válido/);
 assert.throws(()=>inspectCte(new TextEncoder().encode('texto'),'documento.xml'),/XML de CT-e válido/);
 assert.throws(()=>inspectCte(new Uint8Array([0]),'documento.exe'),/PDF ou XML/);
});

test('somente operador da transportadora envia e o servidor salva a fazenda e a placa selecionadas',async()=>{
 const {api,calls}=setup();const response=await api(formRequest());
 assert.equal(response.status,201);assert.equal(calls.upload.metadata.farmId,'farm-a');assert.equal(calls.upload.snapshot.plate,'ABC1D23');assert.equal(calls.upload.details.mime,'application/xml');
 const denied=await setup({party:'group'}).api(formRequest());assert.equal(denied.status,403);
 const viewer=await setup({role:'viewer'}).api(formRequest());assert.equal(viewer.status,403);
 await assert.rejects(()=>api(formRequest({farmId:'farm-b'})),/vinculada à fazenda/);
});

test('portal lista os documentos da empresa e fornece download privado por tempo limitado',async()=>{
 const {api}=setup({party:'group',role:'viewer'});const listed=await api(new Request('https://example.test/api/ctes'));
 assert.equal(listed.status,200);assert.equal((await listed.json()).documents[0].plate,'ABC1D23');
 const downloaded=await api(new Request('https://example.test/api/ctes/'+documentId));assert.equal(downloaded.status,200);assert.match((await downloaded.json()).signedUrl,/download=cte\.xml/);
 const unknown=await api(new Request('https://example.test/api/ctes/44444444-4444-4444-8444-444444444444'));assert.equal(unknown.status,404);
});
