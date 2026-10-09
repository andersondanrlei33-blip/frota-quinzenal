import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,period,saveClosing,reopenClosing,validateState} from '../server/engine.js';
import {executeCommand} from '../server/commands.js';
import {presentState} from '../server/payment-portal.js';
import {inspectReceipt,RECEIPT_LIMIT,receiptBelongsToHistory} from '../server/receipts.js';
const group={userId:'group-user',email:'group@test.example',role:'admin',party:'group',companyId:'company-one'},carrier={userId:'carrier-user',email:'carrier@test.example',role:'operator',party:'carrier',companyId:'company-one'};
const p=period('2026-10',1);
function closed(){const s=initialState();s.trucks=s.farms.map((f,i)=>({id:'t'+i,plate:'ABC1D2'+i,driver:'Motorista '+i,carrier:'Contratado',farmId:f.id,bodyType:'Caçamba',axles:9,monthly:30000,start:'2026-10-01',end:'',paymentDetails:{method:'pix',holder:'Motorista '+i,document:'12345678901',pixKey:'motorista'+i+'@example.com'}}));saveClosing(s,p,'','closing','2026-10-06');return s;}
const requested=()=>executeCommand(closed(),{type:'payment.request',payload:{month:p.month,half:p.half}},group).state;
const receipt=q=>({id:'d219975c-15e8-4d98-8ff2-a9b489b0f043',companyId:group.companyId,requestId:q.id,uploadedBy:carrier.userId,name:'comprovante.pdf',mime:'application/pdf',size:120});
const command=(type,payload)=>({type,payload});
test('the group requests all four farms once and carrier receives only approved payment snapshots',()=>{
 const state=requested();assert.equal(state.paymentRequests.length,4);assert.equal(new Set(state.paymentRequests.map(q=>q.snapshot.farmId)).size,4);assert.equal(state.paymentRequests.reduce((n,q)=>n+q.snapshot.net,0),60000);
 assert.equal(state.paymentRequests[0].snapshot.paymentDetails.pixKey,'motorista0@example.com');
 assert.throws(()=>executeCommand(state,command('payment.request',{month:p.month,half:p.half}),group),/Não há placas/);
 const dto=presentState({state,revision:2,company:{id:group.companyId}},carrier);assert.equal(dto.state,null);assert.equal(dto.requests.length,4);assert.ok(dto.requests.every(request=>request.invoiceNumber===1));assert.equal(dto.user.party,'carrier');assert.ok(!('trucks' in dto));
 assert.throws(()=>executeCommand(state,command('truck.save',{}),carrier),/transportadora/);assert.throws(()=>executeCommand(state,command('payment.record',{requestId:state.paymentRequests[0].id,date:'2026-10-06'}),group),/acesso da transportadora/);
});
test('one bank account groups farm plates into one complete carrier payment',()=>{
 let state=initialState();const details={method:'pix',holder:'Titular Pix',document:'12345678901',pixKey:'conta@example.com'};state.trucks=[0,1].map(index=>({id:'joint-'+index,plate:'ABC1D2'+index,driver:'Motorista '+index,carrier:'Transportadora',farmId:'farm1',bodyType:'Caçamba',axles:9,monthly:30000,start:'2026-10-01',end:'',paymentDetails:details}));
 state=executeCommand(state,command('payment-account.save',{id:'pix-shared',farmId:'farm1',name:'Conta conjunta',details,truckIds:['joint-0','joint-1']}),group).state;saveClosing(state,p,'farm1','invoice-pix','2026-10-06');
 const sent=executeCommand(state,command('payment.request',{month:p.month,half:p.half,farmId:'farm1'}),group).state,[first,second]=sent.paymentRequests,proof=receipt(first);
 assert.equal(first.snapshot.paymentAccountId,'pix-shared');assert.equal(first.snapshot.paymentAccountName,'Conta conjunta');
 assert.throws(()=>executeCommand(sent,command('payment.record-batch',{requestIds:[first.id],date:'2026-10-06'}),carrier,{receipt:proof}),/Inclua todas as placas/);
 const paid=executeCommand(sent,command('payment.record-batch',{requestIds:[first.id,second.id],date:'2026-10-06'}),carrier,{receipt:proof}).state;
 assert.equal(paid.paymentRequests[0].payment.paymentGroupAmount,30000);assert.equal(paid.paymentRequests[0].payment.paymentGroupId,paid.paymentRequests[1].payment.paymentGroupId);assert.deepEqual(validateState(paid),paid);
});
test('a plate can be registered without banking data, but a request needs complete Pix or bank details',()=>{
 const state=closed();delete state.trucks[1].paymentDetails;const before=structuredClone(state);
 assert.throws(()=>executeCommand(state,command('payment.request',{month:p.month,half:p.half}),group),/ABC1D21.*forma de pagamento/);
 assert.deepEqual(state,before);
 const bank={method:'bank',holder:'Motorista 1',document:'12345678901',bankName:'Banco Exemplo',agency:'1234',account:'98765-0',accountType:'corrente'};
 const incomplete=executeCommand(state,command('truck.save',{...state.trucks[1],paymentDetails:{...bank,account:''}}),group).state;
 assert.throws(()=>executeCommand(incomplete,command('payment.request',{month:p.month,half:p.half}),group),/ABC1D21.*conta com dígito/);
 const complete=executeCommand(incomplete,command('truck.save',{...incomplete.trucks[1],paymentDetails:bank}),group).state;
 const sent=executeCommand(complete,command('payment.request',{month:p.month,half:p.half}),group).state;
 assert.equal(sent.paymentRequests.length,4);assert.equal(sent.paymentRequests[1].snapshot.paymentDetails.account,'98765-0');
});
test('the transporter sees the payment destination saved with the request, even after the plate is edited',()=>{
 const state=requested(),original=state.paymentRequests[0].snapshot.paymentDetails.pixKey;
 const updated=executeCommand(state,command('truck.save',{...state.trucks[0],paymentDetails:{...state.trucks[0].paymentDetails,pixKey:'nova-chave@example.com'}}),group).state;
 const carrierView=presentState({state:updated,revision:2,company:{id:group.companyId}},carrier);
 assert.equal(updated.trucks[0].paymentDetails.pixKey,'nova-chave@example.com');
 assert.equal(carrierView.requests[0].snapshot.paymentDetails.pixKey,original);
 const historical=structuredClone(updated);delete historical.paymentRequests[0].snapshot.paymentDetails;
 assert.throws(()=>executeCommand(historical,command('payment.record',{requestId:historical.paymentRequests[0].id,date:'2026-10-06'}),carrier,{receipt:receipt(historical.paymentRequests[0])}),/não tem dados de pagamento completos/);
});
test('receipt identity, request, company and uploader are required before carrier can mark paid',()=>{
 const state=requested(),q=state.paymentRequests[0],c=command('payment.record',{requestId:q.id,date:'2026-10-06',note:'Transferência'});
 for(const proof of [null,{...receipt(q),requestId:'wrong'},{...receipt(q),companyId:'another-company'},{...receipt(q),uploadedBy:'another-user'}])assert.throws(()=>executeCommand(state,c,carrier,{receipt:proof}),/comprovante válido/);
 const paid=executeCommand(state,c,carrier,{receipt:receipt(q)}).state;assert.equal(paid.paymentRequests[0].status,'paid');assert.equal(paid.closings[0].rows[0].paid.receipt.name,'comprovante.pdf');assert.deepEqual(validateState(paid),paid);assert.equal(state.closings[0].rows[0].paid,null);
 assert.throws(()=>executeCommand(paid,c,carrier,{receipt:receipt(q)}),/não está disponível/);
});
test('carrier can register one shared transfer across selected plates from the same invoice and Pix account',()=>{
 const state=initialState();state.trucks=[0,1].map(index=>({id:'shared-'+index,plate:'ABC1D2'+index,driver:'Motorista '+index,carrier:'Contratado',farmId:'farm1',bodyType:'Caçamba',axles:9,monthly:30000,start:'2026-10-01',end:'',paymentDetails:{method:'pix',holder:'Titular do Pix',document:'12345678901',pixKey:'chave-compartilhada@example.com'}}));saveClosing(state,p,'farm1','shared-invoice','2026-10-06');const sent=executeCommand(state,command('payment.request',{month:p.month,half:p.half,farmId:'farm1'}),group).state,first=sent.paymentRequests[0],second=sent.paymentRequests[1],proof=receipt(first);
 const saved=executeCommand(sent,command('payment.record-batch',{requestIds:[first.id,second.id],date:'2026-10-06',note:'Pix conjunto'}),carrier,{receipt:proof}).state;
 assert.equal(saved.paymentRequests[0].status,'paid');assert.equal(saved.paymentRequests[1].status,'paid');assert.equal(saved.paymentRequests[0].payment.paymentGroupId,saved.paymentRequests[1].payment.paymentGroupId);assert.equal(saved.paymentRequests[0].payment.paymentGroupAmount,30000);assert.equal(saved.paymentRequests[1].payment.paymentGroupAmount,30000);assert.equal(saved.paymentRequests[0].payment.receipt.id,saved.paymentRequests[1].payment.receipt.id);assert.equal(saved.closings[0].rows.filter(row=>row.paid).length,2);assert.deepEqual(validateState(saved),saved);
});
test('a joint payment refuses mixed farms, invoices or destinations without changing payment state',()=>{
 const state=requested(),before=structuredClone(state),proof=receipt(state.paymentRequests[0]);
 assert.throws(()=>executeCommand(state,command('payment.record-batch',{requestIds:[state.paymentRequests[0].id,state.paymentRequests[2].id],date:'2026-10-06'}),carrier,{receipt:proof}),/mesma fatura, fazenda e conta/);
 assert.deepEqual(state,before);
 state.paymentRequests[1].snapshot.paymentDetails.pixKey='other@example.com';
 assert.throws(()=>executeCommand(state,command('payment.record-batch',{requestIds:[state.paymentRequests[0].id,state.paymentRequests[1].id],date:'2026-10-06'}),carrier,{receipt:proof}),/mesma fatura, fazenda e conta/);
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
