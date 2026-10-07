import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,period,saveClosing} from '../server/engine.js';
import {executeCommand} from '../server/commands.js';
import {createReceiptApi} from '../server/receipts.js';
const group={userId:'group',companyId:'company-one',role:'admin',party:'group'},carrier={userId:'carrier',companyId:'company-one',role:'operator',party:'carrier'};
const responseJson=(value,status=200)=>Response.json(value,{status});
function setup(){
 const s=initialState();s.trucks=[{id:'t',plate:'ABC1D23',driver:'Motorista',carrier:'Contratado',farmId:'farm1',bodyType:'Caçamba',axles:9,monthly:30000,start:'2026-10-01',end:''}];saveClosing(s,period('2026-10',1),'','closing','2026-10-06');let state=executeCommand(s,{type:'payment.request',payload:{month:'2026-10',half:1}},group).state;
 let saved;const backend={actor:async request=>request.headers.get('Authorization')==='Bearer carrier'?carrier:request.headers.get('Authorization')==='Bearer other'?{...group,companyId:'other-company'}:request.headers.has('Authorization')?group:null,responseJson,repository:{async load(){return {state};}},receipts:{async upload(actor,requestId,bytes,details){saved={id:'de2d8f2c-452f-4916-aa4a-845b11249608',companyId:actor.companyId,uploadedBy:actor.userId,requestId,...details};return saved;},async find(company,id){return saved?.companyId===company&&saved.id===id?saved:null;},async sign(){return 'https://files.test/signed';}}};
 const api=createReceiptApi({backend});return {api,get:()=>({state,saved}),attach(){state=executeCommand(state,{type:'payment.record',payload:{requestId:state.paymentRequests[0].id,date:'2026-10-06'}},carrier,{receipt:saved}).state;}};
}
function upload(user,requestId,bytes='%PDF-1.4\nTechnical fixture'){const data=new FormData();data.append('requestId',requestId);data.append('file',new File([bytes],'comprovante.pdf',{type:'application/pdf'}));return new Request('https://fleet.test/api/receipts',{method:'POST',headers:user?{Authorization:'Bearer '+user}:{},body:data});}
test('only carrier operators can upload and files without a valid signature are rejected',async()=>{
 const testApp=setup(),id=testApp.get().state.paymentRequests[0].id;assert.equal((await testApp.api(upload(null,id))).status,401);assert.equal((await testApp.api(upload('group',id))).status,403);
 await assert.rejects(testApp.api(upload('carrier',id,'<html>fake</html>')),/PDF, JPG ou PNG/);assert.equal(testApp.get().saved,undefined);
 const accepted=await testApp.api(upload('carrier',id));assert.equal(accepted.status,200);assert.equal(testApp.get().saved.requestId,id);assert.equal(testApp.get().saved.uploadedBy,'carrier');assert.equal(testApp.get().saved.mime,'application/pdf');
});
test('receipt links require authentication, the same company and an attachment in payment history',async()=>{
 const testApp=setup(),id=testApp.get().state.paymentRequests[0].id;await testApp.api(upload('carrier',id));const receipt=testApp.get().saved;
 const read=user=>new Request('https://fleet.test/api/receipts/'+receipt.id,{headers:user?{Authorization:'Bearer '+user}:{}});
 assert.equal((await testApp.api(read('group'))).status,404);testApp.attach();assert.equal((await testApp.api(read(null))).status,401);assert.equal((await testApp.api(read('other'))).status,404);assert.equal((await testApp.api(read('group'))).status,200);assert.equal((await testApp.api(read('carrier'))).status,200);
});
