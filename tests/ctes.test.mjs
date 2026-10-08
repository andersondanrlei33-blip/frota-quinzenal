import test from 'node:test';
import assert from 'node:assert/strict';
import {createCteApi,CTE_REPORT_COLUMNS,inspectCte,parseCtePdfText,parseCteXml} from '../server/ctes.js';

const companyId='11111111-1111-4111-8111-111111111111',userId='22222222-2222-4222-8222-222222222222',documentId='33333333-3333-4333-8333-333333333333';
const xml=new TextEncoder().encode(`<?xml version="1.0"?><cteProc xmlns="http://www.portalfiscal.inf.br/cte"><CTe><infCte><ide><nCT>123</nCT><dhEmi>2026-10-08T10:22:00-04:00</dhEmi><toma3><toma>3</toma></toma3></ide><emit><xNome>Transportadora Exemplo Ltda</xNome></emit><rem><xNome>Remetente Exemplo Ltda</xNome></rem><dest><xNome>Fazenda Exemplo SA</xNome></dest><vPrest><vTPrest>1250.75</vTPrest></vPrest><infCTeNorm><infModal><rodo><veic><placa>ABC1D23</placa></veic></rodo></infModal></infCTeNorm></infCte></CTe></cteProc>`);
const xmlToma4=new TextEncoder().encode(new TextDecoder().decode(xml).replace('<toma3><toma>3</toma></toma3>','<toma4><xNome>Tomador Contratante Ltda</xNome></toma4>'));
const pdf=new TextEncoder().encode('%PDF-1.7 fake');
const pdfText=`BARROS TRANSPORTES RODOVIARIOS LTDA DACTE Modal
Data Emissão
22/09/2026
Remetente: MORENA SEMENTES LTDA Destinatário: JOSE ALTAIR LAZAROTTO
Tomador Serviço: JOSE ALTAIR LAZAROTTO Município: LUCAS DO RIO VERDE CEP: 78450-000
VALOR TOTAL DO SERVIÇO
FRETE FRETE 46.875,32
OBSERVAÇÕES
Transporte Subcontratado com LANZA TRANSP DE CARGAS LTDA
SCANIA,Placas:BCD5C56,UF PR/Carreta:MLX6C23.
Motorista: JADSON LUCINDO DA SILVA,Placas: BCD5C56,Ano Fab.:2018`;
const state={farms:[{id:'farm-a',name:'Fazenda A',active:true},{id:'farm-b',name:'Fazenda B',active:true}],trucks:[{id:'truck-a',plate:'ABC1D23',driver:'João',farmId:'farm-a',start:'2026-10-01',end:''},{id:'truck-b',plate:'BCD5C56',driver:'Jadson',farmId:'farm-a',start:'2026-10-08',end:''}]};
function setup({party='carrier',role='operator',trucks=state.trucks}={}){
 const calls={};
 const backend={
  actor:async()=>({userId,email:'user@example.com',companyId,party,role}),
  responseJson:(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}}),
  repository:{load:async()=>({state:{...state,trucks}})},
  ctes:{
   getPreferences:async()=>null,
   savePreferences:async(_user,_company,prefs)=>{calls.preferences=prefs;return prefs;},
   list:async()=>[{id:documentId,farmId:'farm-a',farmName:'Fazenda A',truckId:'truck-a',plate:'ABC1D23',driver:'João',number:'123',issuedOn:'2026-10-08',uploadedAt:'2026-10-08T12:00:00Z',name:'cte.xml',mime:'application/xml',size:xml.length,objectKey:companyId+'/ctes/'+documentId+'/cte.xml'}],
   upload:async(actor,metadata,bytes,details,snapshot)=>{calls.upload={actor,metadata,bytes,details,snapshot};return {id:documentId,name:details.name,mime:details.mime,size:details.size};},
   find:async(idCompany,id)=>idCompany===companyId&&id===documentId?{name:'cte.xml',mime:'application/xml',objectKey:companyId+'/ctes/'+documentId+'/cte.xml'}:null,
   sign:async()=> 'https://storage.example/signed?download=cte.xml'
  }
 };
 return {api:createCteApi({backend,readPdf:async()=>pdfText}),calls};
}
const formRequest=({fileName='cte.xml',bytes=xml}={})=>{
 const form=new FormData();form.append('file',new Blob([bytes],{type:fileName.endsWith('.xml')?'application/xml':'application/pdf'}),fileName);
 return new Request('https://example.test/api/ctes',{method:'POST',body:form});
};

