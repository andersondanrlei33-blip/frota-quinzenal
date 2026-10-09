import test from 'node:test';
import assert from 'node:assert/strict';
import {createCteApi,CTE_REPORT_COLUMNS,extractNfeVehiclePlate,inspectCte,inspectNfePdf,inspectNfeXml,parseCtePdfText,parseCteXml} from '../server/ctes.js';
import {days,period,today} from '../server/engine.js';

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
DOCUMENTOS ORIGINÁRIOS
TIPODOC CNPJ/CPF EMITENTE SÉRIE/NR.DOCUMENTO
NFE 56.023.496/0001-73 1/857
51260956023496000173550010000008571135775140
NFE 56.023.496/0001-73 1/858
51260956023496000173550010000008581135775140
OBSERVAÇÕES
Transporte Subcontratado com LANZA TRANSP DE CARGAS LTDA
SCANIA,Placas:BCD5C56,UF PR/Carreta:MLX6C23.
Motorista: JADSON LUCINDO DA SILVA,Placas: BCD5C56,Ano Fab.:2018`;
const state={farms:[{id:'farm-a',name:'Fazenda A',active:true},{id:'farm-b',name:'Fazenda B',active:true}],trucks:[{id:'truck-a',plate:'ABC1D23',driver:'João',farmId:'farm-a',start:'2026-10-01',end:''},{id:'truck-b',plate:'BCD5C56',driver:'Jadson',farmId:'farm-a',start:'2026-10-08',end:''}]};
function setup({party='carrier',role='operator',farmId='farm-a',trucks=state.trucks,repositoryState=null,request=null,readNfePdf=async()=> 'DADOS DO TRANSPORTADOR\nPLACA DO VEÍCULO ABC1D23\nUF PR'}={}){
 const calls={};
 const backend={
  actor:async()=>({userId,email:'user@example.com',companyId,party,role,farmId}),
  responseJson:(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}}),
  repository:{load:async()=>({state:repositoryState||{...state,trucks}})},
  ctes:{
   getPreferences:async()=>null,
   savePreferences:async(_user,_company,prefs)=>{calls.preferences=prefs;return prefs;},
   list:async()=>[{id:documentId,farmId:'farm-a',farmName:'Fazenda A',truckId:'truck-a',plate:'ABC1D23',driver:'João',number:'123',issuedOn:'2026-10-08',uploadedAt:'2026-10-08T12:00:00Z',name:'cte.xml',mime:'application/xml',size:xml.length,objectKey:companyId+'/ctes/'+documentId+'/cte.xml'}],
   upload:async(actor,metadata,bytes,details,snapshot)=>{calls.upload={actor,metadata,bytes,details,snapshot};return {id:documentId,name:details.name,mime:details.mime,size:details.size};},
   find:async(idCompany,id)=>idCompany===companyId&&id===documentId?{name:'cte.xml',mime:'application/xml',objectKey:companyId+'/ctes/'+documentId+'/cte.xml'}:null,
   sign:async()=> 'https://storage.example/signed?download=cte.xml'
  },
  cteRequests:{
   list:async(_company,farm)=>{calls.requestListFarm=farm;return request?[request]:[];},
   find:async(_company,id)=>request?.id===id?request:null,
   create:async(actor,truck,farm,invoiceKeys,note,invoiceFiles)=>{calls.request={actor,truck,farm,invoiceKeys,note,invoiceFiles};return {id:'55555555-5555-4555-8555-555555555555',farmId:farm.id,plate:truck.plate,invoiceKeys,status:'pending'};},
   signFile:async()=> 'https://storage.example/signed?download=nota.xml'
  }
 };
 return {api:createCteApi({backend,readPdf:async()=>pdfText,readNfePdf}),calls};
}
const formRequest=({fileName='cte.xml',bytes=xml}={})=>{
 const form=new FormData();form.append('file',new Blob([bytes],{type:fileName.endsWith('.xml')?'application/xml':'application/pdf'}),fileName);
 return new Request('https://example.test/api/ctes',{method:'POST',body:form});
};

test('extrai automaticamente participantes, valor, data e placa do XML do CT-e',()=>{
 const parsed=parseCteXml(xml);assert.equal(parsed.issuer,'Transportadora Exemplo Ltda');assert.equal(parsed.recipient,'Fazenda Exemplo SA');assert.equal(parsed.shipper,'Remetente Exemplo Ltda');assert.equal(parsed.serviceTaker,'Fazenda Exemplo SA');assert.deepEqual(parsed.participantDetails.shipper,{city:'',stateRegistration:'',cnpj:'',cpf:''});
 assert.equal(parseCteXml(xmlToma4).serviceTaker,'Tomador Contratante Ltda');
 const accessKey='51260956023496000173550010000008571135775140',secondAccessKey=accessKey.slice(0,25)+'000000858'+accessKey.slice(34),withNotes=new TextEncoder().encode(new TextDecoder().decode(xml).replace('</infCTeNorm>','<infDoc><infNFe><chave>'+accessKey+'</chave></infNFe><infNFe><chave>'+secondAccessKey+'</chave></infNFe></infDoc></infCTeNorm>'));
 assert.deepEqual(parseCteXml(withNotes).manifestedNotes,['857','858']);
 const detailed=new TextEncoder().encode(new TextDecoder().decode(xml).replace('<emit><xNome>Transportadora Exemplo Ltda</xNome></emit>','<emit><CNPJ>12345678000199</CNPJ><IE>123456789</IE><xNome>Transportadora Exemplo Ltda</xNome><enderEmit><xMun>Cuiaba</xMun></enderEmit></emit>').replace('<rem><xNome>Remetente Exemplo Ltda</xNome></rem>','<rem><CNPJ>11222333000144</CNPJ><IE>987654321</IE><xNome>Remetente Exemplo Ltda</xNome><enderReme><xMun>Campo Novo</xMun></enderReme></rem>').replace('<dest><xNome>Fazenda Exemplo SA</xNome></dest>','<dest><CPF>12345678901</CPF><IE>1234567</IE><xNome>Fazenda Exemplo SA</xNome></dest>'));
 const detail=parseCteXml(detailed).participantDetails;assert.deepEqual(detail.shipper,{city:'Campo Novo',stateRegistration:'987654321',cnpj:'11.222.333/0001-44',cpf:''});assert.deepEqual(detail.recipient,{city:'',stateRegistration:'1234567',cnpj:'',cpf:'123.456.789-01'});
});

test('extrai automaticamente dados do DACTE e todas as notas manifestadas',()=>{
 const parsed=parseCtePdfText(pdfText);assert.equal(parsed.issuer,'BARROS TRANSPORTES RODOVIARIOS LTDA');assert.equal(parsed.recipient,'JOSE ALTAIR LAZAROTTO');assert.equal(parsed.shipper,'MORENA SEMENTES LTDA');assert.equal(parsed.serviceTaker,'JOSE ALTAIR LAZAROTTO');assert.equal(parsed.totalValue,46875.32);assert.equal(parsed.issuedOn,'2026-09-22');assert.equal(parsed.plate,'BCD5C56');assert.equal(parsed.number,'');assert.equal(parsed.participantDetails.serviceTaker.city,'LUCAS DO RIO VERDE');assert.deepEqual(parsed.manifestedNotes,['857','858']);
 const detailed=parseCtePdfText(pdfText.replace('Tomador Serviço:', 'Município: CAMPO NOVO DO PARECIS CEP: 78360-000 Município: LUCAS DO RIO VERDE CEP: 78450-000\nCNPJ/CPF: 56.023.496/0001-73 Insc.Est: 140735488 CNPJ/CPF: 330.803.640-15 Insc.Est: 135597749\nTomador Serviço:'));
 assert.deepEqual(detailed.participantDetails.shipper,{city:'CAMPO NOVO DO PARECIS',stateRegistration:'140735488',cnpj:'56.023.496/0001-73',cpf:''});assert.deepEqual(detailed.participantDetails.recipient,{city:'LUCAS DO RIO VERDE',stateRegistration:'135597749',cnpj:'',cpf:'330.803.640-15'});assert.equal(detailed.participantDetails.serviceTaker.cpf,'330.803.640-15');
});

test('valida assinatura e extensão do PDF e do XML e rejeita outros formatos',()=>{
 assert.equal(inspectCte(xml,'documento.xml').mime,'application/xml');
 assert.throws(()=>inspectCte(pdf,'documento.xml'),/XML de CT-e válido/);
 assert.throws(()=>inspectCte(new TextEncoder().encode('texto'),'documento.xml'),/XML de CT-e válido/);
 assert.equal(inspectCte(pdf,'documento.pdf').mime,'application/pdf');
 assert.throws(()=>inspectCte(new TextEncoder().encode('texto'),'documento.pdf'),/Envie o PDF/);
 assert.throws(()=>inspectCte(new Uint8Array([0]),'documento.exe'),/Envie o PDF/);
});

test('lê a placa do DANFE em texto selecionável, com formatos antigos e Mercosul',()=>{
 assert.equal(extractNfeVehiclePlate('TRANSPORTADOR / VOLUMES TRANSPORTADOS\nPLACA DO VEÍCULO\nBCD5C56\nUF PR'),'BCD5C56');
 assert.equal(extractNfeVehiclePlate('PLACA DO VEÍCULO UF CNPJ / CPF\n1-Por conta do Dest\nBARROS TRANSPORTES RODOVIARIOS LTDA BCD5C56 PR 43.976.246/0002-97\nENDEREÇO MUNICÍPIO UF INSCRIÇÃO ESTADUAL'),'BCD5C56');
 assert.equal(extractNfeVehiclePlate('PLACA DO VEÍCULO: ABC-1234'),'ABC1234');
 assert.equal(extractNfeVehiclePlate('Documento sem placa'), '');
});

test('valida XML de NF-e, extrai a chave e rejeita XML fora do padrão fiscal',()=>{
 const accessKey='51260956023496000173550010000008571135775140',bytes=new TextEncoder().encode(`<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${accessKey}" versao="4.00"></infNFe></NFe></nfeProc>`);
 assert.deepEqual(inspectNfeXml(bytes,'nota.xml'),{name:'nota.xml',mime:'application/xml',extension:'xml',size:bytes.length,accessKey});
 assert.throws(()=>inspectNfeXml(new TextEncoder().encode('<!DOCTYPE NFe><NFe></NFe>'),'nota.xml'),/XML de NF-e válido/);
 assert.throws(()=>inspectNfeXml(new TextEncoder().encode('<nfeProc><NFe><infNFe/></NFe></nfeProc>'),'nota.xml'),/chave de acesso/);
 assert.throws(()=>inspectNfeXml(bytes,'nota.pdf'),/somente arquivos XML/);
});
test('valida PDF da NF-e sem exigir leitura da chave pelo PDF',()=>{
 const bytes=new TextEncoder().encode('%PDF-1.7\nconteudo de teste');
 assert.deepEqual(inspectNfePdf(bytes,'danfe.pdf'),{name:'danfe.pdf',mime:'application/pdf',extension:'pdf',size:bytes.length,accessKey:''});
 assert.throws(()=>inspectNfePdf(new TextEncoder().encode('nao e pdf'),'danfe.pdf'),/PDF válidos/);
 assert.throws(()=>inspectNfePdf(bytes,'danfe.xml'),/PDF válidos/);
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
 assert.equal(response.status,201);assert.equal(calls.upload.metadata.issuer,'BARROS TRANSPORTES RODOVIARIOS LTDA');assert.equal(calls.upload.metadata.recipient,'JOSE ALTAIR LAZAROTTO');assert.equal(calls.upload.metadata.shipper,'MORENA SEMENTES LTDA');assert.equal(calls.upload.metadata.serviceTaker,'JOSE ALTAIR LAZAROTTO');assert.equal(calls.upload.metadata.totalValue,46875.32);assert.equal(calls.upload.metadata.issuedOn,'2026-09-22');assert.equal(calls.upload.metadata.plate,'BCD5C56');assert.deepEqual(calls.upload.metadata.manifestedNotes,['857','858']);assert.equal(calls.upload.details.mime,'application/pdf');
});

