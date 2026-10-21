import {playedMilliseconds} from './memberships';
import type {Session} from './model';
export const invoiceSessions=(invoice:Session):Session[]=>invoice.kind==='membershipSale'?[]:invoice.sessions??[invoice];
export const sessionMinutes=(invoice:Session)=>invoiceSessions(invoice).reduce((sum,s)=>sum+Math.ceil(playedMilliseconds(s,s.end??s.start)/60000),0);
export const playMilliseconds=(invoice:Session)=>invoiceSessions(invoice).reduce((sum,s)=>sum+playedMilliseconds(s,s.end??s.start),0);