test('extrai automaticamente participantes, valor, data e placa do XML do CT-e',()=>{
 const parsed=parseCteXml(xml);assert.equal(parsed.issuer,'Transportadora Exemplo Ltda');assert.equal(parsed.recipient,'Fazenda Exemplo SA');assert.equal(parsed.shipper,'Remetente Exemplo Ltda');assert.equal(parsed.serviceTaker,'Fazenda Exemplo SA');assert.deepEqual(parsed.participantDetails.shipper,{city:'',stateRegistration:'',document:''});
 assert.equal(parseCteXml(xmlToma4).serviceTaker,'Tomador Contratante Ltda');
 const detailed=new TextEncoder().encode(new TextDecoder().decode(xml).replace('<emit><xNome>Transportadora Exemplo Ltda</xNome></emit>','<emit><CNPJ>12345678000199</CNPJ><IE>123456789</IE><xNome>Transportadora Exemplo Ltda</xNome><enderEmit><xMun>Cuiaba</xMun></enderEmit></emit>').replace('<rem><xNome>Remetente Exemplo Ltda</xNome></rem>','<rem><CNPJ>11222333000144</CNPJ><IE>987654321</IE><xNome>Remetente Exemplo Ltda</xNome><enderReme><xMun>Campo Novo</xMun></enderReme></rem>'));
 assert.deepEqual(parseCteXml(detailed).participantDetails.shipper,{city:'Campo Novo',stateRegistration:'987654321',document:'11222333000144'});
});

test('extrai automaticamente os campos importantes do texto do DACTE em PDF',()=>{
 const parsed=parseCtePdfText(pdfText);assert.equal(parsed.issuer,'BARROS TRANSPORTES RODOVIARIOS LTDA');assert.equal(parsed.recipient,'JOSE ALTAIR LAZAROTTO');assert.equal(parsed.shipper,'MORENA SEMENTES LTDA');assert.equal(parsed.serviceTaker,'JOSE ALTAIR LAZAROTTO');assert.equal(parsed.totalValue,46875.32);assert.equal(parsed.issuedOn,'2026-09-22');assert.equal(parsed.plate,'BCD5C56');assert.equal(parsed.number,'');assert.equal(parsed.participantDetails.serviceTaker.city,'LUCAS DO RIO VERDE');
 const detailed=parseCtePdfText(pdfText.replace('Tomador Serviço:', 'Município: CAMPO NOVO DO PARECIS CEP: 78360-000 Município: LUCAS DO RIO VERDE CEP: 78450-000\nCNPJ/CPF: 56.023.496/0001-73 Insc.Est: 140735488 CNPJ/CPF: 330.803.640-15 Insc.Est: 135597749\nTomador Serviço:'));
 assert.deepEqual(detailed.participantDetails.shipper,{city:'CAMPO NOVO DO PARECIS',stateRegistration:'140735488',document:'56.023.496/0001-73'});assert.deepEqual(detailed.participantDetails.recipient,{city:'LUCAS DO RIO VERDE',stateRegistration:'135597749',document:'330.803.640-15'});
});

test('valida assinatura e extensão do PDF e do XML e rejeita outros formatos',()=>{
 assert.equal(inspectCte(xml,'documento.xml').mime,'application/xml');
 assert.throws(()=>inspectCte(pdf,'documento.xml'),/XML de CT-e válido/);
 assert.throws(()=>inspectCte(new TextEncoder().encode('texto'),'documento.xml'),/XML de CT-e válido/);
 assert.equal(inspectCte(pdf,'documento.pdf').mime,'application/pdf');
 assert.throws(()=>inspectCte(new TextEncoder().encode('texto'),'documento.pdf'),/Envie o PDF/);
 assert.throws(()=>inspectCte(new Uint8Array([0]),'documento.exe'),/Envie o PDF/);
});