test('não escolhe uma fazenda arbitrariamente quando existem vários cadastros sem correspondência de período',async()=>{
 const duplicate={...state.trucks[1],id:'truck-c',farmId:'farm-b'},trucks=[...state.trucks,duplicate],{api}=setup({trucks});
 await assert.rejects(()=>api(formRequest({fileName:'cte.pdf',bytes:pdf})),/mais de um cadastro para a placa BCD5C56/);
});

test('portal lista os documentos da empresa e fornece download privado por tempo limitado',async()=>{
 const {api}=setup({party:'group',role:'viewer'});const listed=await api(new Request('https://example.test/api/ctes'));
 assert.equal(listed.status,200);const data=await listed.json();assert.equal(data.documents[0].plate,'ABC1D23');assert.equal(data.trucks.find(truck=>truck.id==='truck-a').start,'2026-10-01');assert.equal(data.trucks.find(truck=>truck.id==='truck-a').transferIn,null);
 const downloaded=await api(new Request('https://example.test/api/ctes/'+documentId));assert.equal(downloaded.status,200);assert.match((await downloaded.json()).signedUrl,/download=cte\.xml/);
 const unknown=await api(new Request('https://example.test/api/ctes/44444444-4444-4444-8444-444444444444'));assert.equal(unknown.status,404);
});
test('carrier receives only per-plate accrual totals for the selected fortnight',async()=>{
 const p=period(today().slice(0,7),Number(today().slice(8))<=15?1:2),truck={...state.trucks[0],monthly:40000,start:p.start,end:''},repositoryState={...state,trucks:[truck],settings:{mode:'half',fixedMonthlyVersion:1,includeStart:true,includeEnd:true},discounts:[],closings:[]};
 const {api}=setup({party:'carrier',trucks:[truck],repositoryState}),response=await api(new Request(`https://example.test/api/ctes?month=${p.month}&half=${p.half}`)),data=await response.json();
 assert.equal(response.status,200);assert.equal(data.accrualRows.length,1);assert.equal(data.accrualRows[0].plate,truck.plate);assert.equal(data.accrualRows[0].eligibleDays,days(p.start,today()));assert.ok(data.accrualRows[0].net>0);assert.equal('monthly' in data.accrualRows[0],false);assert.equal('events' in data.accrualRows[0],false);
});

