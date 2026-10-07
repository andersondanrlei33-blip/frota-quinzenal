import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,period,saveClosing} from '../server/engine.js';
import {executeCommand} from '../server/commands.js';
import {createFleetApi} from '../server/api.js';
const accounts={group:{userId:'group',companyId:'one',party:'group',role:'admin'},carrier:{userId:'carrier',companyId:'one',party:'carrier',role:'operator'},viewer:{userId:'viewer',companyId:'one',party:'carrier',role:'viewer'}};
const http=(user,payload)=>new Request('https://fleet.test'+(payload?'/api/commands':'/api/state'),{method:payload?'POST':'GET',headers:{Authorization:'Bearer '+user,...(payload?{'Content-Type':'application/json'}:{})},body:payload?JSON.stringify(payload):undefined});
test('carrier API cannot retrieve group records or mark payment with a client-forged proof',async()=>{
 let s=initialState();s.trucks=[{id:'t',plate:'ABC1D23',driver:'Motorista',carrier:'Contratado',farmId:'farm1',bodyType:'Caçamba',axles:9,monthly:30000,start:'2026-10-01',end:''}];saveClosing(s,period('2026-10',1),'','closing','2026-10-06');s=executeCommand(s,{type:'payment.request',payload:{month:'2026-10',half:1}},accounts.group).state;
 let stored={state:s,revision:1,company:{id:'one',name:'Grupo'}};
 const repository={async load(){return structuredClone(stored);},async commit(company,revision,state){stored={...stored,state,revision:revision+1};return stored;},async verifyReceipt(){throw Error('Comprovante não encontrado.');}};
 const api=createFleetApi({repository,authenticate:async request=>accounts[request.headers.get('Authorization').slice(7)]});
 const read=await(await api(http('carrier'))).json();assert.equal(read.state,null);assert.equal(read.requests.length,1);assert.equal(read.trucks,undefined);
 assert.equal((await api(http('carrier',{type:'truck.save',payload:{},expectedRevision:1}))).status,403);
 const c={type:'payment.record',payload:{requestId:s.paymentRequests[0].id,receiptId:'forged',date:'2026-10-06',receipt:{id:'forged',uploadedBy:'carrier'}},expectedRevision:1};
 assert.equal((await api(http('group',c))).status,403);assert.equal((await api(http('viewer',c))).status,403);assert.equal((await api(http('carrier',c))).status,400);assert.equal(stored.revision,1);assert.equal(stored.state.closings[0].rows[0].paid,null);
});