test('somente operador da transportadora envia e o servidor associa os dados extraídos ao caminhão e fazenda',async()=>{
 const {api,calls}=setup();const response=await api(formRequest());
 assert.equal(response.status,201);assert.equal(calls.upload.metadata.farmId,'farm-a');assert.equal(calls.upload.metadata.issuer,'Transportadora Exemplo Ltda');assert.equal(calls.upload.metadata.recipient,'Fazenda Exemplo SA');assert.equal(calls.upload.metadata.shipper,'Remetente Exemplo Ltda');assert.equal(calls.upload.metadata.serviceTaker,'Fazenda Exemplo SA');assert.equal(calls.upload.metadata.totalValue,1250.75);assert.equal(calls.upload.snapshot.plate,'ABC1D23');assert.equal(calls.upload.details.mime,'application/xml');
 const denied=await setup({party:'group'}).api(formRequest());assert.equal(denied.status,403);
 const viewer=await setup({role:'viewer'}).api(formRequest());assert.equal(viewer.status,403);
 const noMatchApi=createCteApi({backend:{actor:async()=>({userId,email:'user@example.com',companyId,party:'carrier',role:'operator'}),responseJson:(value,status=200)=>new Response(JSON.stringify(value),{status}),repository:{load:async()=>({state:{farms:state.farms,trucks:[]}})},ctes:{upload:async()=>{throw Error('unexpected');}}}});
 await assert.rejects(()=>noMatchApi(formRequest()),/Não encontrei a placa ABC1D23/);
});

test('transportadora envia PDF do DACTE e associa pela placa mesmo quando emissão antecede início cadastrado',async()=>{
 const {api,calls}=setup(),response=await api(formRequest({fileName:'cte.pdf',bytes:pdf}));
 assert.equal(response.status,201);assert.equal(calls.upload.metadata.issuer,'BARROS TRANSPORTES RODOVIARIOS LTDA');assert.equal(calls.upload.metadata.recipient,'JOSE ALTAIR LAZAROTTO');assert.equal(calls.upload.metadata.shipper,'MORENA SEMENTES LTDA');assert.equal(calls.upload.metadata.serviceTaker,'JOSE ALTAIR LAZAROTTO');assert.equal(calls.upload.metadata.totalValue,46875.32);assert.equal(calls.upload.metadata.issuedOn,'2026-09-22');assert.equal(calls.upload.metadata.plate,'BCD5C56');assert.equal(calls.upload.details.mime,'application/pdf');
});

test('não escolhe uma fazenda arbitrariamente quando existem vários cadastros sem correspondência de período',async()=>{
 const duplicate={...state.trucks[1],id:'truck-c',farmId:'farm-b'},trucks=[...state.trucks,duplicate],{api}=setup({trucks});
 await assert.rejects(()=>api(formRequest({fileName:'cte.pdf',bytes:pdf})),/mais de um cadastro para a placa BCD5C56/);
});

test('portal lista os documentos da empresa e fornece download privado por tempo limitado',async()=>{
 const {api}=setup({party:'group',role:'viewer'});const listed=await api(new Request('https://example.test/api/ctes'));
 assert.equal(listed.status,200);assert.equal((await listed.json()).documents[0].plate,'ABC1D23');
 const downloaded=await api(new Request('https://example.test/api/ctes/'+documentId));assert.equal(downloaded.status,200);assert.match((await downloaded.json()).signedUrl,/download=cte\.xml/);
 const unknown=await api(new Request('https://example.test/api/ctes/44444444-4444-4444-8444-444444444444'));assert.equal(unknown.status,404);
});

test('cada usuário salva sua seleção e ordem de colunas no portal da própria empresa',async()=>{
 const {api,calls}=setup({party:'group',role:'viewer'}),visibleColumns=['plate','shipperCity'],columnOrder=['plate','shipperCity',...CTE_REPORT_COLUMNS.filter(field=>!['plate','shipperCity'].includes(field))];
 const response=await api(new Request('https://example.test/api/ctes/preferences',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({visibleColumns,columnOrder})}));
 assert.equal(response.status,200);assert.deepEqual(calls.preferences.visibleColumns,visibleColumns);
 const invalid=await api(new Request('https://example.test/api/ctes/preferences',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({visibleColumns:['unknown'],columnOrder:['unknown']})}));assert.equal(invalid.status,400);
});