test('farm portal receives accrual rows only for its assigned farm',async()=>{
 const p=period(today().slice(0,7),Number(today().slice(8))<=15?1:2),trucks=[{...state.trucks[0],monthly:40000,start:p.start,end:''},{...state.trucks[1],monthly:40000,start:p.start,end:'',farmId:'farm-b'}],repositoryState={...state,trucks,settings:{mode:'half',fixedMonthlyVersion:1,includeStart:true,includeEnd:true},discounts:[],closings:[]};
 const {api}=setup({party:'farm',farmId:'farm-a',trucks,repositoryState}),response=await api(new Request(`https://example.test/api/ctes?month=${p.month}&half=${p.half}`)),data=await response.json();
 assert.equal(response.status,200);assert.equal(data.accrualRows.length,1);assert.equal(data.accrualRows[0].farmId,'farm-a');assert.equal(data.accrualRows[0].plate,trucks[0].plate);assert.equal('monthly' in data.accrualRows[0],false);
});

test('funcionário de fazenda solicita CT-e com uma ou várias NF-e apenas para suas placas',async()=>{
 const {api,calls}=setup({party:'farm',role:'operator'}),makeRequest=truckId=>{const form=new FormData();form.append('payload',JSON.stringify({truckId,note:'Manifestar carga da Fazenda A'}));form.append('invoicePdfs',new Blob([pdf],{type:'application/pdf'}),'danfe.pdf');return new Request('https://example.test/api/cte-requests',{method:'POST',body:form});};
 const request=makeRequest('truck-a'),response=await api(request);assert.equal(response.status,201);assert.equal(calls.request.actor.farmId,'farm-a');assert.equal(calls.request.truck.id,'truck-a');assert.deepEqual(calls.request.invoiceKeys,[]);
 const foreignApi=setup({party:'farm',trucks:[...state.trucks,{...state.trucks[1],id:'truck-c',farmId:'farm-b'}]}).api;await assert.rejects(()=>foreignApi(makeRequest('truck-c')),/não está disponível/);
 const endedApi=setup({party:'farm',trucks:[{...state.trucks[0],end:'2026-10-07'}]}).api;await assert.rejects(()=>endedApi(makeRequest('truck-a')),/não está disponível/);
 assert.equal((await setup({party:'farm',role:'viewer'}).api(request)).status,403);
});

