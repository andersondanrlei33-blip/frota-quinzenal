import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,period,saveClosing,reopenClosing,validateState} from '../server/engine.js';
import {executeCommand} from '../server/commands.js';
import {presentState} from '../server/payment-portal.js';
import {inspectReceipt,RECEIPT_LIMIT,receiptBelongsToHistory} from '../server/receipts.js';
const group={userId:'group-user',email:'group@test.example',role:'admin',party:'group',companyId:'company-one'},carrier={userId:'carrier-user',email:'carrier@test.example',role:'operator',party:'carrier',companyId:'company-one'};
const p=period('2026-10',1);
function closed(){const s=initialState();s.trucks=s.farms.map((f,i)=>({id:'t'+i,plate:'ABC1D2'+i,driver:'Motorista '+i,carrier:'Contratado',farmId:f.id,bodyType:'Caçamba',axles:9,monthly:30000,start:'2026-10-01',end:''}));saveClosing(s,p,'','closing','2026-10-06');return s;}
const requested=()=>executeCommand(closed(),{type:'payment.request',payload:{month:p.month,half:p.half}},group).state;
const receipt=q=>({id:'d219975c-15e8-4d98-8ff2-a9b489b0f043',companyId:group.companyId,requestId:q.id,uploadedBy:carrier.userId,name:'comprovante.pdf',mime:'application/pdf',size:120});
const command=(type,payload)=>({type,payload});
test('the group requests all four farms once and carrier receives only approved payment snapshots',()=>{
 const state=requested();assert.equal(state.paymentRequests.length,4);assert.equal(new Set(state.paymentRequests.map(q=>q.snapshot.farmId)).size,4);assert.equal(state.paymentRequests.reduce((n,q)=>n+q.snapshot.net,0),60000);
 assert.throws(()=>executeCommand(state,command('payment.request',{month:p.month,half:p.half}),group),/Não há placas/);
 const dto=presentState({state,revision:2,company:{id:group.companyId}},carrier);assert.equal(dto.state,null);assert.equal(dto.requests.length,4);assert.equal(dto.user.party,'carrier');assert.ok(!('trucks' in dto));
 assert.throws(()=>executeCommand(state,command('truck.save',{}),carrier),/transportadora/);assert.throws(()=>executeCommand(state,command('payment.record',{requestId:state.paymentRequests[0].id,date:'2026-10-06'}),group),/acesso da transportadora/);
});
test('receipt identity, request, company and uploader are required before carrier can mark paid',()=>{
 const state=requested(),q=state.paymentRequests[0],c=command('payment.record',{requestId:q.id,date:'2026-10-06',note:'Transferência'});
 for(const proof of [null,{...receipt(q),requestId:'wrong'},{...receipt(q),companyId:'another-company'},{...receipt(q),uploadedBy:'another-user'}])assert.throws(()=>executeCommand(state,c,carrier,{receipt:proof}),/comprovante válido/);
 const paid=executeCommand(state,c,carrier,{receipt:receipt(q)}).state;assert.equal(paid.paymentRequests[0].status,'paid');assert.equal(paid.closings[0].rows[0].paid.receipt.name,'comprovante.pdf');assert.deepEqual(validateState(paid),paid);assert.equal(state.closings[0].rows[0].paid,null);
 assert.throws(()=>executeCommand(paid,c,carrier,{receipt:receipt(q)}),/não está disponível/);
});
test('requested closings are locked until cancellation and archived requests survive reopening',()=>{
 const state=requested(),q=state.paymentRequests[0];assert.throws(()=>reopenClosing(state,p,'farm1'),/Cancele/);
 assert.throws(()=>executeCommand(state,command('payment.cancel',{requestId:q.id,note:''}),group),/motivo/);
 const cancelled=executeCommand(state,command('payment.cancel',{requestId:q.id,note:'Corrigir desconto'}),group).state;reopenClosing(cancelled,p,'farm1');assert.equal(cancelled.paymentRequests[0].status,'cancelled');assert.equal(cancelled.closings[0].rows.length,3);assert.deepEqual(validateState(cancelled),cancelled);
 saveClosing(cancelled,p,'farm1','new-closing','2026-10-06');const resent=executeCommand(cancelled,command('payment.request',{month:p.month,half:p.half,farmId:'farm1'}),group).state;assert.equal(resent.paymentRequests.length,5);assert.equal(resent.paymentRequests[4].snapshot.net,15000);
});
test('payment corrections retain the prior receipt and cannot be made by the group',()=>{
 const state=requested(),q=state.paymentRequests[0],paid=executeCommand(state,command('payment.record',{requestId:q.id,date:'2026-10-06'}),carrier,{receipt:receipt(q)}).state;
 assert.throws(()=>executeCommand(paid,command('payment.undo',{requestId:q.id,note:'Corrigir'}),group),/transportadora/);
 const undone=executeCommand(paid,command('payment.undo',{requestId:q.id,note:'Registro duplicado'}),carrier).state;assert.equal(undone.paymentRequests[0].status,'pending');assert.equal(undone.paymentRequests[0].paymentHistory[0].payment.receipt.id,receipt(q).id);assert.equal(receiptBelongsToHistory(undone,q.id,receipt(q).id),true);
 assert.throws(()=>executeCommand(undone,command('backup.import',{state:initialState()}),group),/histórico/);
});
test('proof files are limited by actual bytes and content signature rather than extension',()=>{
 const pdf=new TextEncoder().encode('%PDF-1.4\nSample technical fixture');assert.equal(inspectReceipt(pdf,'arquivo.html').mime,'application/pdf');assert.equal(inspectReceipt(new Uint8Array([137,80,78,71,13,10,26,10]),'foto.png').mime,'image/png');assert.equal(inspectReceipt(new Uint8Array([255,216,255]),'foto.jpg').mime,'image/jpeg');
 assert.throws(()=>inspectReceipt(new TextEncoder().encode('<script>'), 'comprovante.pdf'),/PDF, JPG ou PNG/);assert.throws(()=>inspectReceipt(new Uint8Array(RECEIPT_LIMIT+1),'grande.pdf'),/10 MB/);
});
