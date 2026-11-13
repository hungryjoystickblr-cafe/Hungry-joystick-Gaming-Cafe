import {useEffect,useMemo,useState} from 'react';
import {CalendarDays,Clock,Users,IndianRupee,Plus,Search,Download,Wallet,RefreshCw,Pencil,CheckCircle2} from 'lucide-react';
import type {GtaBooking} from './model';

type Status=GtaBooking['status'];
type Draft=GtaBooking|null|undefined;
const statuses:Status[]=['Pending','Confirmed','Completed','Cancelled','No-show'];
const sources:GtaBooking['source'][]=['Walk-in','WhatsApp','Phone'];
const money=(value:number)=>'₹'+Number(value||0).toLocaleString('en-IN',{maximumFractionDigits:2});
const todayIndia=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const dateLabel=(value:string)=>new Date(value+'T00:00:00+05:30').toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric'});
const timeLabel=(value:number)=>new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));
const paid=(booking:GtaBooking)=>(booking.payments??[]).reduce((sum,p)=>sum+Number(p.amount||0),0);
const durationLabel=(minutes:number)=>{const h=Math.floor(minutes/60),m=minutes%60;return h?(m?h+'h '+m+'m':h+'h'):m+'m';};
const escapeCsv=(value:unknown)=>'"'+String(value??'').replaceAll('"','""').replace(/^[=+@-]/,"'$&")+'"';

