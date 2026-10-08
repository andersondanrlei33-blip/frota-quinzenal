import test from 'node:test';
import assert from 'node:assert/strict';
import {createCteApi,inspectCte,parseCteXml} from '../server/ctes.js';

const companyId='11111111-1111-4111-8111-111111111111',userId='22222222-2222-4222-8222-222222222222',documentId='33333333-3333-4333-8333-333333333333';
const xml=new TextEncoder().encode(`<?xml version="1.0"?><cteProc xmlns="http://www.portalfiscal.inf.br/cte"><CTe><infCte><ide><nCT>123</nCT><dhEmi>2026-10-08T10:22:00-04:00</dhEmi></ide><emit><xNome>Transportadora Exemplo Ltda</xNome></emit><dest><xNome>Fazenda Exemplo SA</xNome></dest><vPrest><vTPrest>1250.75</vTPrest></vPrest><infCTeNorm><infModal><rodo><veic><placa>ABC1D23</placa></veic></rodo></infModal></infCTeNorm></infCte></CTe></cteProc>`);
const pdf=new TextEncoder().encode('%PDF-1.7 fake');
const state={farms:[{id:'farm-a',name:'Fazenda A',active:true},{id:'farm-b',name:'Fazenda B',active:true}],trucks:[{id:'truck-a',plate:'ABC1D23',driver:'João',farmId:'farm-a',start:'2026-10-01',end:''}]};
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
const formRequest=({fileName='cte.xml',bytes=xml}={})=>{
 const form=new FormData();form.append('file',new Blob([bytes],{type:fileName.endsWith('.xml')?'application/xml':'application/pdf'}),fileName);
 return new Request('https://example.test/api/ctes',{method:'POST',body:form});
};

test('extrai automaticamente emitente, destinatário, valor, data e placa do XML do CT-e',()=>{
 assert.deepEqual(parseCteXml(xml),{issuer:'Transportadora Exemplo Ltda',recipient:'Fazenda Exemplo SA',totalValue:1250.75,issuedOn:'2026-10-08',plate:'ABC1D23',number:'123'});
});

test('valida o XML e rejeita PDF, outros formatos e XMLs inválidos',()=>{
 assert.equal(inspectCte(xml,'documento.xml').mime,'application/xml');
 assert.throws(()=>inspectCte(pdf,'documento.xml'),/XML de CT-e válido/);
 assert.throws(()=>inspectCte(new TextEncoder().encode('texto'),'documento.xml'),/XML de CT-e válido/);
 assert.throws(()=>inspectCte(pdf,'documento.pdf'),/leitura automática/);
 assert.throws(()=>inspectCte(new Uint8Array([0]),'documento.exe'),/leitura automática/);
});

test('somente operador da transportadora envia e o servidor associa os dados extraídos ao caminhão e fazenda',async()=>{
 const {api,calls}=setup();const response=await api(formRequest());
 assert.equal(response.status,201);assert.equal(calls.upload.metadata.farmId,'farm-a');assert.equal(calls.upload.metadata.issuer,'Transportadora Exemplo Ltda');assert.equal(calls.upload.metadata.recipient,'Fazenda Exemplo SA');assert.equal(calls.upload.metadata.totalValue,1250.75);assert.equal(calls.upload.snapshot.plate,'ABC1D23');assert.equal(calls.upload.details.mime,'application/xml');
 const denied=await setup({party:'group'}).api(formRequest());assert.equal(denied.status,403);
 const viewer=await setup({role:'viewer'}).api(formRequest());assert.equal(viewer.status,403);
 const noMatchApi=createCteApi({backend:{actor:async()=>({userId,email:'user@example.com',companyId,party:'carrier',role:'operator'}),responseJson:(value,status=200)=>new Response(JSON.stringify(value),{status}),repository:{load:async()=>({state:{farms:state.farms,trucks:[]}})},ctes:{upload:async()=>{throw Error('unexpected');}}}});
 await assert.rejects(()=>noMatchApi(formRequest()),/Não encontrei essa placa/);
});

test('portal lista os documentos da empresa e fornece download privado por tempo limitado',async()=>{
 const {api}=setup({party:'group',role:'viewer'});const listed=await api(new Request('https://example.test/api/ctes'));
 assert.equal(listed.status,200);assert.equal((await listed.json()).documents[0].plate,'ABC1D23');
 const downloaded=await api(new Request('https://example.test/api/ctes/'+documentId));assert.equal(downloaded.status,200);assert.match((await downloaded.json()).signedUrl,/download=cte\.xml/);
 const unknown=await api(new Request('https://example.test/api/ctes/44444444-4444-4444-8444-444444444444'));assert.equal(unknown.status,404);
});
