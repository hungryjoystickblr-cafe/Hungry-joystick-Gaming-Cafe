import {randomUUID} from 'node:crypto';
import type {Express} from 'express';
import type {Document} from 'mongodb';
import {z} from 'zod';
import {owner} from './auth.js';
import {database,initialize} from './store.js';

const calendar=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(d=>Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d);
const time=z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const source=z.enum(['Walk-in','WhatsApp','Phone']);
const status=z.enum(['Pending','Confirmed','Completed','Cancelled','No-show']);
const createSchema=z.object({
  name:z.string().trim().min(1).max(100),
  phone:z.string().transform(v=>v.replace(/\D/g,'')).pipe(z.string().regex(/^\d{10,15}$/)),
  source,
  resource:z.string().trim().min(2).max(80),
  date:calendar,
  startTime:time,
  durationMinutes:z.number().int().min(1).max(1440),
  players:z.number().int().min(1).max(8),
  totalAmount:z.number().positive().max(10000000),
  advanceAmount:z.number().min(0).max(10000000).default(0),
  paymentMethod:z.enum(['Cash','UPI']).optional(),
  notes:z.string().trim().max(1000).default(''),
  status:status.default('Confirmed')
}).strict();
const updateSchema=z.object({
  name:z.string().trim().min(1).max(100).optional(),
  phone:z.string().transform(v=>v.replace(/\D/g,'')).pipe(z.string().regex(/^\d{10,15}$/)).optional(),
  source:source.optional(),
  resource:z.string().trim().min(2).max(80).optional(),
  date:calendar.optional(),
  startTime:time.optional(),
  durationMinutes:z.number().int().min(1).max(1440).optional(),
  players:z.number().int().min(1).max(8).optional(),
  totalAmount:z.number().positive().max(10000000).optional(),
  notes:z.string().trim().max(1000).optional(),
  status:status.optional()
}).strict().refine(v=>Object.keys(v).length>0);
const paymentSchema=z.object({amount:z.number().positive().max(10000000),method:z.enum(['Cash','UPI'])}).strict();

type BookingLock=Document&{_id:string;revision:number};
type BookingRecord=Document&{
  id:string;
  payments?:{id:string;amount:number;method:'Cash'|'UPI';receivedAt:number;actor:string}[];
  totalAmount:number;
  status:z.infer<typeof status>;
};
const resourceKey=(value:string)=>value.trim().toLocaleLowerCase().replace(/\s+/g,' ');
const startAt=(date:string,startTime:string)=>{const value=Date.parse(date+'T'+startTime+':00+05:30');if(!Number.isFinite(value))throw Error('Enter a valid booking date and start time.');return value;};
const paid=(booking:any)=>Math.round((booking.payments??[]).reduce((sum:number,p:any)=>sum+Math.round(Number(p.amount)*100),0))/100;
const actorFor=(user:any)=>user.role==='staff'?'staff:'+user.username:user.email;
async function ready(){
  await initialize();
  const {db,client}=await database();
  await db.collection('bookings').createIndex({id:1},{unique:true});
  await db.collection('bookings').createIndex({resourceKey:1,start:1,end:1,status:1});
  await db.collection<BookingLock>('bookingLocks').updateOne({_id:'gta6'},{$setOnInsert:{revision:0}},{upsert:true});
  return {db,client};
}
async function transaction<T>(db:any,client:any,work:(session:any,settings:any)=>Promise<T>){
  const session=client.startSession();
  try{
    const result=await session.withTransaction(async()=>{
      await db.collection('bookingLocks').updateOne({_id:'gta6'},{$inc:{revision:1}},{session});
      const settings=await db.collection('settings').findOne({_id:'cafe'},{session});
      if(!settings?.migratedAt)throw Object.assign(Error('Import your complete café backup from Owner profile before starting operations.'),{status:503});
      const value=await work(session,settings);
      const saved=await db.collection('settings').updateOne({_id:'cafe',revision:settings.revision},{$inc:{revision:1}},{session});
      if(saved.modifiedCount!==1)throw Object.assign(Error('Another device saved a change. Refresh and retry.'),{status:409});
      return value;
    },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});
    return result as T;
  }finally{await session.endSession();}
}
async function findConflict(db:any,session:any,key:string,start:number,end:number,excludeId?:string){
  const filter:any={resourceKey:key,status:{$in:['Pending','Confirmed']},start:{$lt:end},end:{$gt:start}};
  if(excludeId)filter.id={$ne:excludeId};
  return db.collection('bookings').findOne(filter,{session,projection:{bookingCode:1,name:1,start:1,end:1}});
}
function conflictError(conflict:any){
  const when=new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(conflict.start));
  return Object.assign(Error('This setup already has a booking for '+when+' ('+conflict.bookingCode+'). Choose another time or setup.'),{status:409});
}
function customerUpsert(db:any,session:any,booking:any){
  return db.collection('customers').updateOne({phone:booking.phone},{$setOnInsert:{id:randomUUID(),name:booking.name,phone:booking.phone,notes:'',createdAt:Date.now(),updatedAt:Date.now()}},{upsert:true,session});
}