async function request(url:string,method='GET',body?:Record<string,unknown>){
 const response=await fetch(url,{method,cache:'no-store',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
 const result=await response.json().catch(()=>({error:'The server returned an invalid response.'}));
 if(!response.ok)throw Error(result.error||'Unable to complete the request.');
 return result;
}

export default function GtaBookings(){
 const [bookings,setBookings]=useState<GtaBooking[]>([]);
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [query,setQuery]=useState('');
 const [filter,setFilter]=useState('All');
 const [draft,setDraft]=useState<Draft>(undefined);
 const [paymentTarget,setPaymentTarget]=useState<GtaBooking|null>(null);
 const [refreshing,setRefreshing]=useState(false);
 async function refresh(showLoading=false){
  if(showLoading)setLoading(true);
  setRefreshing(true);
  try{const result=await request('/api/bookings');setBookings(result.bookings??[]);setError('');}
  catch(e){setError(e instanceof Error?e.message:'Unable to load bookings.');}
  finally{setLoading(false);setRefreshing(false);}
 }
 useEffect(()=>{void refresh(true);const timer=setInterval(()=>void refresh(),30000);return()=>clearInterval(timer);},[]);
 const now=Date.now(),today=todayIndia();
 const upcoming=bookings.filter(b=>b.start>=now&&['Pending','Confirmed'].includes(b.status));
 const todayBookings=bookings.filter(b=>b.date===today&&['Pending','Confirmed'].includes(b.status));
 const advanceTotal=bookings.reduce((sum,b)=>sum+paid(b),0);
 const cashAdvance=bookings.reduce((sum,b)=>sum+b.payments.filter(p=>p.method==='Cash').reduce((n,p)=>n+Number(p.amount||0),0),0);
 const upiAdvance=bookings.reduce((sum,b)=>sum+b.payments.filter(p=>p.method==='UPI').reduce((n,p)=>n+Number(p.amount||0),0),0);
 const outstanding=bookings.filter(b=>!['Cancelled','No-show'].includes(b.status)).reduce((sum,b)=>sum+Math.max(0,b.totalAmount-paid(b)),0);
 const resources=useMemo(()=>[...new Set(['GTA 6 Setup 1',...bookings.map(b=>b.resource)])].sort((a,b)=>a.localeCompare(b)),[bookings]);
 const visible=useMemo(()=>{
  const q=query.trim().toLowerCase();
  return [...bookings].filter(b=>(filter==='All'||b.status===filter)&&(!q||[b.bookingCode,b.name,b.phone,b.resource,b.source].some(v=>String(v).toLowerCase().includes(q)))).sort((a,b)=>a.start-b.start);
 },[bookings,filter,query]);
 async function saveBooking(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();if(busy)return;setBusy(true);setError('');
  const data=new FormData(e.currentTarget),editing=Boolean(draft);
  const body:Record<string,unknown>={
   name:String(data.get('name')??'').trim(),
   phone:String(data.get('phone')??'').replace(/\\D/g,''),
   source:String(data.get('source')??'Walk-in'),
   resource:String(data.get('resource')??'').trim(),
   date:String(data.get('date')??''),
   startTime:String(data.get('startTime')??''),
   durationMinutes:Number(data.get('durationMinutes')),
   players:Number(data.get('players')),
   totalAmount:Number(data.get('totalAmount')),
   notes:String(data.get('notes')??'').trim(),
   status:String(data.get('status')??'Confirmed')
  };
  if(!editing){body.advanceAmount=Number(data.get('advanceAmount')||0);body.paymentMethod=String(data.get('paymentMethod')||'UPI');}
  try{
   await request(editing?'/api/bookings/'+draft!.id:'/api/bookings',editing?'PATCH':'POST',body);
   setDraft(undefined);await refresh();
  }catch(e){setError(e instanceof Error?e.message:'Unable to save booking.');}
  finally{setBusy(false);}
 }
 async function changeStatus(booking:GtaBooking,status:Status){
  setBusy(true);setError('');
  try{await request('/api/bookings/'+booking.id,'PATCH',{status});await refresh();}
  catch(e){setError(e instanceof Error?e.message:'Unable to update booking.');}
  finally{setBusy(false);}
 }
 async function addPayment(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();if(!paymentTarget||busy)return;setBusy(true);setError('');
  const data=new FormData(e.currentTarget);
  try{
   await request('/api/bookings/'+paymentTarget.id+'/payments','POST',{amount:Number(data.get('amount')),method:String(data.get('method')||'UPI')});
   setPaymentTarget(null);await refresh();
  }catch(e){setError(e instanceof Error?e.message:'Unable to record payment.');}
  finally{setBusy(false);}
 }
 function exportCsv(){
  const rows=[['Booking ID','Customer','Phone','Source','Setup','Date','Start','End','Duration','Players','Total INR','Paid INR','Balance INR','Payment history','Status','Notes'],
   ...visible.map(b=>[b.bookingCode,b.name,b.phone,b.source,b.resource,b.date,b.startTime,timeLabel(b.end),durationLabel(b.durationMinutes),b.players,b.totalAmount,paid(b),Math.max(0,b.totalAmount-paid(b)),b.payments.map(p=>p.method+' '+p.amount).join('; '),b.status,b.notes])];
  const csv=rows.map(row=>row.map(escapeCsv).join(',')).join('\\r\\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));a.download='hungry-joystick-gta6-bookings.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
 }
 return <section className="hj-bookings">
  <div className="stats" style={{marginBottom:20}}>
   <div className="stat"><div><span>Today's bookings</span><CalendarDays size={18}/></div><strong>{todayBookings.length}</strong><small>Pending and confirmed</small></div>
   <div className="stat"><div><span>Upcoming bookings</span><Clock size={18}/></div><strong>{upcoming.length}</strong><small>Future reservations</small></div>
   <div className="stat"><div><span>Advance collected</span><Wallet size={18}/></div><strong>{money(advanceTotal)}</strong><small>Cash {money(cashAdvance)} · UPI {money(upiAdvance)}</small></div>
   <div className="stat"><div><span>Outstanding balance</span><IndianRupee size={18}/></div><strong>{money(outstanding)}</strong><small>Excludes cancelled and no-show</small></div>
  </div>
  <div className="panel" style={{padding:20}}>
   <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:14,flexWrap:'wrap'}}>
    <div><h2><CalendarDays size={20} style={{verticalAlign:'middle',marginRight:8}}/>GTA 6 reservations</h2><span className="subtle">Staff-entered bookings · Walk-in, WhatsApp and phone</span></div>
    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
     <button type="button" onClick={()=>void refresh()} disabled={refreshing}><RefreshCw size={15}/> Refresh</button>
     <button type="button" onClick={exportCsv} disabled={!visible.length}><Download size={15}/> Export CSV</button>
     <button type="button" className="primary" onClick={()=>{setError('');setDraft(null)}}><Plus size={16}/> New booking</button>
    </div>
   </div>
   <p className="formnote">Flexible duration is supported. Choose the setup, date, start time and duration; the end time is calculated automatically. Payments are recorded manually—there is no online payment verification.</p>
   <div style={{display:'flex',gap:12,alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',margin:'12px 0 18px'}}>
    <div className="search wide" style={{flex:'1 1 260px',maxWidth:420}}><Search size={16}/><input aria-label="Search bookings" placeholder="Search booking ID, customer, phone or setup…" value={query} onChange={e=>setQuery(e.target.value)}/></div>
    <select aria-label="Filter booking status" value={filter} onChange={e=>setFilter(e.target.value)} style={{width:'auto',minWidth:155}}>{['All',...statuses].map(s=><option key={s}>{s}</option>)}</select>
   </div>
   {error&&<div className="error" role="alert">{error}</div>}
   {loading?<div className="empty">Loading GTA 6 bookings…</div>:<div className="tablewrap"><table><thead><tr><th>Booking / Customer</th><th>Setup</th><th>Reserved slot</th><th>Players</th><th>Amount</th><th>Status</th><th>Actions</th></tr></thead><tbody>
    {visible.map(b=>{const amountPaid=paid(b),balance=Math.max(0,b.totalAmount-amountPaid);return <tr key={b.id}>
     <td><b>{b.bookingCode}</b><small>{b.name} · {b.phone}</small><small>{b.source}</small></td>
     <td><b>{b.resource}</b></td>
     <td><b>{dateLabel(b.date)}</b><small>{timeLabel(b.start)} – {timeLabel(b.end)} · {durationLabel(b.durationMinutes)}</small></td>
     <td>{b.players}</td>
     <td><b>{money(b.totalAmount)}</b><small>Paid {money(amountPaid)} · Due {money(balance)}</small><small>{b.payments.map(p=>p.method+' '+money(p.amount)).join(' · ')||'No advance recorded'}</small></td>
     <td><select aria-label={'Status for '+b.bookingCode} value={b.status} disabled={busy} onChange={e=>void changeStatus(b,e.target.value as Status)} style={{width:125,padding:'7px 8px',fontSize:10}}>{statuses.map(s=><option key={s}>{s}</option>)}</select></td>
     <td><div style={{display:'flex',gap:6,flexWrap:'wrap'}}><button type="button" onClick={()=>{setError('');setDraft(b)}}><Pencil size={13}/> Edit</button><button type="button" disabled={busy||balance<=0||['Cancelled','No-show'].includes(b.status)} onClick={()=>{setError('');setPaymentTarget(b)}}><IndianRupee size={13}/> Add payment</button></div></td>
    </tr>;})}
   </tbody></table>{visible.length===0&&<div className="empty">{bookings.length?'No bookings match this search or filter.':'No GTA 6 bookings yet. Add the first walk-in, WhatsApp or phone reservation.'}</div>}</div>}
  </div>
  {draft!==undefined&&<div className="modalback" onClick={()=>setDraft(undefined)}><section className="modal" role="dialog" aria-modal="true" aria-label={draft?'Edit GTA 6 booking':'New GTA 6 booking'} onClick={e=>e.stopPropagation()} style={{width:560}}>
   <button className="close" type="button" aria-label="Close booking form" onClick={()=>setDraft(undefined)}>×</button>
   <span className="eyebrow">HUNGRY JOYSTICK / GTA 6</span><h2>{draft?'Edit booking':'Create booking'}</h2>{error&&<div className="error" role="alert">{error}</div>}
   <form onSubmit={saveBooking}>
    <div className="formrow"><label>Customer name<input name="name" required maxLength={100} defaultValue={draft?.name??''} placeholder="Customer name"/></label><label>Mobile number<input name="phone" required type="tel" minLength={10} maxLength={15} defaultValue={draft?.phone??''} placeholder="10-digit mobile"/></label></div>
    <div className="formrow"><label>Booking source<select name="source" defaultValue={draft?.source??'Walk-in'}>{sources.map(s=><option key={s}>{s}</option>)}</select></label><label>Gaming setup<input name="resource" list="gta6-resources" required maxLength={80} defaultValue={draft?.resource??resources[0]} placeholder="GTA 6 Setup 1"/><datalist id="gta6-resources">{resources.map(r=><option key={r} value={r}/>)}</datalist><small>Use the same setup name consistently to prevent overlapping bookings.</small></label></div>
    <div className="formrow"><label>Gaming date<input name="date" type="date" required defaultValue={draft?.date??today}/></label><label>Start time (IST)<input name="startTime" type="time" required defaultValue={draft?.startTime??'11:00'}/></label></div>
    <div className="formrow"><label>Duration (minutes)<input name="durationMinutes" type="number" required min={1} max={1440} step={1} defaultValue={draft?.durationMinutes??60}/><small>Enter any duration from 1 minute to 24 hours.</small></label><label>Number of players<input name="players" type="number" required min={1} max={8} step={1} defaultValue={draft?.players??1}/></label></div>
    <div className="formrow"><label>Total booking amount (₹)<input name="totalAmount" type="number" required min={0.01} max={10000000} step="0.01" defaultValue={draft?.totalAmount??''}/></label><label>Booking status<select name="status" defaultValue={draft?.status??'Confirmed'}>{statuses.map(s=><option key={s}>{s}</option>)}</select></label></div>
    {!draft&&<><div className="formrow"><label>Advance received (₹)<input name="advanceAmount" type="number" min={0} max={10000000} step="0.01" defaultValue={0}/></label><label>Advance payment mode<select name="paymentMethod" defaultValue="UPI"><option>UPI</option><option>Cash</option></select></label></div><p className="formnote">Leave advance as ₹0 if no payment has been received. Add further payments later using “Add payment”.</p></>}
    {draft&&<p className="formnote">Payments already recorded: {money(paid(draft))}. The total booking amount cannot be reduced below the amount already received.</p>}
    <label>Notes (optional)<textarea name="notes" rows={3} maxLength={1000} defaultValue={draft?.notes??''} placeholder="Special requests or booking details"/></label>
    <div className="modalfooter"><button type="button" onClick={()=>setDraft(undefined)}>Cancel</button><button type="submit" className="primary" disabled={busy}>{busy?'Saving…':draft?'Save changes':'Create booking'}</button></div>
   </form>
  </section></div>}
  {paymentTarget&&<div className="modalback" onClick={()=>setPaymentTarget(null)}><section className="modal" role="dialog" aria-modal="true" aria-label="Record booking payment" onClick={e=>e.stopPropagation()}>
   <button className="close" type="button" aria-label="Close payment form" onClick={()=>setPaymentTarget(null)}>×</button><span className="eyebrow">PAYMENT ENTRY</span><h2>Record payment</h2>{error&&<div className="error" role="alert">{error}</div>}<p>{paymentTarget.bookingCode} · {paymentTarget.name}</p><div className="paymentrow"><span>Total booking amount</span><b>{money(paymentTarget.totalAmount)}</b></div><div className="paymentrow"><span>Already received</span><b>{money(paid(paymentTarget))}</b></div><div className="paymentrow"><span>Remaining balance</span><b>{money(Math.max(0,paymentTarget.totalAmount-paid(paymentTarget)))}</b></div>
   <form onSubmit={addPayment}><label>Amount received (₹)<input name="amount" type="number" required min="0.01" max={Math.max(0,paymentTarget.totalAmount-paid(paymentTarget))} step="0.01" autoFocus/></label><label>Payment mode<select name="method"><option>UPI</option><option>Cash</option></select></label><div className="modalfooter"><button type="button" onClick={()=>setPaymentTarget(null)}>Cancel</button><button type="submit" className="primary" disabled={busy}>{busy?'Saving…':'Record payment'}</button></div></form>
  </section></div>}
 </section>;
}
