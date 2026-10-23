import test from 'node:test';
import assert from 'node:assert/strict';
import {assertNfeMatchesFarm,createCteApi,CTE_BILLING_RATE_PER_TON,CTE_REPORT_COLUMNS,extractNfeCargoWeight,extractNfeParties,extractNfeVehiclePlate,inspectCte,inspectCtePaymentProof,inspectNfePdf,inspectNfeXml,parseCtePdfText,parseCteXml} from '../server/ctes.js';

const companyId='11111111-1111-4111-8111-111111111111',userId='22222222-2222-4222-8222-222222222222',documentId='33333333-3333-4333-8333-333333333333';
const xml=new TextEncoder().encode(`<?xml version="1.0"?><cteProc xmlns="http://www.portalfiscal.inf.br/cte"><CTe><infCte><ide><nCT>123</nCT><dhEmi>2026-10-08T10:22:00-04:00</dhEmi><toma3><toma>3</toma></toma3></ide><emit><xNome>Transportadora Exemplo Ltda</xNome></emit><rem><xNome>Remetente Exemplo Ltda</xNome></rem><dest><xNome>Fazenda Exemplo SA</xNome></dest><vPrest><vTPrest>1250.75</vTPrest></vPrest><infCTeNorm><infCarga><vCarga>1000</vCarga><proPred>Soja</proPred><infQ><cUnid>01</cUnid><tpMed>PESO BRUTO</tpMed><qCarga>44222.000</qCarga></infQ></infCarga><infModal><rodo><veic><placa>ABC1D23</placa></veic></rodo></infModal></infCTeNorm></infCte></CTe></cteProc>`);
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
PESO BRUTO: 44.222,000 KG
Transporte Subcontratado com LANZA TRANSP DE CARGAS LTDA
SCANIA,Placas:BCD5C56,UF PR/Carreta:MLX6C23.
Motorista: JADSON LUCINDO DA SILVA,Placas: BCD5C56,Ano Fab.:2018`;
const nfeIdentity=`DANFE
INSCRIÇÃO ESTADUAL INSC. ESTADUAL DO SUBST. TRIBUTÁRIO CNPJ
132603632 06.338.525/0001-18
DESTINATÁRIO/REMETENTE
NOME/RAZÃO SOCIAL CPF DATA DA EMISSÃO
FAZENDA A 123.456.789-01 08/10/2026
MUNICÍPIO FONE / FAX UF INSCRIÇÃO ESTADUAL
Nobres MT 133256820
CALCULO DO IMPOSTO`;
const foreignNfeIdentity=nfeIdentity.replace('FAZENDA A 123.456.789-01','FAZENDA ESTRANHA 89.971.568/0002-44').replace('133256820','133267750');
const state={farms:[{id:'farm-a',name:'Fazenda A',cpf:'123.456.789-01',stateRegistration:'133256820',active:true},{id:'farm-b',name:'Fazenda B',cnpj:'89.971.568/0002-44',stateRegistration:'133267750',active:true}],trucks:[{id:'truck-a',plate:'ABC1D23',driver:'João',farmId:'farm-a',start:'2026-10-01',end:''},{id:'truck-b',plate:'BCD5C56',driver:'Jadson',farmId:'farm-a',start:'2026-10-08',end:''}]};
function setup({party='carrier',role='operator',farmId='farm-a',trucks=state.trucks,repositoryState=null,request=null,documents=null,downloadCte=null,readNfePdf=async()=> 'DADOS DO TRANSPORTADOR\nPLACA DO VEÍCULO ABC1D23\nUF PR',nfeIdentityText=nfeIdentity}={}){
 const calls={};
 const backend={
  actor:async()=>({userId,email:'user@example.com',companyId,party,role,farmId}),
  responseJson:(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}}),
  repository:{load:async()=>({state:repositoryState||{...state,trucks}})},
  ctes:{
   getPreferences:async()=>null,
   savePreferences:async(_user,_company,prefs)=>{calls.preferences=prefs;return prefs;},
   list:async()=>documents||[{id:documentId,farmId:'farm-a',farmName:'Fazenda A',truckId:'truck-a',plate:'ABC1D23',driver:'João',number:'123',issuedOn:'2026-10-08',uploadedAt:'2026-10-08T12:00:00Z',name:'cte.xml',mime:'application/xml',size:xml.length,objectKey:companyId+'/ctes/'+documentId+'/cte.xml'}],
   download:async document=>downloadCte?downloadCte(document):xml,
   saveWeight:async(company,id,weight,unit)=>{calls.savedWeight={company,id,weight,unit};},
   upload:async(actor,metadata,bytes,details,snapshot)=>{calls.upload={actor,metadata,bytes,details,snapshot};return {id:documentId,name:details.name,mime:details.mime,size:details.size};},
   recordPayment:async(actor,id,bytes,details)=>{calls.payment={actor,id,bytes,details};return {id,farmId:actor.farmId,paymentReceipt:{id:'77777777-7777-4777-8777-777777777777',name:details.name,mime:details.mime,size:details.size,uploadedBy:actor.userId,paidAt:'2026-10-14T18:00:00.000Z',objectKey:companyId+'/cte-billing/'+id+'/receipt.pdf'}};},
   recordPaymentBatch:async(actor,ids,bytes,details)=>{calls.paymentBatch={actor,ids,bytes,details};return ids.map(id=>({id,farmId:actor.farmId,paymentReceipt:{id:'77777777-7777-4777-8777-777777777777',name:details.name,mime:details.mime,size:details.size,uploadedBy:actor.userId,paidAt:'2026-10-14T18:00:00.000Z',objectKey:companyId+'/cte-billing/batches/receipt.pdf'}}));},
   signPaymentProof:async()=> 'https://storage.example/signed?download=receipt.pdf',
   find:async(idCompany,id)=>idCompany===companyId&&id===documentId?{name:'cte.xml',mime:'application/xml',objectKey:companyId+'/ctes/'+documentId+'/cte.xml'}:null,
   sign:async()=> 'https://storage.example/signed?download=cte.xml'
  },
  cteRequests:{
   list:async(_company,farm)=>{calls.requestListFarm=farm;return request?[request]:[];},
   find:async(_company,id)=>request?.id===id?request:null,
   create:async(actor,truck,farm,invoiceKeys,note,invoiceFiles)=>{calls.request={actor,truck,farm,invoiceKeys,note,invoiceFiles};return {id:'55555555-5555-4555-8555-555555555555',farmId:farm.id,plate:truck.plate,invoiceKeys,status:'pending'};},
   signFile:async()=> 'https://storage.example/signed?download=nota.xml',
   downloadFile:async()=>pdf,
   cancel:async(_company,id)=>{calls.cancelledRequestId=id;return {...request,status:'cancelled'};}
  }
 };
 return {api:createCteApi({backend,readPdf:async()=>pdfText,readNfePdf:async bytes=>(await readNfePdf(bytes))+'\n'+nfeIdentityText}),calls};
}
const formRequest=({fileName='cte.xml',bytes=xml,confirmHighValue=false}={})=>{
 const form=new FormData();if(confirmHighValue)form.append('confirmHighValue','true');form.append('file',new Blob([bytes],{type:fileName.endsWith('.xml')?'application/xml':'application/pdf'}),fileName);
 return new Request('https://example.test/api/ctes',{method:'POST',body:form});
};

test('extrai automaticamente participantes, valor, data e placa do XML do CT-e',()=>{
 const parsed=parseCteXml(xml);assert.equal(parsed.issuer,'Transportadora Exemplo Ltda');assert.equal(parsed.recipient,'Fazenda Exemplo SA');assert.equal(parsed.shipper,'Remetente Exemplo Ltda');assert.equal(parsed.serviceTaker,'Fazenda Exemplo SA');assert.equal(parsed.cargoWeight,44222);assert.equal(parsed.cargoWeightUnit,'kg');assert.deepEqual(parsed.participantDetails.shipper,{city:'',stateRegistration:'',cnpj:'',cpf:''});
 assert.equal(parseCteXml(xmlToma4).serviceTaker,'Tomador Contratante Ltda');
 const accessKey='51260956023496000173550010000008571135775140',secondAccessKey=accessKey.slice(0,25)+'000000858'+accessKey.slice(34),withNotes=new TextEncoder().encode(new TextDecoder().decode(xml).replace('</infCTeNorm>','<infDoc><infNFe><chave>'+accessKey+'</chave></infNFe><infNFe><chave>'+secondAccessKey+'</chave></infNFe></infDoc></infCTeNorm>'));
 assert.deepEqual(parseCteXml(withNotes).manifestedNotes,['857','858']);
 assert.deepEqual(parseCteXml(withNotes).manifestedKeys,[accessKey,secondAccessKey]);
 const detailed=new TextEncoder().encode(new TextDecoder().decode(xml).replace('<emit><xNome>Transportadora Exemplo Ltda</xNome></emit>','<emit><CNPJ>12345678000199</CNPJ><IE>123456789</IE><xNome>Transportadora Exemplo Ltda</xNome><enderEmit><xMun>Cuiaba</xMun></enderEmit></emit>').replace('<rem><xNome>Remetente Exemplo Ltda</xNome></rem>','<rem><CNPJ>11222333000144</CNPJ><IE>987654321</IE><xNome>Remetente Exemplo Ltda</xNome><enderReme><xMun>Campo Novo</xMun></enderReme></rem>').replace('<dest><xNome>Fazenda Exemplo SA</xNome></dest>','<dest><CPF>12345678901</CPF><IE>1234567</IE><xNome>Fazenda Exemplo SA</xNome></dest>'));
 const detail=parseCteXml(detailed).participantDetails;assert.deepEqual(detail.shipper,{city:'Campo Novo',stateRegistration:'987654321',cnpj:'11.222.333/0001-44',cpf:''});assert.deepEqual(detail.recipient,{city:'',stateRegistration:'1234567',cnpj:'',cpf:'123.456.789-01'});
});

test('extrai automaticamente dados do DACTE e todas as notas manifestadas',()=>{
 const parsed=parseCtePdfText(pdfText);assert.equal(parsed.issuer,'BARROS TRANSPORTES RODOVIARIOS LTDA');assert.equal(parsed.recipient,'JOSE ALTAIR LAZAROTTO');assert.equal(parsed.shipper,'MORENA SEMENTES LTDA');assert.equal(parsed.serviceTaker,'JOSE ALTAIR LAZAROTTO');assert.equal(parsed.totalValue,46875.32);assert.equal(parsed.issuedOn,'2026-09-22');assert.equal(parsed.plate,'BCD5C56');assert.equal(parsed.cargoWeight,44222);assert.equal(parsed.cargoWeightUnit,'kg');assert.equal(parsed.number,'');assert.equal(parsed.participantDetails.serviceTaker.city,'LUCAS DO RIO VERDE');assert.deepEqual(parsed.manifestedNotes,['857','858']);assert.deepEqual(parsed.manifestedKeys,['51260956023496000173550010000008571135775140','51260956023496000173550010000008581135775140']);
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
 assert.equal(inspectNfePdf(bytes,'51260956023496000173550010000008571135775140.pdf').accessKey,'51260956023496000173550010000008571135775140');
 assert.throws(()=>inspectNfePdf(new TextEncoder().encode('nao e pdf'),'danfe.pdf'),/PDF válidos/);
 assert.throws(()=>inspectNfePdf(bytes,'danfe.xml'),/PDF válidos/);
});
test('confere CPF/CNPJ e inscrição estadual da fazenda no emitente ou destinatário do DANFE',()=>{
 const parties=extractNfeParties(nfeIdentity);
 assert.deepEqual(parties,{issuer:{document:'06338525000118',stateRegistration:'132603632',stateRegistrations:['132603632']},recipient:{document:'12345678901',stateRegistration:'133256820',stateRegistrations:['133256820']}});
 assert.deepEqual(assertNfeMatchesFarm(nfeIdentity,state.farms[0],'nota.pdf'),parties);
 assert.deepEqual(assertNfeMatchesFarm(nfeIdentity,{name:'Fornecedor',cnpj:'06.338.525/0001-18',stateRegistration:'132603632'},'nota.pdf'),parties);
 assert.throws(()=>assertNfeMatchesFarm(foreignNfeIdentity,state.farms[0],'nota.pdf'),/não corresponde à Fazenda A/);
 assert.throws(()=>assertNfeMatchesFarm('PLACA DO VEÍCULO ABC1D23',state.farms[0],'nota.pdf'),/DANFE legível/);
});
test('ignora o destinatário do cabeçalho e lê a seção completa do DANFE',()=>{
 const text='DESTINATARIO: JOSE ALTAIR LAZAROTTO\nIDENTIFICACAO DO EMITENTE\nCNPJ: 56.023.496/0001-73\nINSCRICAO ESTADUAL: 140735488\nDESTINATARIO / REMETENTE\nNOME / RAZAO SOCIAL\nJOSE ALTAIR LAZAROTTO\nCNPJ / CPF 330.803.640-15\nINSCRICAO ESTADUAL 135597749\nCALCULO DO IMPOSTO';
 const parties=extractNfeParties(text);
 assert.equal(parties.issuer.document,'56023496000173');
 assert.equal(parties.recipient.document,'33080364015');
 assert.equal(parties.recipient.stateRegistrations.includes('135597749'),true);
 assert.doesNotThrow(()=>assertNfeMatchesFarm(text,{name:'Fazenda Mafra',cpf:'330.803.640-15',stateRegistration:'135597749'},'nota.pdf'));
});
test('peso bruto da NF-e é lido e normalizado para kg',()=>{
 assert.deepEqual(extractNfeCargoWeight('PESO BRUTO\n44.222,000'),{cargoWeight:44222,cargoWeightUnit:'kg'});
 assert.deepEqual(extractNfeCargoWeight('PESO BRUTO: 44,222 t'),{cargoWeight:44222,cargoWeightUnit:'kg'});
 assert.deepEqual(extractNfeCargoWeight('PESO LÍQUIDO: 42.000,000'),{cargoWeight:null,cargoWeightUnit:null});
 assert.deepEqual(extractNfeCargoWeight('QUANTIDADE ESPÉCIE MARCA NÚMERO PESO BRUTO PESO LÍQUIDO\n75,00 SC 2.000,000 2.000,000'),{cargoWeight:2000,cargoWeightUnit:'kg'});
});

test('somente operador da transportadora envia e o servidor associa os dados extraídos ao caminhão e fazenda',async()=>{
 const {api,calls}=setup();const response=await api(formRequest());
 assert.equal(response.status,201);assert.equal(calls.upload.metadata.farmId,'farm-a');assert.equal(calls.upload.metadata.issuer,'Transportadora Exemplo Ltda');assert.equal(calls.upload.metadata.recipient,'Fazenda Exemplo SA');assert.equal(calls.upload.metadata.shipper,'Remetente Exemplo Ltda');assert.equal(calls.upload.metadata.serviceTaker,'Fazenda Exemplo SA');assert.equal(calls.upload.metadata.totalValue,1250.75);assert.equal(calls.upload.metadata.cargoWeight,44222);assert.equal(calls.upload.metadata.cargoWeightUnit,'kg');assert.equal(calls.upload.snapshot.plate,'ABC1D23');assert.equal(calls.upload.details.mime,'application/xml');
 const denied=await setup({party:'group'}).api(formRequest());assert.equal(denied.status,403);
 const viewer=await setup({role:'viewer'}).api(formRequest());assert.equal(viewer.status,403);
 const noMatchApi=createCteApi({backend:{actor:async()=>({userId,email:'user@example.com',companyId,party:'carrier',role:'operator'}),responseJson:(value,status=200)=>new Response(JSON.stringify(value),{status}),repository:{load:async()=>({state:{farms:state.farms,trucks:[]}})},ctes:{upload:async()=>{throw Error('unexpected');}}}});
 await assert.rejects(()=>noMatchApi(formRequest()),/Não encontrei a placa ABC1D23/);
});

test('CT-e acima de R$ 10.000 exige confirmação explícita e registra quem conferiu',async()=>{
 const highValueXml=new TextEncoder().encode(new TextDecoder().decode(xml).replace('<vTPrest>1250.75</vTPrest>','<vTPrest>10000.01</vTPrest>'));
 const makeForm=confirm=>{const form=new FormData();if(confirm)form.append('confirmHighValue','true');form.append('file',new Blob([highValueXml],{type:'application/xml'}),'cte.xml');return new Request('https://example.test/api/ctes',{method:'POST',body:form});};
 const blocked=setup({party:'carrier'});await assert.rejects(blocked.api(makeForm(false)),error=>error.code==='CTE_HIGH_VALUE'&&/10\.000,01.*acima de R\$ 10\.000,00/.test(error.message));assert.equal(blocked.calls.upload,undefined);
 const accepted=setup({party:'carrier'}),response=await accepted.api(makeForm(true));assert.equal(response.status,201);assert.equal(accepted.calls.upload.metadata.totalValue,10000.01);assert.equal(accepted.calls.upload.metadata.participantDetails.highValueAlert.threshold,10000);assert.equal(accepted.calls.upload.metadata.participantDetails.highValueAlert.confirmedBy,userId);assert.ok(accepted.calls.upload.metadata.participantDetails.highValueAlert.confirmedAt);
});

test('reúne alertas de valor alto e peso divergente antes de solicitar confirmação',async()=>{
 const request={id:'55555555-5555-4555-8555-555555555555',status:'pending',farmId:'farm-a',truckId:'truck-a',plate:'ABC1D23',invoiceKeys:[],invoiceFiles:[{name:'danfe.pdf',cargoWeight:50000,cargoWeightUnit:'kg'}]},highValueXml=new TextEncoder().encode(new TextDecoder().decode(xml).replace('<vTPrest>1250.75</vTPrest>','<vTPrest>46875.32</vTPrest>')),form=new FormData();
 form.append('requestId',request.id);form.append('file',new Blob([highValueXml],{type:'application/xml'}),'cte.xml');
 const {api,calls}=setup({party:'carrier',request});
 await assert.rejects(()=>api(new Request('https://example.test/api/ctes',{method:'POST',body:form})),error=>{assert.equal(error.code,'CTE_CONFIRMATIONS_REQUIRED');assert.equal(error.issues.length,2);assert.match(error.message,/valor do CT-e/);assert.match(error.message,/Peso diferente/);return true;});
 assert.equal(calls.upload,undefined);
 const accepted=setup({party:'carrier',request}),confirmed=new FormData();confirmed.append('requestId',request.id);confirmed.append('confirmAlerts','true');confirmed.append('file',new Blob([highValueXml],{type:'application/xml'}),'cte.xml');const response=await accepted.api(new Request('https://example.test/api/ctes',{method:'POST',body:confirmed}));assert.equal(response.status,201);assert.equal(accepted.calls.upload.metadata.participantDetails.weightConference.status,'different');assert.equal(accepted.calls.upload.metadata.participantDetails.highValueAlert.threshold,10000);
});

test('transportadora confirma divergência cadastral já autorizada pela fazenda',async()=>{
 const request={id:'55555555-5555-4555-8555-555555555555',status:'pending',farmId:'farm-a',truckId:'truck-a',plate:'ABC1D23',invoiceKeys:[],invoiceFiles:[{name:'danfe.pdf',cargoWeight:44222,cargoWeightUnit:'kg',farmMatch:'mismatch'}]},makeForm=confirm=>{const form=new FormData();form.append('requestId',request.id);if(confirm)form.append('confirmFarmMismatch','true');form.append('file',new Blob([xml],{type:'application/xml'}),'cte.xml');return new Request('https://example.test/api/ctes',{method:'POST',body:form});};
 const blocked=setup({party:'carrier',request,nfeIdentityText:foreignNfeIdentity});await assert.rejects(()=>blocked.api(makeForm(false)),error=>error.code==='CTE_FARM_MISMATCH'&&/divergência cadastral/.test(error.message));assert.equal(blocked.calls.upload,undefined);
 const accepted=setup({party:'carrier',request,nfeIdentityText:foreignNfeIdentity}),response=await accepted.api(makeForm(true));assert.equal(response.status,201);assert.deepEqual(accepted.calls.upload.metadata.participantDetails.farmMismatch.notes,['danfe.pdf']);assert.equal(accepted.calls.upload.metadata.participantDetails.farmMismatch.confirmedBy,userId);
});

test('CT-e exatamente em R$ 10.000 não exige confirmação adicional',async()=>{
 const tenThousandXml=new TextEncoder().encode(new TextDecoder().decode(xml).replace('<vTPrest>1250.75</vTPrest>','<vTPrest>10000.00</vTPrest>'));
 const {api,calls}=setup({party:'carrier'}),response=await api(formRequest({bytes:tenThousandXml}));assert.equal(response.status,201);assert.equal(calls.upload.metadata.totalValue,10000);assert.equal(calls.upload.metadata.participantDetails.highValueAlert,undefined);
});

test('transportadora envia PDF do DACTE e associa pela placa mesmo quando emissão antecede início cadastrado',async()=>{
 const {api,calls}=setup(),response=await api(formRequest({fileName:'cte.pdf',bytes:pdf,confirmHighValue:true}));
 assert.equal(response.status,201);assert.equal(calls.upload.metadata.issuer,'BARROS TRANSPORTES RODOVIARIOS LTDA');assert.equal(calls.upload.metadata.recipient,'JOSE ALTAIR LAZAROTTO');assert.equal(calls.upload.metadata.shipper,'MORENA SEMENTES LTDA');assert.equal(calls.upload.metadata.serviceTaker,'JOSE ALTAIR LAZAROTTO');assert.equal(calls.upload.metadata.totalValue,46875.32);assert.equal(calls.upload.metadata.issuedOn,'2026-09-22');assert.equal(calls.upload.metadata.plate,'BCD5C56');assert.equal(calls.upload.metadata.cargoWeight,44222);assert.equal(calls.upload.metadata.cargoWeightUnit,'kg');assert.deepEqual(calls.upload.metadata.manifestedNotes,['857','858']);assert.equal(calls.upload.details.mime,'application/pdf');
});

test('não escolhe uma fazenda arbitrariamente quando existem vários cadastros sem correspondência de período',async()=>{
 const duplicate={...state.trucks[1],id:'truck-c',farmId:'farm-b'},trucks=[...state.trucks,duplicate],{api}=setup({trucks});
 await assert.rejects(()=>api(formRequest({fileName:'cte.pdf',bytes:pdf,confirmHighValue:true})),/mais de um cadastro para a placa BCD5C56/);
});

test('portal lista os documentos da empresa e fornece download privado por tempo limitado',async()=>{
 const {api}=setup({party:'group',role:'viewer'});const listed=await api(new Request('https://example.test/api/ctes'));
 assert.equal(listed.status,200);const data=await listed.json();assert.equal(data.documents[0].plate,'ABC1D23');assert.equal(data.trucks.find(truck=>truck.id==='truck-a').start,'2026-10-01');assert.equal(data.trucks.find(truck=>truck.id==='truck-a').transferIn,null);
 const downloaded=await api(new Request('https://example.test/api/ctes/'+documentId));assert.equal(downloaded.status,200);assert.match((await downloaded.json()).signedUrl,/download=cte\.xml/);
 const unknown=await api(new Request('https://example.test/api/ctes/44444444-4444-4444-8444-444444444444'));assert.equal(unknown.status,404);
});
test('a lista lê e salva uma única vez o peso dos CT-es antigos sem expor o caminho do arquivo',async()=>{
 const oldDocument={id:documentId,farmId:'farm-a',farmName:'Fazenda A',truckId:'truck-a',plate:'ABC1D23',driver:'João',number:'123',issuedOn:'2026-10-08',uploadedAt:'2026-10-08T12:00:00Z',name:'cte.xml',mime:'application/xml',size:xml.length,cargoWeight:null,cargoWeightChecked:false,objectKey:companyId+'/ctes/'+documentId+'/cte.xml'}, {api,calls}=setup({party:'group',role:'viewer',documents:[oldDocument]});
 const listed=await api(new Request('https://example.test/api/ctes')),data=await listed.json();assert.equal(data.documents[0].cargoWeight,44222);assert.equal(data.documents[0].cargoWeightUnit,'kg');assert.equal(calls.savedWeight.weight,44222);assert.equal(calls.savedWeight.unit,'kg');assert.equal('objectKey' in data.documents[0],false);assert.equal('cargoWeightChecked' in data.documents[0],false);
});
test('CT-e portal endpoint does not return daily accrual amounts',async()=>{
 const group=setup({party:'carrier'}),groupResponse=await group.api(new Request('https://example.test/api/ctes?month=2026-10&half=1')),groupData=await groupResponse.json();
 assert.equal(groupResponse.status,200);assert.equal('accrualRows' in groupData,false);
 const sharedTruck={...state.trucks[0],id:'truck-shared',farmId:'farm-b',cteAllFarms:true},farm=setup({party:'farm',farmId:'farm-a',trucks:[...state.trucks,sharedTruck]}),farmResponse=await farm.api(new Request('https://example.test/api/ctes?month=2026-10&half=1')),farmData=await farmResponse.json();
 assert.equal(farmResponse.status,200);assert.equal('accrualRows' in farmData,false);assert.ok(farmData.trucks.some(truck=>truck.id==='truck-shared'&&truck.farmId==='farm-b'&&truck.cteAllFarms));assert.ok(farmData.trucks.some(truck=>truck.farmId==='farm-a'));
});

test('funcionário de fazenda solicita CT-e com uma ou várias NF-e apenas para suas placas',async()=>{
 const {api,calls}=setup({party:'farm',role:'operator'}),makeRequest=truckId=>{const form=new FormData();form.append('payload',JSON.stringify({truckId,note:'Manifestar carga da Fazenda A'}));form.append('invoicePdfs',new Blob([pdf],{type:'application/pdf'}),'danfe.pdf');return new Request('https://example.test/api/cte-requests',{method:'POST',body:form});};
 const request=makeRequest('truck-a'),response=await api(request);assert.equal(response.status,201);assert.equal(calls.request.actor.farmId,'farm-a');assert.equal(calls.request.truck.id,'truck-a');assert.deepEqual(calls.request.invoiceKeys,[]);
 const sharedTruck={...state.trucks[0],id:'truck-shared',farmId:'farm-b',cteAllFarms:true},shared=setup({party:'farm',role:'operator',trucks:[...state.trucks,sharedTruck]}),sharedResponse=await shared.api(makeRequest('truck-shared'));assert.equal(sharedResponse.status,201);assert.equal(shared.calls.request.truck.farmId,'farm-b');assert.equal(shared.calls.request.farm.id,'farm-a');
 const foreignApi=setup({party:'farm',trucks:[...state.trucks,{...state.trucks[1],id:'truck-c',farmId:'farm-b'}]}).api;await assert.rejects(()=>foreignApi(makeRequest('truck-c')),/não está disponível/);
 const endedApi=setup({party:'farm',trucks:[{...state.trucks[0],end:'2026-10-07'}]}).api;await assert.rejects(()=>endedApi(makeRequest('truck-a')),/não está disponível/);
 assert.equal((await setup({party:'farm',role:'viewer'}).api(request)).status,403);
});

test('recusa NF-e de outra fazenda mesmo quando o funcionário e a placa pertencem à fazenda do pedido',async()=>{
 const {api,calls}=setup({party:'farm',nfeIdentityText:foreignNfeIdentity}),form=new FormData();
 form.append('payload',JSON.stringify({truckId:'truck-a'}));form.append('invoicePdfs',new Blob([pdf],{type:'application/pdf'}),'marape.pdf');
 await assert.rejects(()=>api(new Request('https://example.test/api/cte-requests',{method:'POST',body:form})),/não corresponde à Fazenda A/);
 assert.equal(calls.request,undefined);
});

test('permite enviar NF-e divergente somente após confirmação explícita para conferência',async()=>{
 const {api,calls}=setup({party:'farm',nfeIdentityText:foreignNfeIdentity}),form=new FormData();
 form.append('payload',JSON.stringify({truckId:'truck-a',confirmFarmMismatch:true}));form.append('invoicePdfs',new Blob([pdf],{type:'application/pdf'}),'marape.pdf');
 const response=await api(new Request('https://example.test/api/cte-requests',{method:'POST',body:form}));
 assert.equal(response.status,201);assert.equal(calls.request.invoiceFiles[0].details.farmMatch,'mismatch');
});

test('funcionário envia uma ou mais NF-e somente em PDF, sem XML nem chave',async()=>{
 const {api,calls}=setup({party:'farm',role:'operator',readNfePdf:async()=> 'PLACA DO VEÍCULO ABC1D23\nPESO BRUTO\n44.222,000\nPESO LÍQUIDO\n44.222,000'}),pdf=new TextEncoder().encode('%PDF-1.7\nDANFE'),form=new FormData();
 form.append('payload',JSON.stringify({truckId:'truck-a',note:'Enviar as notas anexas'}));form.append('invoicePdfs',new Blob([pdf],{type:'application/pdf'}),'danfe-1.pdf');form.append('invoicePdfs',new Blob([pdf],{type:'application/pdf'}),'danfe-2.pdf');
 const response=await api(new Request('https://example.test/api/cte-requests',{method:'POST',body:form}));assert.equal(response.status,201);assert.deepEqual(calls.request.invoiceKeys,[]);assert.equal(calls.request.invoiceFiles.length,2);assert.deepEqual(calls.request.invoiceFiles.map(item=>item.details.mime),['application/pdf','application/pdf']);assert.deepEqual(calls.request.invoiceFiles.map(item=>item.details.cargoWeight),[44222,44222]);assert.deepEqual(calls.request.invoiceFiles.map(item=>item.details.cargoWeightUnit),['kg','kg']);
 const withoutPdf=new FormData();withoutPdf.append('payload',JSON.stringify({truckId:'truck-a',note:'Sem anexo'}));await assert.rejects(()=>api(new Request('https://example.test/api/cte-requests',{method:'POST',body:withoutPdf})),/Anexe ao menos um PDF/);
 const xmlOnly=new FormData();xmlOnly.append('payload',JSON.stringify({truckId:'truck-a'}));xmlOnly.append('invoiceFiles',new Blob(['<nfeProc/>'],{type:'application/xml'}),'nota.xml');await assert.rejects(()=>api(new Request('https://example.test/api/cte-requests',{method:'POST',body:xmlOnly})),/O arquivo não parece ser um XML de NF-e válido/);
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

test('cancela somente pedido pendente da própria fazenda e preserva a autorização da transportadora',async()=>{
 const requestId='55555555-5555-4555-8555-555555555555',request={id:requestId,status:'pending',farmId:'farm-a',invoiceKeys:[],invoiceFiles:[]},url=`https://example.test/api/cte-requests/${requestId}/cancel`;
 const own=setup({party:'farm',request}),response=await own.api(new Request(url,{method:'POST'}));assert.equal(response.status,200);assert.equal((await response.json()).request.status,'cancelled');assert.equal(own.calls.cancelledRequestId,requestId);
 assert.equal((await setup({party:'farm',farmId:'farm-b',request}).api(new Request(url,{method:'POST'}))).status,403);
 assert.equal((await setup({party:'farm',role:'viewer',request}).api(new Request(url,{method:'POST'}))).status,403);
 assert.equal((await setup({party:'carrier',request}).api(new Request(url,{method:'POST'}))).status,200);
});

