import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,period,saveClosing,reopenClosing,today,validateState} from '../server/engine.js';
import {executeCommand} from '../server/commands.js';
import {presentState} from '../server/payment-portal.js';
import {createReceiptApi,fundingReceiptBelongsToHistory} from '../server/receipts.js';

const group={userId:'group-user',companyId:'company-one',role:'admin',party:'group',email:'group@example.test'};
const carrier={userId:'carrier-user',companyId:'company-one',role:'operator',party:'carrier',email:'carrier@example.test'};
const p=period('2026-10',1);
const command=(type,payload)=>({type,payload});
function closed(){
 const state=initialState();
 state.trucks=[{id:'truck-one',plate:'ABC1D23',driver:'Motorista',carrier:'Transportadora',farmId:'farm1',bodyType:'Caçamba',axles:9,monthly:30000,start:'2026-10-01',end:''}];
 saveClosing(state,p,'farm1','closing-one','2026-10-06');
 return state;
}
const create=state=>executeCommand(state,command('funding.create',{month:p.month,half:p.half,farmId:'farm1',amount:1,description:'Transporte da quinzena'}),group).state;
const proof=t=>({id:'d219975c-15e8-4d98-8ff2-a9b489b0f043',transferId:t.id,companyId:group.companyId,uploadedBy:carrier.userId,name:'recibo-assinado.pdf',mime:'application/pdf',size:400});

test('carrier gets configured receipt details for an older outstanding request without a saved profile snapshot',()=>{
 const state=create(closed()),transfer=state.fundingTransfers[0];delete transfer.receiptProfile;state.settings.receiptProfile={carrierLegalName:'Transportadora Teste',carrierDocument:'12345678000199',bankName:'Banco Teste'};
 const carrierView=presentState({state,revision:4,company:{id:group.companyId}},carrier);
 assert.equal(carrierView.state,null);assert.deepEqual(carrierView.fundingTransfers[0].receiptProfile,state.settings.receiptProfile);
});

test('the receipt amount is the farm fortnight net total and stays separate from driver payments',()=>{
 const state=create(closed());const t=state.fundingTransfers[0];
 assert.equal(t.status,'awaiting_receipt');assert.equal(t.amount,state.closings[0].rows.filter(row=>row.farmId==='farm1').reduce((n,row)=>n+row.net,0));assert.deepEqual(t.rows.map(row=>({plate:row.plate,driver:row.driver,net:row.net})),state.closings[0].rows.filter(row=>row.farmId==='farm1'&&!row.paid).map(row=>({plate:row.plate,driver:row.driver,net:row.net})));assert.equal(state.closings[0].rows[0].paid,null);
 assert.throws(()=>executeCommand(state,command('funding.record',{id:t.id,date:today()}),group),/recibo assinado/);
 assert.throws(()=>executeCommand(state,command('funding.receipt',{id:t.id}),group,{fundingReceipt:proof(t)}),/transportadora/);
 for(const wrong of [null,{...proof(t),companyId:'other'},{...proof(t),transferId:'other'},{...proof(t),uploadedBy:'other'}])assert.throws(()=>executeCommand(state,command('funding.receipt',{id:t.id}),carrier,{fundingReceipt:wrong}),/recibo assinado válido/);
 const attached=executeCommand(state,command('funding.receipt',{id:t.id}),carrier,{fundingReceipt:proof(t)}).state;
 assert.equal(attached.fundingTransfers[0].status,'receipt_submitted');assert.equal(fundingReceiptBelongsToHistory(attached,t.id,proof(t).id),true);
 const paid=executeCommand(attached,command('funding.record',{id:t.id,date:today(),reference:'TED 123'}),group).state;
 assert.equal(paid.fundingTransfers[0].status,'transferred');assert.equal(paid.fundingTransfers[0].transfer.reference,'TED 123');
 assert.equal(paid.closings[0].rows[0].paid,null);assert.equal(paid.paymentRequests.length,0);
 assert.deepEqual(validateState(paid),paid);
 assert.throws(()=>executeCommand(paid,command('funding.cancel',{id:t.id,reason:'Erro'}),group),/não pode ser cancelada/);
 assert.throws(()=>reopenClosing(paid,p,'farm1'),/Transferências já efetuadas/);
});

