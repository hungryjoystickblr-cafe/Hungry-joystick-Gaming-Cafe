import {applyTax,type State,type Session} from './model';
import {coveredMinutes} from './memberships';
import {invoiceSessions} from './billing';
export type InvoiceEdit={adjustment?:number;adjustmentReason?:string;id:string;name:string;phone:string;reason:string;payment:string;cashAmount?:number;upiAmount?:number;sessions:{id:string;start:number;end:number;gaming:number;items:Session['items']}[]};
export function reviseInvoice(state:State,op:InvoiceEdit,now:number,actor:string){
const invoice=state.invoices.find(x=>x.id===op.id);if(!invoice)throw Error('Invoice not found.');
const before=structuredClone(invoice);delete before.history;
const sessions=invoiceSessions(invoice);if(op.sessions.length!==sessions.length||new Set(op.sessions.map(x=>x.id)).size!==sessions.length)throw Error('Session list has changed. Reopen the invoice.');
for(const change of op.sessions){const session=sessions.find(x=>x.id===change.id);if(!session)throw Error('Session not found.');if(change.end<change.start||change.end>now)throw Error('Session end must follow start and cannot be in the future.');const originalEnd=session.end!;const timeChanged=change.start!==session.start||change.end!==session.end;const oldUsed=session.membershipMinutesUsed??0;
// Retain recorded breaks, clipped to the corrected session boundaries.
session.pauses=session.pauses?.map(p=>({start:Math.max(change.start,p.start),end:Math.min(change.end,p.end??originalEnd)})).filter(p=>p.end>p.start);delete session.pausedAt;
session.start=change.start;session.end=change.end;
if(session.membershipId&&timeChanged){const m=state.memberships?.find(x=>x.id===session.membershipId);if(!m)throw Error('Membership record not found.');const used=coveredMinutes(session,change.end),delta=used-oldUsed;if(delta&&state.active.some(x=>x.membershipId===m.id))throw Error('End the active membership session before correcting its previous playing time.');if(m.remainingMinutes-delta<0||m.remainingMinutes-delta>m.totalMinutes)throw Error('This correction exceeds the available membership balance.');m.remainingMinutes-=delta;session.membershipMinutesUsed=used;session.memberBalanceAfter=Math.max(0,(session.memberBalanceAfter??m.remainingMinutes+delta)-delta);}
session.gaming=Math.round(change.gaming*100)/100;session.items=change.items.map(f=>({...f,price:Math.round(f.price*100)/100}));applyTax(session,session.tax?{enabled:true,...session.tax}:undefined);
}
if(invoice.sessions){invoice.start=Math.min(...sessions.map(x=>x.start));invoice.gaming=sessions.reduce((n,x)=>n+Math.round((x.gaming??0)*100),0)/100;invoice.items=sessions.flatMap(x=>x.items);invoice.total=sessions.reduce((n,x)=>n+Math.round((x.total??0)*100),0)/100;if(invoice.tax)invoice.tax.amount=sessions.reduce((n,x)=>n+Math.round((x.tax?.amount??0)*100),0)/100;}
if(invoice.kind!=='membershipSale'){invoice.adjustment=Math.round((op.adjustment??invoice.adjustment??0)*100)/100;invoice.adjustmentReason=op.adjustmentReason??invoice.adjustmentReason;invoice.total=Math.round(((invoice.total??0)+invoice.adjustment)*100)/100;if(invoice.total<0)throw Error('Discount cannot exceed the bill subtotal.');}
invoice.name=op.name;invoice.phone=op.phone;invoice.payment=op.payment;delete invoice.cashAmount;delete invoice.upiAmount;
if(op.payment==='Split'){const cash=Math.round((op.cashAmount??0)*100),upi=Math.round((op.upiAmount??0)*100);if(cash<=0||upi<=0||cash+upi!==Math.round((invoice.total??0)*100))throw Error('Cash and UPI must add up exactly to the revised total.');invoice.cashAmount=cash/100;invoice.upiAmount=upi/100;}
if(invoice.kind==='membershipSale'){const m=state.memberships?.find(x=>x.id===invoice.saleMembershipId);if(m){if(op.payment==='Unpaid'&&state.active.some(x=>x.membershipId===m.id))throw Error('Cannot mark a membership unpaid while it is in use.');m.payment=op.payment;m.cashAmount=invoice.cashAmount;m.upiAmount=invoice.upiAmount;}}
invoice.history??=[];invoice.history.push({at:now,actor,reason:op.reason,before,afterTotal:invoice.total??0});return invoice;
}