test('impede devolver CT-e para pedido antigo cuja NF-e pertence a outra fazenda',async()=>{
 const requestId='55555555-5555-4555-8555-555555555555',request={id:requestId,status:'pending',farmId:'farm-a',truckId:'truck-a',plate:'ABC1D23',invoiceKeys:[],invoiceFiles:[{name:'marape.pdf',mime:'application/pdf',objectKey:companyId+'/'+requestId+'/marape.pdf',cargoWeight:44222,cargoWeightUnit:'kg'}]},form=new FormData();
 form.append('requestId',request.id);form.append('file',new Blob([xml],{type:'application/xml'}),'cte.xml');
 const {api,calls}=setup({party:'carrier',request,nfeIdentityText:foreignNfeIdentity});
 await assert.rejects(()=>api(new Request('https://example.test/api/ctes',{method:'POST',body:form})),/não corresponde à Fazenda A/);
 assert.equal(calls.upload,undefined);
});

test('acesso fiscal de funcionário só lista e baixa CT-es da fazenda vinculada',async()=>{
 const {api,calls}=setup({party:'farm',role:'operator',farmId:'farm-a'}),listed=await api(new Request('https://example.test/api/ctes')),data=await listed.json();
 assert.equal(listed.status,200);assert.equal(calls.requestListFarm,'farm-a');assert.deepEqual(data.farms.map(farm=>farm.id),['farm-a']);assert.ok(data.trucks.every(truck=>truck.farmId==='farm-a'));
 const foreign=await setup({party:'farm',role:'operator',farmId:'farm-b'}).api(new Request('https://example.test/api/ctes/'+documentId));assert.equal(foreign.status,404);
});