test('already paid plates are left out of the receipt amount, and fully paid farms are rejected',()=>{
 const details=(holder,pixKey)=>({method:'pix',holder,document:'12345678901',pixKey});
 let state=initialState();state.trucks=[
  {id:'truck-one',plate:'ABC1D23',driver:'Pago',carrier:'Transportadora',farmId:'farm1',bodyType:'Caçamba',axles:9,monthly:30000,start:'2026-10-01',end:'',paymentDetails:details('Pago','pago@example.test')},
  {id:'truck-two',plate:'DEF4G56',driver:'Pendente',carrier:'Transportadora',farmId:'farm1',bodyType:'Graneleiro',axles:7,monthly:30000,start:'2026-10-01',end:'',paymentDetails:details('Pendente','pendente@example.test')}
 ];saveClosing(state,p,'farm1','closing-one','2026-10-06');
 state=executeCommand(state,command('payment.request',{month:p.month,half:p.half,farmId:'farm1'}),group).state;
 let request=state.paymentRequests[0];
 const paymentProof={id:'acfdc2e3-1189-4117-9a77-2fb39015b0c1',requestId:request.id,companyId:group.companyId,uploadedBy:carrier.userId,name:'pagamento.pdf',mime:'application/pdf',size:400};
 state=executeCommand(state,command('payment.record',{requestId:request.id,date:today()}),carrier,{receipt:paymentProof}).state;
 const unpaid=state.closings.flatMap(c=>c.rows).filter(row=>row.farmId==='farm1'&&!row.paid);
 const withOnePaid=create(state);assert.equal(withOnePaid.fundingTransfers[0].amount,unpaid.reduce((sum,row)=>sum+row.net,0));
 request=state.paymentRequests.find(item=>item.status==='pending');
 const secondProof={...paymentProof,id:'c343dd21-3504-4e6c-a4ea-61e0a76c1423',requestId:request.id};
 state=executeCommand(state,command('payment.record',{requestId:request.id,date:today()}),carrier,{receipt:secondProof}).state;
 assert.throws(()=>create(state),/Não há placas pendentes/);
});

test('only one active fortnight receipt is allowed, cancellation preserves its signed receipt, and carrier sees no truck register',()=>{
 const first=create(closed());
 assert.throws(()=>create(first),/Já existe um recibo solicitado/);
 assert.throws(()=>executeCommand(first,command('funding.create',{month:p.month,half:p.half,farmId:'farm1',description:'Adiantamento'}),carrier),/transportadora/);
 const t=first.fundingTransfers[0],attached=executeCommand(first,command('funding.receipt',{id:t.id}),carrier,{fundingReceipt:proof(t)}).state;
 const cancelled=executeCommand(attached,command('funding.cancel',{id:t.id,reason:'Valor substituído'}),group).state;
 assert.equal(cancelled.fundingTransfers[0].status,'cancelled');assert.equal(cancelled.fundingTransfers[0].receipt.id,proof(t).id);
 assert.equal(fundingReceiptBelongsToHistory(cancelled,t.id,proof(t).id),true);
 const recreated=create(cancelled);assert.equal(recreated.fundingTransfers.length,2);assert.throws(()=>create(recreated),/Já existe um recibo solicitado/);
 const carrierView=presentState({state:recreated,revision:4,company:{id:group.companyId}},carrier);
 assert.equal(carrierView.state,null);assert.equal(carrierView.fundingTransfers.length,2);assert.equal(carrierView.fundingTransfers[0].receipt.name,'recibo-assinado.pdf');
 assert.throws(()=>executeCommand(recreated,command('backup.import',{state:initialState()}),group),/histórico de recibos/);
});

test('signed receipt upload and viewing are restricted to the carrier and its company',async()=>{
 let state=create(closed()),saved;
 const t=state.fundingTransfers[0];
 const backend={
  actor:async request=>request.headers.get('Authorization')==='Bearer carrier'?carrier:request.headers.get('Authorization')==='Bearer other'?{...group,companyId:'other-company'}:request.headers.has('Authorization')?group:null,
  responseJson:(data,status=200)=>Response.json(data,{status}),
  repository:{async load(){return {state};}},
  receipts:{async find(){return null;}},
  fundingReceipts:{
   async upload(actor,transferId,bytes,details){saved={...proof(t),transferId,companyId:actor.companyId,uploadedBy:actor.userId,...details};return saved;},
   async find(companyId,id){return saved?.companyId===companyId&&saved.id===id?saved:null;},
   async sign(){return 'https://files.test/signed';}
  }
 };
 const api=createReceiptApi({backend});
 const upload=user=>{const data=new FormData();data.append('transferId',t.id);data.append('file',new File(['%PDF-1.4\nFixture'],'recibo.pdf',{type:'application/pdf'}));return new Request('https://fleet.test/api/funding-receipts',{method:'POST',headers:user?{Authorization:'Bearer '+user}:{},body:data});};
 assert.equal((await api(upload('group'))).status,403);
 assert.equal((await api(upload('carrier'))).status,200);
 const read=user=>new Request('https://fleet.test/api/receipts/'+saved.id,{headers:user?{Authorization:'Bearer '+user}:{}});
 assert.equal((await api(read('group'))).status,404);
 state=executeCommand(state,command('funding.receipt',{id:t.id}),carrier,{fundingReceipt:saved}).state;
 assert.equal((await api(read(null))).status,401);
 assert.equal((await api(read('other'))).status,404);
 assert.equal((await api(read('group'))).status,200);
 assert.equal((await api(read('carrier'))).status,200);
});
