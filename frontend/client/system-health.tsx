'use client';
import {useEffect,useState} from 'react';
import {Activity,Database,HardDrive,Mail,Cloud,RefreshCw,ShieldAlert,CheckCircle2,Clock} from 'lucide-react';

type Report={date:string;backupTaskOk:boolean;backupRanAt:string|null;backupFile:string|null;backupSizeBytes:number|null;alertTaskOk:boolean;alertRanAt:string|null;issues:string[];receivedAt:string};
type Status={database:{connected:boolean;checkedAt:string};reportingConfigured:boolean;latest:Report|null;history:Report[];stale:boolean;schedule:{backup:string;alert:string;report:string};cloudSyncVerified:boolean};
const when=(s:string|null|undefined)=>s?new Date(s).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'}):'Not reported';
const size=(b:number|null)=>b===null?'Unknown':(b/1024).toFixed(1)+' KB';
export default function SystemHealth(){
  const [status,setStatus]=useState<Status|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  async function load(){setLoading(true);try{const r=await fetch('/api/system-health',{credentials:'same-origin',cache:'no-store'});if(!r.ok)throw new Error(r.status===403?'Owner access required.':'Unable to load system health (HTTP '+r.status+').');setStatus(await r.json());setError('')}catch(e){setError(e instanceof Error?e.message:'Unable to load status')}finally{setLoading(false)}}
  useEffect(()=>{load();const id=setInterval(()=>{if(!document.hidden)load()},60000);return()=>clearInterval(id)},[]);
  const latest=status?.latest;
  const ok=!!latest&&latest.backupTaskOk&&latest.alertTaskOk&&latest.issues.length===0&&!status?.stale;
  const card=(icon:React.ReactNode,title:string,value:string,subtitle:string)=> <section className="panel" style={{padding:22,minHeight:170}}><div style={{display:'flex',gap:10,alignItems:'center',opacity:.85}}>{icon}<strong>{title}</strong></div><h2 style={{margin:'16px 0 6px'}}>{value}</h2><p style={{margin:0,opacity:.75,fontSize:13}}>{subtitle}</p></section>;
  return <div style={{display:'grid',gap:18}}>
    <section className="panel" style={{padding:22,display:'flex',flexWrap:'wrap',alignItems:'center',justifyContent:'space-between',gap:16}}><div><div style={{display:'flex',gap:10,alignItems:'center'}}><Activity size={24}/><h2 style={{margin:0}}>System & Backup Health</h2></div><p style={{opacity:.75}}>Read-only owner dashboard · India Standard Time (IST)</p><strong>{loading&&!status?'Checking…':error?'⚠ Unable to verify':!latest?'⚪ Awaiting first server report':status?.stale?'🟠 Backup report is stale':ok?'🟢 Latest check successful':'🔴 Backup issue reported'}</strong></div><button type="button" onClick={load} disabled={loading}><RefreshCw size={16}/> {loading?'Checking…':'Refresh status'}</button></section>
    {error&&<div className="error" role="alert">{error}. Previous information, if shown, may be outdated.</div>}
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:15}}>
      {card(<Database size={19}/>,'MongoDB Atlas',status?.database.connected?'Connected':'Not verified',status?'Checked '+when(status.database.checkedAt):'Waiting for secure API response')}
      {card(<HardDrive size={19}/>,'Latest encrypted backup',latest?.backupTaskOk?'Completed':latest?'Problem reported':'No report yet',latest?.backupFile?latest.backupFile+' · '+size(latest.backupSizeBytes):'Windows server has not reported a backup')}
      {card(<Mail size={19}/>,'Gmail alert task',latest?.alertTaskOk?'Completed':latest?'Failed / missed':'No report yet',latest?'Checked: '+when(latest.alertRanAt):'SMTP delivery is not independently confirmed')}
      {card(<Cloud size={19}/>,'Google Drive','Cloud sync unverified',latest?.backupFile?'Desktop folder file reported · '+size(latest.backupSizeBytes):'Awaiting Windows backup report')}
      {card(<Clock size={19}/>,'Daily schedule','11:30 PM', 'Backup 11:30 · Gmail check 11:45 · status report 11:50 IST')}
      {card(<CheckCircle2 size={19}/>,'Recovery drill','Previously tested','158 documents restored in a separate test database on 19 Oct 2026; not a live recurring check')}
    </div>
    {status?.stale&&<section className="panel" style={{padding:18,border:'1px solid #d89d3a'}}><ShieldAlert size={17}/> No fresh status was reported within the last 26 hours. Confirm that the café PC is on, signed in and connected to the internet.</section>}
    {!!latest?.issues.length&&<section className="panel" style={{padding:18}}><h3>Latest warnings</h3>{latest.issues.map((v,i)=><p key={i}>⚠ {v}</p>)}</section>}
    <section className="panel" style={{padding:20}}><h2>Last 14 backup reports</h2><p style={{opacity:.75}}>A report is a Windows server observation, not proof of cloud upload or email inbox delivery.</p><div className="tablewrap"><table><thead><tr><th>Backup date</th><th>Backup task</th><th>Alert task</th><th>File size</th><th>Reported at</th></tr></thead><tbody>{(status?.history||[]).map(r=><tr key={r.date}><td>{r.date}</td><td>{r.backupTaskOk?'✅ Success':'❌ Issue'}</td><td>{r.alertTaskOk?'✅ Completed':'❌ Issue'}</td><td>{size(r.backupSizeBytes)}</td><td>{when(r.receivedAt)}</td></tr>)}</tbody></table>{!status?.history.length&&<p>No reports received yet. Set up the Windows status reporter below.</p>}</div></section>
  </div>;
}