test('associar CT-e à solicitação exige que todas as NF-e pedidas apareçam no documento',async()=>{
 const key='51260956023496000173550010000008571135775140',second='51260956023496000173550010000008581135775140',request={id:'55555555-5555-4555-8555-555555555555',status:'pending',farmId:'farm-a',truckId:'truck-a',plate:'ABC1D23',invoiceKeys:[key,second],invoiceFiles:[{name:'danfe.pdf',cargoWeight:44222,cargoWeightUnit:'kg'}]};
 const withNotes=new TextEncoder().encode(new TextDecoder().decode(xml).replace('</infCTeNorm>','<infDoc><infNFe><chave>'+key+'</chave></infNFe><infNFe><chave>'+second+'</chave></infNFe></infDoc></infCTeNorm>'));
 const {api,calls}=setup({party:'carrier',request}),form=new FormData();form.append('requestId',request.id);form.append('file',new Blob([withNotes],{type:'application/xml'}),'cte.xml');
 const response=await api(new Request('https://example.test/api/ctes',{method:'POST',body:form}));assert.equal(response.status,201);assert.equal(calls.upload.metadata.requestId,request.id);
 const missing={...request,invoiceKeys:[key,'51260956023496000173550010000009991135775140']},secondSetup=setup({party:'carrier',request:missing}),badForm=new FormData();badForm.append('requestId',request.id);badForm.append('file',new Blob([withNotes],{type:'application/xml'}),'cte.xml');
 await assert.rejects(()=>secondSetup.api(new Request('https://example.test/api/ctes',{method:'POST',body:badForm})),/não contém a chave de acesso da\(s\) NF-e 999 solicitada\(s\)/);
});