test('funcionário envia uma ou mais NF-e somente em PDF, sem XML nem chave',async()=>{
 const {api,calls}=setup({party:'farm',role:'operator'}),pdf=new TextEncoder().encode('%PDF-1.7\nDANFE'),form=new FormData();
 form.append('payload',JSON.stringify({truckId:'truck-a',note:'Enviar as notas anexas'}));form.append('invoicePdfs',new Blob([pdf],{type:'application/pdf'}),'danfe-1.pdf');form.append('invoicePdfs',new Blob([pdf],{type:'application/pdf'}),'danfe-2.pdf');
 const response=await api(new Request('https://example.test/api/cte-requests',{method:'POST',body:form}));assert.equal(response.status,201);assert.deepEqual(calls.request.invoiceKeys,[]);assert.equal(calls.request.invoiceFiles.length,2);assert.deepEqual(calls.request.invoiceFiles.map(item=>item.details.mime),['application/pdf','application/pdf']);
 const withoutPdf=new FormData();withoutPdf.append('payload',JSON.stringify({truckId:'truck-a',note:'Sem anexo'}));await assert.rejects(()=>api(new Request('https://example.test/api/cte-requests',{method:'POST',body:withoutPdf})),/Anexe ao menos um PDF/);
 const xmlOnly=new FormData();xmlOnly.append('payload',JSON.stringify({truckId:'truck-a'}));xmlOnly.append('invoiceFiles',new Blob(['<nfeProc/>'],{type:'application/xml'}),'nota.xml');await assert.rejects(()=>api(new Request('https://example.test/api/cte-requests',{method:'POST',body:xmlOnly})),/somente PDFs/);
});
test('funcionário envia PDF e a transportadora pode baixar o anexo',async()=>{
 const {api,calls}=setup({party:'farm',role:'operator'}),requestId='55555555-5555-4555-8555-555555555555',fileId='66666666-6666-4666-8666-666666666666',danfe=new TextEncoder().encode('%PDF-1.7\nDANFE'),form=new FormData();
 form.append('payload',JSON.stringify({truckId:'truck-a',note:'Imprimir para contabilidade'}));form.append('invoicePdfs',new Blob([danfe],{type:'application/pdf'}),'danfe.pdf');
 const response=await api(new Request('https://example.test/api/cte-requests',{method:'POST',body:form}));assert.equal(response.status,201);assert.equal(calls.request.invoiceFiles.length,1);assert.equal(calls.request.invoiceFiles[0].details.mime,'application/pdf');assert.equal(calls.request.invoiceFiles[0].details.vehiclePlate,'ABC1D23');assert.deepEqual(calls.request.invoiceKeys,[]);
 const saved={id:requestId,status:'pending',farmId:'farm-a',invoiceKeys:[],invoiceFiles:[{id:fileId,name:'danfe.pdf',mime:'application/pdf',objectKey:companyId+'/'+requestId+'/file.pdf'}]},download=await setup({party:'carrier',role:'operator',request:saved}).api(new Request(`https://example.test/api/cte-requests/${requestId}/files/${fileId}`));assert.equal(download.status,200);assert.equal((await download.json()).mime,'application/pdf');
});

