import {period,periodClosings,applyFixedMonthlyRule,uid,validDate,today,paymentDetailsMissing,validatePaymentDetails} from './engine.js';
const fail=message=>{const error=Error(message);error.status=403;throw error;};
export const partyOf=actor=>actor?.party||'group';
export function authorizePortalCommand(command,actor){
 const party=partyOf(actor),payment=['payment.record','payment.undo','funding.receipt'].includes(command.type);
 if(party==='carrier'&&!payment)fail('A transportadora pode enviar recibos assinados e registrar pagamentos dos motoristas.');
 if(party==='group'&&['payment.record','funding.receipt'].includes(command.type))fail('Este documento deve ser enviado pelo acesso da transportadora.');
 if(party==='group'&&command.type==='payment.undo'&&actor.role!=='admin')fail('Somente a transportadora pode corrigir esse pagamento.');
}
export function requestPayments(state,payload,actor){
 applyFixedMonthlyRule(state);const p=period(payload.month,payload.half),batchId=uid(),at=new Date().toISOString(),selected=[];
 for(const closing of periodClosings(state,p))for(const row of closing.rows){
  if(payload.farmId&&row.farmId!==payload.farmId||payload.truckId&&row.truckId!==payload.truckId||payload.closingId&&closing.id!==payload.closingId)continue;
  if(row.paid||row.net<=0||row.requestId)continue;
  const truck=state.trucks.find(item=>item.id===row.truckId),missing=paymentDetailsMissing(truck?.paymentDetails);
  if(missing.length)throw Error('Complete os dados de pagamento da placa '+row.plate+': '+missing.join(', ')+'.');
  const id=uid(),snapshot=structuredClone(row);delete snapshot.requestId;delete snapshot.paidHistory;
  snapshot.paymentDetails=structuredClone(validatePaymentDetails(truck.paymentDetails,true));
  state.paymentRequests.push({id,batchId,closingId:closing.id,truckId:row.truckId,period:structuredClone(closing.period),snapshot,status:'pending',requestedAt:at,requestedBy:actor.userId,requestedEmail:actor.email||'',payment:null,paymentHistory:[]});row.requestId=id;selected.push(id);
 }
 if(!selected.length)throw Error('Não há placas fechadas e sem solicitação nesta seleção.');return selected;
}
export function locateRequest(state,id){
 const request=state.paymentRequests.find(item=>item.id===id);if(!request)throw Error('Solicitação de pagamento não encontrada.');
 const closing=state.closings.find(item=>item.id===request.closingId),row=closing?.rows.find(item=>item.truckId===request.truckId);return {request,closing,row};
}
export function cancelRequest(state,id,note,actor){
 const {request,row}=locateRequest(state,id);if(request.status!=='pending'||!row||row.paid)throw Error('Somente uma solicitação aguardando pagamento pode ser cancelada.');
 if(!String(note||'').trim())throw Error('Informe o motivo do cancelamento.');request.status='cancelled';request.cancelledAt=new Date().toISOString();request.cancelledBy=actor.userId;request.cancelReason=String(note).trim().slice(0,300);delete row.requestId;
}
export function recordRequestedPayment(state,payload,actor,receipt){
 const {request,row}=locateRequest(state,payload.requestId);
 if(request.status!=='pending'||!row||row.requestId!==request.id||row.paid)throw Error('Esta solicitação não está disponível para pagamento.');
 if(row.net!==request.snapshot.net)throw Error('O valor fechado difere da solicitação. Confira com o grupo.');
 if(paymentDetailsMissing(request.snapshot.paymentDetails).length)throw Error('Esta solicitação não tem dados de pagamento completos. Peça ao grupo que a cancele e envie novamente.');
 if(!validDate(payload.date)||payload.date>today())throw Error('Informe uma data de pagamento válida, até hoje.');
 if(!receipt||receipt.requestId!==request.id||!receipt.id||receipt.companyId!==actor.companyId||receipt.uploadedBy!==actor.userId)throw Error('Anexe um comprovante válido para esta solicitação antes de registrar o pagamento.');
 const paid={date:payload.date,note:String(payload.note||'').trim().slice(0,300),recordedAt:new Date().toISOString(),recordedBy:actor.userId,recordedEmail:actor.email||'',requestId:request.id,receipt:{id:receipt.id,name:receipt.name,mime:receipt.mime,size:receipt.size}};
 row.paid=structuredClone(paid);request.payment=structuredClone(paid);request.status='paid';
}
export function undoRequestedPayment(state,payload,actor){
 const reason=String(payload.note||'').trim();if(!reason)throw Error('Informe o motivo da correção do pagamento.');
 if(!payload.requestId){
  const closing=state.closings.find(c=>c.id===payload.closingId),row=closing?.rows.find(r=>r.truckId===payload.truckId);
  if(actor.role!=='admin'||partyOf(actor)!=='group'||!row?.paid||row.paid.receipt)fail('Somente a transportadora pode corrigir esse pagamento.');
  row.paidHistory=[...(row.paidHistory||[]),{payment:structuredClone(row.paid),reason,at:new Date().toISOString(),by:actor.userId}];row.paid=null;return;
 }
 if(partyOf(actor)!=='carrier')fail('Somente a transportadora pode corrigir esse pagamento.');
 const {request,row}=locateRequest(state,payload.requestId);if(request.status!=='paid'||!row?.paid)throw Error('Este pagamento não está registrado.');
 request.paymentHistory.push({payment:structuredClone(request.payment),reason,at:new Date().toISOString(),by:actor.userId});row.paidHistory=structuredClone(request.paymentHistory);row.paid=null;request.payment=null;request.status='pending';
}
export function protectPortalBackup(current,restored){
 for(const transfer of current.fundingTransfers||[]){const other=restored.fundingTransfers?.find(t=>t.id===transfer.id);if(JSON.stringify(transfer)!==JSON.stringify(other))throw Error('O backup não pode substituir o histórico de recibos e transferências.');}
 for(const transfer of restored.fundingTransfers||[])if(!current.fundingTransfers?.some(t=>t.id===transfer.id))throw Error('Transferências não podem ser criadas por importação.');
 for(const request of current.paymentRequests){const other=restored.paymentRequests.find(r=>r.id===request.id);if(JSON.stringify(request)!==JSON.stringify(other))throw Error('O backup não pode substituir o histórico de solicitações e pagamentos do portal.');}
 for(const request of restored.paymentRequests)if(!current.paymentRequests.some(r=>r.id===request.id))throw Error('Solicitações do portal não podem ser criadas por importação.');
 for(const closing of current.closings)for(const row of closing.rows)if(row.paid||row.requestId||row.paidHistory?.length){const other=restored.closings.find(c=>c.id===closing.id)?.rows.find(r=>r.truckId===row.truckId);if(JSON.stringify(row)!==JSON.stringify(other))throw Error('O backup deve preservar os pagamentos e solicitações já registrados.');}
 for(const closing of restored.closings)for(const row of closing.rows)if(row.paid&&!current.closings.find(c=>c.id===closing.id)?.rows.find(r=>r.truckId===row.truckId)?.paid)throw Error('Novos pagamentos exigem o acesso da transportadora e comprovante.');
}
export function presentState(current,actor){
 const user={id:actor.userId,email:actor.email||'',role:actor.role,party:partyOf(actor)};
 if(partyOf(actor)==='carrier')return {revision:current.revision,company:current.company,user,state:null,requests:structuredClone(current.state.paymentRequests||[]),fundingTransfers:structuredClone(current.state.fundingTransfers||[]).map(transfer=>transfer.status==='awaiting_receipt'&&!Object.keys(transfer.receiptProfile||{}).length?{...transfer,receiptProfile:structuredClone(current.state.settings?.receiptProfile||{})}:transfer)};
 return {...current,user};
}