test('carta de correção anexada permite confirmar placa diferente e associa o CT-e à placa do pedido',async()=>{
 const key='51260956023496000173550010000008571135775140',request={id:'55555555-5555-4555-8555-555555555555',status:'pending',farmId:'farm-a',truckId:'truck-a',plate:'ABC1D23',invoiceKeys:[key],invoiceFiles:[{id:'correction-one',name:'CARTA-CORRECAO-MINUTA-PLACA-ABC1D23.pdf',documentType:'correction'},{id:'danfe-one',name:'danfe.pdf',cargoWeight:44222,cargoWeightUnit:'kg'}]},withOtherPlate=new TextEncoder().encode(new TextDecoder().decode(xml).replace('<placa>ABC1D23</placa>','<placa>BCD5C56</placa>').replace('</infCTeNorm>','<infDoc><infNFe><chave>'+key+'</chave></infNFe></infDoc></infCTeNorm>'));
 const makeForm=confirm=>{const form=new FormData();form.append('requestId',request.id);if(confirm)form.append('confirmPlateCorrection','true');form.append('file',new Blob([withOtherPlate],{type:'application/xml'}),'cte.xml');return new Request('https://example.test/api/ctes',{method:'POST',body:form});};
 const withoutConfirmation=setup({party:'carrier',request});await assert.rejects(()=>withoutConfirmation.api(makeForm(false)),/Confira a carta de correção e confirme antes de enviar/);
 const {api,calls}=setup({party:'carrier',request}),response=await api(makeForm(true));assert.equal(response.status,201);assert.equal(calls.upload.metadata.plate,'ABC1D23');assert.equal(calls.upload.metadata.truckId,'truck-a');assert.equal(calls.upload.metadata.farmId,'farm-a');assert.equal(calls.upload.metadata.participantDetails.plateCorrection.documentPlate,'BCD5C56');assert.equal(calls.upload.metadata.participantDetails.plateCorrection.linkedPlate,'ABC1D23');assert.deepEqual(calls.upload.metadata.participantDetails.plateCorrection.files,['CARTA-CORRECAO-MINUTA-PLACA-ABC1D23.pdf']);assert.equal(calls.upload.metadata.participantDetails.plateCorrection.confirmedBy,userId);assert.ok(calls.upload.metadata.participantDetails.plateCorrection.confirmedAt);
});