test('recusa solicitação quando a placa selecionada diverge da placa da NF-e',async()=>{
 const {api,calls}=setup({party:'farm',role:'operator',readNfePdf:async()=> 'PLACA DO VEÍCULO BCD5C56'}),form=new FormData();
 form.append('payload',JSON.stringify({truckId:'truck-a'}));form.append('invoicePdfs',new Blob([pdf],{type:'application/pdf'}),'danfe.pdf');
 await assert.rejects(()=>api(new Request('https://example.test/api/cte-requests',{method:'POST',body:form})),/placa selecionada.*ABC1D23.*BCD5C56/);
 assert.equal(calls.request,undefined);
});

test('pede conferência quando o PDF não informa a placa do veículo',async()=>{
 const {api}=setup({party:'farm',role:'operator',readNfePdf:async()=> 'DANFE sem campo preenchido'}),form=new FormData();
 form.append('payload',JSON.stringify({truckId:'truck-a'}));form.append('invoicePdfs',new Blob([pdf],{type:'application/pdf'}),'danfe.pdf');
 await assert.rejects(()=>api(new Request('https://example.test/api/cte-requests',{method:'POST',body:form})),/Não consegui localizar a placa/);
});

test('XML anexado fica acessível somente à fazenda da solicitação e à equipe do grupo',async()=>{
 const requestId='55555555-5555-4555-8555-555555555555',fileId='66666666-6666-4666-8666-666666666666',invoiceFile={id:fileId,name:'nota.xml',mime:'application/xml',accessKey:'51260956023496000173550010000008571135775140',objectKey:companyId+'/'+requestId+'/'+fileId+'.xml'},request={id:requestId,status:'pending',farmId:'farm-a',truckId:'truck-a',plate:'ABC1D23',invoiceKeys:[invoiceFile.accessKey],invoiceFiles:[invoiceFile]};
 const response=await setup({party:'farm',role:'operator',farmId:'farm-a',request}).api(new Request(`https://example.test/api/cte-requests/${requestId}/files/${fileId}`));assert.equal(response.status,200);assert.match((await response.json()).signedUrl,/download=nota\.xml/);
 const denied=await setup({party:'farm',role:'operator',farmId:'farm-b',request}).api(new Request(`https://example.test/api/cte-requests/${requestId}/files/${fileId}`));assert.equal(denied.status,404);
 const carrier=await setup({party:'carrier',role:'operator',request}).api(new Request(`https://example.test/api/cte-requests/${requestId}/files/${fileId}`));assert.equal(carrier.status,200);
});

