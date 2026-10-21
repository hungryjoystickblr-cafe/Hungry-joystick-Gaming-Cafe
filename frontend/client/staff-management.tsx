import {useEffect,useMemo,useState} from 'react';

type Staff={id:string;name:string;username:string;enabled:boolean;createdAt:string};
type Activity={at:string;actor:string;action:string;recordId?:string};

async function api(path:string,options?:RequestInit){
  const response=await fetch(path,{...options,headers:{'Content-Type':'application/json',...(options?.headers||{})},cache:'no-store'});
  const data=await response.json().catch(()=>({error:'The server returned an invalid response.'}));
  if(!response.ok)throw Error(data.error||'Request failed');
  return data;
}

const actionNames:Record<string,string>={
  login:'🟢 Logged in',logout:'🔴 Logged out',staffCreated:'Staff account created',
  staffUpdated:'Staff account updated',staffPasswordReset:'Staff password reset',
  start:'🎮 Session started',stop:'Session ended (awaiting billing)',
  pause:'⏸ Session paused',resume:'▶ Session resumed',extend:'⏱ Session extended',
  end:'🧾 Invoice generated',combine:'🧾 Sessions billed together',
  editInvoice:'📝 Invoice edited',food:'🍔 Food added',foods:'🍔 Food added',
  membership:'Membership created',membershipPaid:'Membership payment recorded',
  customer:'Customer saved',expense:'Expense added',deleteExpense:'Expense deleted',
  station:'Station saved',deleteStation:'Station deleted',menu:'Menu item saved',
  shop:'Shop details updated',taxConfig:'Tax settings updated'
};
const displayActor=(actor:string)=>actor==='owner'?'Owner':actor.startsWith('staff:')?actor.slice(6):actor||'Unknown';
const displayAction=(action:string)=>actionNames[action]??action.replace(/([a-z])([A-Z])/g,'$1 $2');
const displayTime=(at:string)=>new Date(at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'});

export default function StaffManagement(){
  const [rows,setRows]=useState<Staff[]>([]),[activity,setActivity]=useState<Activity[]>([]);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [name,setName]=useState(''),[username,setUsername]=useState(''),[password,setPassword]=useState('');
  const [actorFilter,setActorFilter]=useState('All'),[search,setSearch]=useState(''),[loading,setLoading]=useState(false);
  async function reload(){setLoading(true);try{const [a,b]=await Promise.all([api('/api/staff'),api('/api/staff/activity')]);setRows(a.staff);setActivity(b.activity);setError('');}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setLoading(false)}}
  useEffect(()=>{void reload()},[]);
  async function create(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');try{await api('/api/staff',{method:'POST',body:JSON.stringify({name,username,password,enabled:true})});setName('');setUsername('');setPassword('');await reload()}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
  async function toggle(row:Staff){if(!window.confirm((row.enabled?'Disable ':'Enable ')+row.name+'?'))return;setBusy(true);setError('');try{await api('/api/staff/'+encodeURIComponent(row.id),{method:'PATCH',body:JSON.stringify({enabled:!row.enabled})});await reload()}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
  async function reset(row:Staff){const newPassword=window.prompt('New password for '+row.username+' (12 characters minimum):');if(newPassword===null)return;setBusy(true);setError('');try{await api('/api/staff/'+encodeURIComponent(row.id),{method:'PATCH',body:JSON.stringify({password:newPassword})});await reload();window.alert('Password changed; existing sessions revoked.')}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
  const actors=useMemo(()=>['All',...new Set(activity.map(a=>a.actor))],[activity]);
  const filtered=useMemo(()=>activity.filter(a=>{
    const q=search.trim().toLowerCase();
    return (actorFilter==='All'||a.actor===actorFilter)&&(!q||(displayActor(a.actor)+' '+displayAction(a.action)+' '+(a.recordId??'')).toLowerCase().includes(q));
  }),[activity,actorFilter,search]);
  return <div>
    <section className="panel" style={{padding:20}}>
      <h2>Staff accounts</h2><p className="subtle">Only the owner can create, disable or reset employee accounts.</p>
      {error&&<p className="error" role="alert">{error}</p>}
      <form onSubmit={create}>
        <div className="formrow"><label>Employee name<input value={name} onChange={e=>setName(e.target.value)} required maxLength={100}/></label><label>Username<input value={username} onChange={e=>setUsername(e.target.value.toLowerCase())} required minLength={3} maxLength={32} pattern="[a-z][a-z0-9_.-]{2,31}" title="Use lowercase letters, numbers, dots, underscores or hyphens. No @ sign."/></label></div>
        <label>Password (minimum 12 characters)<input type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={12} maxLength={200}/></label>
        <button className="primary" disabled={busy}>{busy?'Saving…':'Create staff account'}</button>
      </form>
      <div className="tablewrap" style={{marginTop:18}}><table><thead><tr><th>Name</th><th>Username</th><th>Status</th><th>Actions</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td>{row.name}</td><td>{row.username}</td><td>{row.enabled?'Active':'Disabled'}</td><td><button disabled={busy} onClick={()=>toggle(row)}>{row.enabled?'Disable':'Enable'}</button> <button disabled={busy} onClick={()=>reset(row)}>Reset password</button></td></tr>)}</tbody></table>{!rows.length&&<p className="subtle">No staff accounts yet.</p>}</div>
    </section>
    <section className="panel" style={{padding:20,marginTop:20}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}><div><h2>Recent activity</h2><p className="subtle">Latest 200 logged events. Successful logins and logouts appear after this update.</p></div><button type="button" onClick={()=>void reload()} disabled={loading||busy}>{loading?'Refreshing…':'↻ Refresh activity'}</button></div>
      <div className="formrow" style={{margin:'12px 0'}}><label>Employee<select value={actorFilter} onChange={e=>setActorFilter(e.target.value)}>{actors.map(actor=><option key={actor} value={actor}>{actor==='All'?'All employees':displayActor(actor)}</option>)}</select></label><label>Search activity<input type="search" placeholder="Login, invoice, session…" value={search} onChange={e=>setSearch(e.target.value)}/></label></div>
      <div className="tablewrap"><table><thead><tr><th>Time (India)</th><th>Employee</th><th>Activity</th><th>Record ID</th></tr></thead><tbody>{filtered.map((a,i)=><tr key={a.at+'-'+a.actor+'-'+i}><td>{displayTime(a.at)}</td><td>{displayActor(a.actor)}</td><td>{displayAction(a.action)}</td><td title={a.recordId??''}>{a.recordId?String(a.recordId).slice(0,16):'—'}</td></tr>)}</tbody></table>{!filtered.length&&<div className="empty">No matching activity found.</div>}</div>
    </section>
  </div>;
}