test('peso do CT-e diferente da soma das NF-e exige confirmação e registra a divergência',async()=>{
 const request={id:'55555555-5555-4555-8555-555555555555',status:'pending',farmId:'farm-a',truckId:'truck-a',plate:'ABC1D23',invoiceKeys:[],invoiceFiles:[{name:'danfe.pdf',cargoWeight:50000,cargoWeightUnit:'kg'}]},form=confirm=>{const data=new FormData();data.append('requestId',request.id);if(confirm)data.append('confirmWeightCheck','true');data.append('file',new Blob([xml],{type:'application/xml'}),'cte.xml');return new Request('https://example.test/api/ctes',{method:'POST',body:data});};
 const first=setup({party:'carrier',request});await assert.rejects(first.api(form(false)),error=>error.code==='CTE_WEIGHT_MISMATCH'&&/CT-e 44\.222 kg; NF-e 50\.000 kg/.test(error.message));
 const accepted=setup({party:'carrier',request}),response=await accepted.api(form(true));assert.equal(response.status,201);assert.equal(accepted.calls.upload.metadata.participantDetails.weightConference.status,'different');assert.equal(accepted.calls.upload.metadata.participantDetails.weightConference.cteWeightKg,44222);assert.equal(accepted.calls.upload.metadata.participantDetails.weightConference.nfeWeightKg,50000);assert.equal(accepted.calls.upload.metadata.participantDetails.weightConference.confirmedBy,userId);
});

