"use strict";

const crypto=require("node:crypto");
const {defineSecret,defineString}=require("firebase-functions/params");
const {onDocumentCreated}=require("firebase-functions/v2/firestore");

const mailUrl=defineString("BEACON_APPS_SCRIPT_URL",{default:""});
const mailSecret=defineSecret("BEACON_MAIL_SECRET");
const enabled=()=>!!mailUrl.value().trim();
const maxAttempts=6;
const leaseMs=2*60*1000;

function queueMail(db,tx,stamp,job){
 const ref=db.collection("beaconMailJobs").doc();
 tx.create(ref,{...job,status:"pending",attempts:0,createdAt:stamp()});
 return ref.id;
}

async function deliver(jobId,job){
 const url=mailUrl.value().trim();
 if(!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url))
  throw new Error("Beacon Apps Script URL is invalid.");
 const payload=JSON.stringify({id:jobId,...job});
 const timestamp=String(Date.now());
 const signature=crypto.createHmac("sha256",mailSecret.value()).update(timestamp+"."+payload).digest("hex");
 const response=await fetch(url,{
  method:"POST",headers:{"Content-Type":"application/json"},
  body:JSON.stringify({timestamp,payload,signature}),signal:AbortSignal.timeout(25000)
 });
 if(!response.ok||!(await response.json()).ok)throw new Error("Beacon mail relay rejected the request.");
}

function deliveryWorker(db,admin,origin){
 const stamp=()=>admin.firestore.FieldValue.serverTimestamp();
 const remove=()=>admin.firestore.FieldValue.delete();
 return onDocumentCreated({
  document:"beaconMailJobs/{jobId}",region:"us-central1",retry:true,secrets:[mailSecret],timeoutSeconds:60,maxInstances:3
 },async event=>{
  const ref=event.data?.ref;
  if(!ref)return;
  const job=await db.runTransaction(async tx=>{
   const snap=await tx.get(ref),data=snap.data();
   if(!data||["sent","failed","cancelled"].includes(data.status))return null;
   if(data.leaseUntil>Date.now())throw new Error("Beacon mail delivery is already in progress.");
   if(data.attempts>=maxAttempts){
    tx.update(ref,{status:"failed",finishedAt:stamp(),recipient:remove(),url:remove(),studentName:remove()});
    return null;
   }
   tx.update(ref,{status:"sending",attempts:data.attempts+1,leaseUntil:Date.now()+leaseMs});
   return data;
  });
  if(!job)return;
  const finish=status=>ref.update({status,finishedAt:stamp(),leaseUntil:remove(),recipient:remove(),url:remove(),studentName:remove()});
  try{
   let url=job.url;
   if(job.kind==="verification"){
    const user=await admin.auth().getUser(job.uid).catch(error=>{
     if(error.code==="auth/user-not-found")return null;
     throw error;
    });
    if(!user||user.disabled||user.emailVerified||user.email?.toLowerCase()!==job.recipient){
     await finish("cancelled");return;
    }
    url=await admin.auth().generateEmailVerificationLink(user.email,{url:origin+"/#account"});
   }else{
    const [entry,invite]=await Promise.all([
     db.collection("entries").doc(job.entryId).get(),db.collection("invitations").doc(job.inviteId).get()
    ]);
    const record=entry.data();
    const recipient=job.kind==="guardian"?record?.guardianEmail:record?.references?.[invite.get("slot")]?.email;
    if(!record||["selected","not_selected","merged","withdrawn"].includes(record.status)||
       invite.get("status")!=="pending"||invite.get("expiresAt")?.toMillis()<=Date.now()||
       recipient!==job.recipient||(job.kind==="guardian"&&record.ageBand==="adult")){
     await finish("cancelled");return;
    }
   }
   await deliver(ref.id,{kind:job.kind,recipient:job.recipient,url,studentName:job.studentName||""});
   await finish("sent");
  }catch{
   await ref.update({status:"pending",leaseUntil:remove()});
   throw new Error("Beacon mail delivery failed. Check the Apps Script deployment and sender quota.");
  }
 });
}

module.exports={enabled,queueMail,deliveryWorker};
