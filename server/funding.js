import {period,periodClosings,round,uid,today,validDate} from './engine.js';
import {partyOf} from './payment-portal.js';

const requireGroup=actor=>{if(partyOf(actor)!=='group')throw Error('Esta ação exige acesso do grupo das fazendas.');};
const requireCarrier=actor=>{if(partyOf(actor)!=='carrier')throw Error('O recibo deve ser enviado pela transportadora.');};
export function locateFunding(state,id){
 const transfer=state.fundingTransfers.find(item=>item.id===id);
 if(!transfer)throw Error('Transferência à transportadora não encontrada.');
 return transfer;
}
export function createFunding(state,payload,actor){
 requireGroup(actor);
 const p=period(payload.month,payload.half),farm=state.farms.find(item=>item.id===payload.farmId);
 if(!farm)throw Error('Selecione uma fazenda válida.');
 if(!periodClosings(state,p).some(closing=>closing.rows.some(row=>row.farmId===farm.id)))throw Error('Feche a quinzena desta fazenda antes de solicitar o recibo.');
 const amount=Number(payload.amount),description=String(payload.description||'').trim();
 if(!Number.isFinite(amount)||amount<=0||round(amount)!==amount)throw Error('Informe um valor válido para esta transferência.');
 if(!description||description.length>200)throw Error('Descreva o serviço em até 200 caracteres.');
 state.fundingTransfers.push({id:uid(),period:p,farmId:farm.id,farmName:farm.name,amount,description,status:'awaiting_receipt',requestedAt:new Date().toISOString(),requestedBy:actor.userId,requestedEmail:actor.email||'',receipt:null,transfer:null});
}
export function attachFundingReceipt(state,payload,actor,document){
 requireCarrier(actor);
 const funding=locateFunding(state,payload.id);
 if(funding.status!=='awaiting_receipt')throw Error('Esta transferência não está aguardando recibo.');
 if(!document||document.transferId!==funding.id||document.companyId!==actor.companyId||document.uploadedBy!==actor.userId)throw Error('Anexe um recibo assinado válido para esta transferência.');
 funding.receipt={id:document.id,name:document.name,mime:document.mime,size:document.size,uploadedAt:new Date().toISOString(),uploadedBy:actor.userId,uploadedEmail:actor.email||''};
 funding.status='receipt_submitted';
}
export function recordFunding(state,payload,actor){
 requireGroup(actor);
 const funding=locateFunding(state,payload.id);
 if(funding.status!=='receipt_submitted'||!funding.receipt?.id)throw Error('Confira o recibo assinado antes de registrar a transferência.');
 if(!validDate(payload.date)||payload.date>today())throw Error('Informe a data em que a transferência foi efetuada, até hoje.');
 const reference=String(payload.reference||'').trim();if(reference.length>120)throw Error('Use até 120 caracteres na referência da transferência.');
 funding.transfer={date:payload.date,reference,recordedAt:new Date().toISOString(),recordedBy:actor.userId,recordedEmail:actor.email||''};
 funding.status='transferred';
}
export function cancelFunding(state,payload,actor){
 requireGroup(actor);
 const funding=locateFunding(state,payload.id),reason=String(payload.reason||'').trim();
 if(!['awaiting_receipt','receipt_submitted'].includes(funding.status))throw Error('Uma transferência efetuada não pode ser cancelada.');
 if(!reason||reason.length>300)throw Error('Informe o motivo do cancelamento em até 300 caracteres.');
 funding.status='cancelled';funding.cancelledAt=new Date().toISOString();funding.cancelledBy=actor.userId;funding.cancelReason=reason;
}