test('peso ilegível exige confirmação manual e registra que a comparação não foi possível',async()=>{
 const request={id:'55555555-5555-4555-8555-555555555555',status:'pending',farmId:'farm-a',truckId:'truck-a',plate:'ABC1D23',invoiceKeys:[],invoiceFiles:[{name:'danfe-antigo.pdf'}]},form=confirm=>{const data=new FormData();data.append('requestId',request.id);if(confirm)data.append('confirmWeightCheck','true');data.append('file',new Blob([xml],{type:'application/xml'}),'cte.xml');return new Request('https://example.test/api/ctes',{method:'POST',body:data});};
 const first=setup({party:'carrier',request});await assert.rejects(first.api(form(false)),error=>error.code==='CTE_WEIGHT_UNAVAILABLE'&&/Não consegui ler o peso da NF-e danfe-antigo\.pdf/.test(error.message));
 const accepted=setup({party:'carrier',request}),response=await accepted.api(form(true));assert.equal(response.status,201);assert.equal(accepted.calls.upload.metadata.participantDetails.weightConference.status,'unavailable');assert.equal(accepted.calls.upload.metadata.participantDetails.weightConference.cteWeightKg,44222);assert.equal(accepted.calls.upload.metadata.participantDetails.weightConference.confirmedBy,userId);
});