test('a listagem de solicitações nunca expõe os caminhos privados do Storage',async()=>{
 const request={id:'55555555-5555-4555-8555-555555555555',status:'pending',farmId:'farm-a',invoiceKeys:[],invoiceFiles:[{id:'66666666-6666-4666-8666-666666666666',name:'nota.xml',objectKey:companyId+'/privado/nota.xml'}]},listed=await setup({party:'carrier',role:'operator',request}).api(new Request('https://example.test/api/ctes'));
 assert.equal(listed.status,200);assert.equal((await listed.json()).requests[0].invoiceFiles[0].objectKey,undefined);
});

test('acesso fiscal de funcionário só lista e baixa CT-es da fazenda vinculada',async()=>{
 const {api,calls}=setup({party:'farm',role:'operator',farmId:'farm-a'}),listed=await api(new Request('https://example.test/api/ctes')),data=await listed.json();
 assert.equal(listed.status,200);assert.equal(calls.requestListFarm,'farm-a');assert.deepEqual(data.farms.map(farm=>farm.id),['farm-a']);assert.ok(data.trucks.every(truck=>truck.farmId==='farm-a'));
 const foreign=await setup({party:'farm',role:'operator',farmId:'farm-b'}).api(new Request('https://example.test/api/ctes/'+documentId));assert.equal(foreign.status,404);
});

test('associar CT-e à solicitação exige que todas as NF-e pedidas apareçam no documento',async()=>{
 const key='51260956023496000173550010000008571135775140',second='51260956023496000173550010000008581135775140',request={id:'55555555-5555-4555-8555-555555555555',status:'pending',farmId:'farm-a',truckId:'truck-a',plate:'ABC1D23',invoiceKeys:[key,second]};
 const withNotes=new TextEncoder().encode(new TextDecoder().decode(xml).replace('</infCTeNorm>','<infDoc><infNFe><chave>'+key+'</chave></infNFe><infNFe><chave>'+second+'</chave></infNFe></infDoc></infCTeNorm>'));
 const {api,calls}=setup({party:'carrier',request}),form=new FormData();form.append('requestId',request.id);form.append('file',new Blob([withNotes],{type:'application/xml'}),'cte.xml');
 const response=await api(new Request('https://example.test/api/ctes',{method:'POST',body:form}));assert.equal(response.status,201);assert.equal(calls.upload.metadata.requestId,request.id);
 const missing={...request,invoiceKeys:[key,'51260956023496000173550010000009991135775140']},secondSetup=setup({party:'carrier',request:missing}),badForm=new FormData();badForm.append('requestId',request.id);badForm.append('file',new Blob([withNotes],{type:'application/xml'}),'cte.xml');
 await assert.rejects(()=>secondSetup.api(new Request('https://example.test/api/ctes',{method:'POST',body:badForm})),/todas as NF-e solicitadas/);
});

test('cada usuário salva sua seleção e ordem de colunas no portal da própria empresa',async()=>{
 const {api,calls}=setup({party:'group',role:'viewer'}),mergedDocuments=['shipperDocument','recipientDocument','serviceTakerDocument','issuerDocument'],visibleColumns=['plate','shipperCity',...mergedDocuments],columnOrder=['plate','shipperCity',...mergedDocuments,...CTE_REPORT_COLUMNS.filter(field=>!['plate','shipperCity',...mergedDocuments].includes(field))];
 const response=await api(new Request('https://example.test/api/ctes/preferences',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({visibleColumns,columnOrder})}));
 assert.equal(response.status,200);assert.deepEqual(calls.preferences.visibleColumns,visibleColumns);
 assert.deepEqual(mergedDocuments.filter(field=>CTE_REPORT_COLUMNS.includes(field)),mergedDocuments);assert.equal(CTE_REPORT_COLUMNS.filter(field=>/^(shipper|recipient|serviceTaker|issuer)(Cnpj|Cpf)$/.test(field)).length,0);
 const invalid=await api(new Request('https://example.test/api/ctes/preferences',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({visibleColumns:['unknown'],columnOrder:['unknown']})}));assert.equal(invalid.status,400);
});