export function registerBookings(app:Express){
  app.use('/api/bookings',async(req,res,next)=>{
    const user=await owner(req);
    if(!user){res.status(401).json({error:'Please sign in.'});return;}
    res.locals.bookingUser=user;
    next();
  });
  app.get('/api/bookings',async(_req,res)=>{
    const {db}=await ready();
    const bookings=await db.collection('bookings').find({}).sort({start:-1}).toArray();
    res.json({bookings:bookings.map(({_id,...row}:any)=>row)});
  });
  app.post('/api/bookings',async(req,res)=>{
    const values=createSchema.parse(req.body);
    if(values.advanceAmount>values.totalAmount)throw Error('Advance cannot be greater than the total booking amount.');
    if(values.advanceAmount>0&&!values.paymentMethod)throw Error('Select how the advance was received.');
    const start=startAt(values.date,values.startTime),end=start+values.durationMinutes*60000,key=resourceKey(values.resource),now=Date.now(),user=res.locals.bookingUser,actor=actorFor(user);
    const payments=values.advanceAmount>0?[{id:randomUUID(),amount:Math.round(values.advanceAmount*100)/100,method:values.paymentMethod!,receivedAt:now,actor}]:[];
    const booking={id:randomUUID(),bookingCode:'HJ-GTA6-'+values.date.replaceAll('-','')+'-'+randomUUID().slice(0,6).toUpperCase(),name:values.name,phone:values.phone,source:values.source,resource:values.resource,resourceKey:key,date:values.date,startTime:values.startTime,start,end,durationMinutes:values.durationMinutes,players:values.players,totalAmount:Math.round(values.totalAmount*100)/100,payments,notes:values.notes,status:values.status,createdAt:now,updatedAt:now,createdBy:actor,updatedBy:actor};
    const {db,client}=await ready();
    await transaction(db,client,async(session)=>{
      if(['Pending','Confirmed'].includes(booking.status)){
        const conflict=await findConflict(db,session,key,start,end);
        if(conflict)throw conflictError(conflict);
      }
      await db.collection('bookings').insertOne(booking,{session});
      await customerUpsert(db,session,booking);
      await db.collection('activityLog').insertOne({at:new Date(),actor,action:'gta6BookingCreated',recordId:booking.id},{session});
      return true;
    });
    res.status(201).json({booking});
  });
  app.patch('/api/bookings/:id',async(req,res)=>{
    const values=updateSchema.parse(req.body),{db,client}=await ready(),user=res.locals.bookingUser,actor=actorFor(user),now=Date.now();
    const booking=await transaction(db,client,async(session)=>{
      const existing=await db.collection('bookings').findOne({id:req.params.id},{session});
      if(!existing)throw Object.assign(Error('Booking not found.'),{status:404});
      const next:any={...existing,...values};
      next.phone=String(next.phone).replace(/\D/g,'');
      next.resourceKey=resourceKey(next.resource);
      next.start=startAt(next.date,next.startTime);
      next.end=next.start+next.durationMinutes*60000;
      next.totalAmount=Math.round(next.totalAmount*100)/100;
      next.updatedAt=now;
      next.updatedBy=actor;
      if(next.totalAmount<paid(next))throw Error('Total amount cannot be lower than payments already received.');
      if(['Pending','Confirmed'].includes(next.status)){
        const conflict=await findConflict(db,session,next.resourceKey,next.start,next.end,next.id);
        if(conflict)throw conflictError(conflict);
      }
      await db.collection('bookings').replaceOne({id:next.id},next,{session});
      await customerUpsert(db,session,next);
      await db.collection('activityLog').insertOne({at:new Date(),actor,action:'gta6BookingUpdated',recordId:next.id},{session});
      return next;
    });
    res.json({booking});
  });
  app.post('/api/bookings/:id/payments',async(req,res)=>{
    const values=paymentSchema.parse(req.body),{db,client}=await ready(),user=res.locals.bookingUser,actor=actorFor(user),now=Date.now();
    const booking=await transaction(db,client,async(session)=>{
      const bookings=db.collection<BookingRecord>('bookings');
      const existing=await bookings.findOne({id:req.params.id},{session});
      if(!existing)throw Object.assign(Error('Booking not found.'),{status:404});
      if(existing.status==='Cancelled'||existing.status==='No-show')throw Error('Payments cannot be added to a cancelled or no-show booking.');
      if(Math.round((paid(existing)+values.amount)*100)>Math.round(existing.totalAmount*100))throw Error('Payment exceeds the remaining balance.');
      const payment={id:randomUUID(),amount:Math.round(values.amount*100)/100,method:values.method,receivedAt:now,actor};
      const next={...existing,payments:[...(existing.payments??[]),payment],updatedAt:now,updatedBy:actor};
      await bookings.replaceOne({id:next.id},next,{session});
      await db.collection('activityLog').insertOne({at:new Date(),actor,action:'gta6BookingPayment',recordId:next.id},{session});
      return next;
    });
    res.json({booking});
  });
}