test('placa divergente sem carta de correção continua bloqueada',async()=>{
 const request={id:'55555555-5555-4555-8555-555555555555',status:'pending',farmId:'farm-a',truckId:'truck-a',plate:'ABC1D23',invoiceKeys:[]},withOtherPlate=new TextEncoder().encode(new TextDecoder().decode(xml).replace('<placa>ABC1D23</placa>','<placa>BCD5C56</placa>')),form=new FormData();form.append('requestId',request.id);form.append('confirmPlateCorrection','true');form.append('file',new Blob([withOtherPlate],{type:'application/xml'}),'cte.xml');
 const {api}=setup({party:'carrier',request});await assert.rejects(()=>api(new Request('https://example.test/api/ctes',{method:'POST',body:form})),/CT-e enviado é da placa BCD5C56, mas a solicitação é da placa ABC1D23/);
});

test('a tarifa por tonelada é calculada com o peso do CT-e',async()=>{
 const {api,calls}=setup({party:'carrier'}),response=await api(formRequest({confirmHighValue:true}));
 assert.equal(response.status,201);assert.equal(CTE_BILLING_RATE_PER_TON,2.50);assert.equal(calls.upload.metadata.billableTons,44.222);assert.equal(calls.upload.metadata.billingRate,2.50);assert.equal(calls.upload.metadata.billingAmount,110.56);
});

test('carta de correção pode acompanhar a solicitação sem ser tratada como NF-e',async()=>{
 const key='51260956023496000173550010000008571135775140',form=new FormData(),nfe=new TextEncoder().encode('%PDF-1.7\\nDANFE'),correction=new TextEncoder().encode('%PDF-1.7\\nCarta de correção');
 form.append('payload',JSON.stringify({truckId:'truck-a'}));form.append('invoicePdfs',new Blob([nfe],{type:'application/pdf'}),key+'.pdf');form.append('correctionFile',new Blob([correction],{type:'application/pdf'}),'Carta-Correcao.pdf');
 const {api,calls}=setup({party:'farm',readNfePdf:async()=> 'PLACA DO VEÍCULO ABC1D23'}),response=await api(new Request('https://example.test/api/cte-requests',{method:'POST',body:form}));
 assert.equal(response.status,201);assert.equal(calls.request.invoiceFiles.length,2);assert.equal(calls.request.invoiceFiles[0].details.accessKey,key);assert.equal(calls.request.invoiceFiles[1].details.documentType,'correction');assert.equal(calls.request.invoiceFiles[1].details.vehiclePlate,undefined);
});

test('bloqueia NF-e que já está em solicitação ou foi manifestada em outro CT-e',async()=>{
 const key='51260956023496000173550010000008571135775140',nfe=new TextEncoder().encode('%PDF-1.7\\nDANFE'),makeRequest=()=>{const form=new FormData();form.append('payload',JSON.stringify({truckId:'truck-a'}));form.append('invoicePdfs',new Blob([nfe],{type:'application/pdf'}),key+'.pdf');return new Request('https://example.test/api/cte-requests',{method:'POST',body:form});};
 const prior={id:'55555555-5555-4555-8555-555555555555',status:'issued',invoiceFiles:[{name:key+'.pdf'}]},requested=setup({party:'farm',request:prior,readNfePdf:async()=> 'PLACA DO VEÍCULO ABC1D23'});await assert.rejects(()=>requested.api(makeRequest()),/já foi solicitada ou manifestada/);assert.equal(requested.calls.request,undefined);
 const manifested=setup({party:'farm',documents:[{id:documentId,participantDetails:{manifestedKeys:[key]}}],readNfePdf:async()=> 'PLACA DO VEÍCULO ABC1D23'});await assert.rejects(()=>manifested.api(makeRequest()),/já foi solicitada ou manifestada/);assert.equal(manifested.calls.request,undefined);
});

test('fazenda anexa comprovante para marcar CT-e como pago; outros acessos são negados',async()=>{
 const form=new FormData();form.append('paymentProof',new Blob(['%PDF-1.7\\nrecibo'],{type:'application/pdf'}),'comprovante.pdf');
 const farm=setup({party:'farm',role:'operator'}),response=await farm.api(new Request('https://example.test/api/ctes/'+documentId+'/payment-proof',{method:'POST',body:form}));
 assert.equal(response.status,201);assert.equal(farm.calls.payment.id,documentId);assert.equal(farm.calls.payment.actor.farmId,'farm-a');assert.equal(farm.calls.payment.details.mime,'application/pdf');assert.equal((await response.json()).document.paymentReceipt.name,'comprovante.pdf');
 const carrier=await setup({party:'carrier'}).api(new Request('https://example.test/api/ctes/'+documentId+'/payment-proof',{method:'POST',body:form}));assert.equal(carrier.status,403);
});

test('fazenda paga uma seleção de CT-es usando um único comprovante',async()=>{
 const form=new FormData(),secondId='44444444-4444-4444-8444-444444444444';form.append('documentIds',JSON.stringify([documentId,secondId]));form.append('paymentProof',new Blob(['%PDF-1.7\nrecibo conjunto'],{type:'application/pdf'}),'comprovante-lote.pdf');
 const farm=setup({party:'farm',role:'operator'}),response=await farm.api(new Request('https://example.test/api/cte-payment-batches',{method:'POST',body:form}));
 assert.equal(response.status,201);assert.deepEqual(farm.calls.paymentBatch.ids,[documentId,secondId]);assert.equal(farm.calls.paymentBatch.details.mime,'application/pdf');assert.equal((await response.json()).documents.length,2);
 const carrier=await setup({party:'carrier'}).api(new Request('https://example.test/api/cte-payment-batches',{method:'POST',body:form}));assert.equal(carrier.status,403);
 const duplicateForm=new FormData();duplicateForm.append('documentIds',JSON.stringify([documentId,documentId]));duplicateForm.append('paymentProof',new Blob(['%PDF-1.7\nrecibo'],{type:'application/pdf'}),'comprovante.pdf');const duplicate=await setup({party:'farm'}).api(new Request('https://example.test/api/cte-payment-batches',{method:'POST',body:duplicateForm}));assert.equal(duplicate.status,400);
});

test('comprovante de pagamento valida assinatura real e extensão',()=>{
 assert.equal(inspectCtePaymentProof(new TextEncoder().encode('%PDF-1.7\\nrecibo'),'recibo.pdf').mime,'application/pdf');
 assert.equal(inspectCtePaymentProof(new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),'recibo.png').mime,'image/png');
 assert.throws(()=>inspectCtePaymentProof(new TextEncoder().encode('%PDF-1.7\\nrecibo'),'recibo.png'),/comprovante válido/);
});

test('cada usuário salva sua seleção e ordem de colunas no portal da própria empresa',async()=>{
 const {api,calls}=setup({party:'group',role:'viewer'}),mergedDocuments=['shipperDocument','recipientDocument','serviceTakerDocument','issuerDocument'],visibleColumns=['plate','shipperCity',...mergedDocuments],columnOrder=['plate','shipperCity',...mergedDocuments,...CTE_REPORT_COLUMNS.filter(field=>!['plate','shipperCity',...mergedDocuments].includes(field))];
 const response=await api(new Request('https://example.test/api/ctes/preferences',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({visibleColumns,columnOrder})}));
 assert.equal(response.status,200);assert.deepEqual(calls.preferences.visibleColumns,visibleColumns);
 assert.deepEqual(mergedDocuments.filter(field=>CTE_REPORT_COLUMNS.includes(field)),mergedDocuments);assert.equal(CTE_REPORT_COLUMNS.filter(field=>/^(shipper|recipient|serviceTaker|issuer)(Cnpj|Cpf)$/.test(field)).length,0);
 const invalid=await api(new Request('https://example.test/api/ctes/preferences',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({visibleColumns:['unknown'],columnOrder:['unknown']})}));assert.equal(invalid.status,400);
});


