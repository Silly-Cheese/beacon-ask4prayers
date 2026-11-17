"use strict";
const {onCall,HttpsError}=require("firebase-functions/v2/https");
const {defineString}=require("firebase-functions/params");
const admin=require("firebase-admin");
const crypto=require("node:crypto");
const beaconMail=require("./beacon-mail");
admin.initializeApp();
const db=admin.firestore();
const legacyIntake=defineString("BEACON_INTAKE_OPEN",{default:"false"});
const mailEnabled=defineString("BEACON_EMAIL_ENABLED",{default:"false"});
const cycle="2027";
const origin="https://beacon.ask4prayers.com";
const opts={region:"us-central1",cors:[origin,"https://silly-cheese.github.io"],maxInstances:10,memory:"256MiB"};
const stamp=()=>admin.firestore.FieldValue.serverTimestamp();
const clean=(v,n=180)=>typeof v==="string"?v.trim().slice(0,n):"";
const mail=v=>{const s=clean(v,254).toLowerCase();if(s&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))throw new HttpsError("invalid-argument","Invalid email address.");return s;};
const err=(m)=>{throw new HttpsError("invalid-argument",m);};
const requireAuth=r=>{if(!r.auth?.uid||r.auth.token.firebase?.sign_in_provider==="anonymous")throw new HttpsError("unauthenticated","Sign in with your Beacon account first.");};
const staff=r=>{requireAuth(r);if(!(r.auth.token.admin===true||r.auth.token.reviewer===true))throw new HttpsError("permission-denied","Committee access required.");};
const owner=r=>{requireAuth(r);if(r.auth.token.admin!==true)throw new HttpsError("permission-denied","Administrator access required.");};
const isAdmin=r=>r.auth?.token?.admin===true;
const intakeRef=db.collection("programSettings").doc(cycle);
const centralDate=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"});
const intakeEnabled=snapshot=>snapshot.get("intakeOpen")??(legacyIntake.value().trim().toLowerCase()==="true");
function intakeSettings(snapshot){
 const intakeDeadline=snapshot.get("intakeDeadline")||null;
 const intakeManuallyOpen=intakeEnabled(snapshot);
 const parts=Object.fromEntries(centralDate.formatToParts(new Date()).map(({type,value})=>[type,value]));
 const deadlinePassed=!!intakeDeadline&&[parts.year,parts.month,parts.day].join("-")>intakeDeadline;
 return {cycle,intakeOpen:intakeManuallyOpen&&!deadlinePassed,intakeManuallyOpen,intakeDeadline,deadlinePassed,
  honoraryOnly:true,brandedVerification:beaconMail.enabled()};
}
async function requireOpenIntake(tx){
 const settings=intakeSettings(await tx.get(intakeRef));
 if(!settings.intakeOpen)
  throw new HttpsError("failed-precondition",settings.deadlinePassed
   ?"The deadline for applications and nominations has passed."
   :"Applications and nominations are currently closed.",{intakeClosed:true});
}
const hash=v=>crypto.createHash("sha256").update(v).digest("hex");
const SECRET=(v)=>crypto.randomBytes(32).toString("base64url");
const str=(v,max=180)=>clean(v,max);
const y=v=>{const n=Number(v);return Number.isInteger(n)&&n>=2026&&n<=2040?n:null;};
const bool=v=>v===true;
const dedupe=o=>hash([o.studentName,o.school,o.graduationYear].map(x=>String(x).toLowerCase().trim().replace(/\s+/g,"")).join("|"));
const entryClosed=status=>["selected","not_selected","merged","withdrawn"].includes(status);
const entryKeyHash=token=>hash("beacon-entry:"+token);
const keyRef=token=>db.collection("nominationKeys").doc(entryKeyHash(token));
function references(v,draft=false) {
 if(!Array.isArray(v))return [];
 const email=draft?v=>str(v,254).toLowerCase():mail;
 return v.slice(0,2).map(x=>({name:str(x?.name,120),email:email(x?.email),relationship:str(x?.relationship,100)}));
}
function normalize(v,draft=false) {
 const d=v&&typeof v==="object"?v:{};
 const email=draft?v=>str(v,254).toLowerCase():mail;
 const o={
 studentName:str(d.studentName,120),preferredName:str(d.preferredName,100),
 school:str(d.school,160),grade:str(d.grade,4),graduationYear:y(d.graduationYear),
 state:str(d.state,80),educationType:str(d.educationType,40),
 applicantEmail:email(d.applicantEmail),ageBand:str(d.ageBand,20),
 gpa:d.gpa===""||d.gpa==null?null:Number(d.gpa),
 academicInterests:str(d.academicInterests,1800),futureGoals:str(d.futureGoals,1800),
 activities:str(d.activities,2400),service:str(d.service,2400),responsibilities:str(d.responsibilities,2400),
 honors:str(d.honors,1600),personalStatement:str(d.personalStatement,6000),
 additionalInfo:str(d.additionalInfo,2000),guardianName:str(d.guardianName,120),
 guardianEmail:email(d.guardianEmail),guardianRelationship:str(d.guardianRelationship,100),
 references:references(d.references,draft)
 };
 if(o.gpa!==null&&(!Number.isFinite(o.gpa)||o.gpa<0||o.gpa>4))err("GPA must be between 0 and 4.0 (unweighted).");
 return o;
}
function validateFinal(d){
 if(d.studentName.length<3||d.school.length<2||!["9","10","11","12"].includes(d.grade)||!d.graduationYear)err("Complete your name, school, grade and graduation year.");
 if(d.personalStatement.length<180)err("Please complete the personal essay.");
 if(d.ageBand!=="adult"&&d.ageBand!=="minor")err("Please indicate whether you are under 18.");
 if(d.ageBand==="minor"&&(!d.guardianName||!d.guardianEmail))err("Provide your guardian’s name and email so consent can be requested.");
 if(d.references.length!==2||d.references.some(x=>!x.name||!x.email)||d.references[0].email===d.references[1].email)
  err("Provide two different references with names and email addresses.");
 if(d.references.some(x=>x.email===d.applicantEmail||x.email===d.guardianEmail))
  err("Use reference email addresses that differ from the applicant’s and guardian’s email addresses.");
 if(d.ageBand==="minor"&&d.guardianEmail===d.applicantEmail)err("Use a separate email for your guardian.");
 // GPA is documented at eligibility screening; nominations may lack access to grades.
}
const safeSummary=(d,id)=>({entryId:id,studentName:d.studentName||"",type:d.type||"self",cycle:d.cycle||cycle,status:d.status||"draft",grade:d.grade||"",referenceStatus:d.referenceStatus||"pending",guardianStatus:d.guardianStatus||"pending",createdAt:d.createdAt?.toDate?.()?.toISOString?.()||null});
async function audit(action,entryId,uid,extra={}){await db.collection("auditLogs").add({action,entryId,actorUid:uid||null,at:stamp(),...extra});}
exports.deliverBeaconMail=beaconMail.deliveryWorker(db,admin,origin);
exports.sendBeaconVerification=onCall(opts,async r=>{
 requireAuth(r);
 if(!beaconMail.enabled())return {mode:"firebase"};
 const user=await admin.auth().getUser(r.auth.uid);
 if(user.emailVerified)return {mode:"verified"};
 const recipient=mail(user.email);
 if(!recipient||user.disabled)throw new HttpsError("failed-precondition","This account cannot receive a verification email.");
 const limit=db.collection("beaconVerificationLimits").doc(r.auth.uid);
 return db.runTransaction(async tx=>{
  const current=(await tx.get(limit)).data();
  const now=Date.now();
  const sameDay=current?.day===new Date(now).toISOString().slice(0,10);
  const count=sameDay?current.count:0;
  if(now-(current?.last||0)<60000)return {mode:"queued"};
  if(count>=5)throw new HttpsError("resource-exhausted","The daily verification email limit was reached. Please try tomorrow.");
  beaconMail.queueMail(db,tx,stamp,{kind:"verification",uid:r.auth.uid,recipient});
  tx.set(limit,{last:now,day:new Date(now).toISOString().slice(0,10),count:count+1});
  return {mode:"queued"};
 });
});
function createPrivateInvitation(tx,entryId,kind,slot,recipient,actorUid,studentName,send){
 const token=SECRET(),invite=db.collection("invitations").doc(hash(token)),expires=Date.now()+14*86400000;
 const url=origin+"/#"+(kind==="guardian"?"consent/":kind==="scholar"?"claim/":"reference/")+token;
 tx.create(invite,{entryId,kind,slot:kind==="reference"?slot:null,recipientName:recipient.name||"",
  recipientEmail:recipient.email,status:"pending",createdBy:actorUid,createdAt:stamp(),
  expiresAt:admin.firestore.Timestamp.fromMillis(expires),usedAt:null});
 tx.create(db.collection("auditLogs").doc(),{action:"invitation_created",entryId,actorUid,at:stamp(),kind,slot:kind==="reference"?slot:null});
 if(send)beaconMail.queueMail(db,tx,stamp,{kind,entryId,inviteId:invite.id,recipient:recipient.email,url,studentName});
 return {url,expiresAt:new Date(expires).toISOString()};
}
function queueStudentForms(tx,entryId,entry,uid,referenceSlots,guardianNeeded){
 if(!beaconMail.enabled())return false;
 for(const slot of referenceSlots){
  createPrivateInvitation(tx,entryId,"reference",slot,entry.references[slot],uid,entry.studentName,true);
 }
 if(guardianNeeded){
  createPrivateInvitation(tx,entryId,"guardian",null,{name:entry.guardianName,email:entry.guardianEmail},uid,entry.studentName,true);
 }
 return true;
}
exports.getProgramSettings=onCall(opts,async()=>intakeSettings(await intakeRef.get()));
exports.setIntakeStatus=onCall(opts,async r=>{
 owner(r);
 const {intakeOpen,intakeDeadline}=r.data||{};
 if(intakeOpen!==undefined&&typeof intakeOpen!=="boolean")err("Choose whether to open or close applications and nominations.");
 if(intakeDeadline!==undefined&&intakeDeadline!==null){
  if(typeof intakeDeadline!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(intakeDeadline)||intakeDeadline.slice(0,4)<"2000")
   err("Enter a valid deadline date.");
  const date=new Date(intakeDeadline+"T00:00:00Z");
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==intakeDeadline)err("Enter a valid deadline date.");
 }
 if(intakeOpen===undefined&&intakeDeadline===undefined)err("Choose an intake setting to update.");
 await db.runTransaction(async tx=>{
  const settings=await tx.get(intakeRef);
  const changes={};
  if(intakeOpen!==undefined&&settings.get("intakeOpen")!==intakeOpen)changes.intakeOpen=intakeOpen;
  if(intakeDeadline!==undefined&&(settings.get("intakeDeadline")||null)!==intakeDeadline)changes.intakeDeadline=intakeDeadline;
  if(!Object.keys(changes).length)return;
  tx.set(intakeRef,{...changes,updatedAt:stamp(),updatedBy:r.auth.uid},{merge:true});
  tx.create(db.collection("auditLogs").doc(),{
   action:"intake_settings_changed",cycle,...changes,actorUid:r.auth.uid,at:stamp()
  });
 });
 return intakeSettings(await intakeRef.get());
});
exports.getDraft=onCall(opts,async r=>{
 requireAuth(r);
 const snap=await db.collection("drafts").doc(r.auth.uid+"_"+cycle).get();
 return {draft:snap.exists?snap.data().fields:null,updatedAt:snap.data()?.updatedAt?.toDate?.()?.toISOString?.()||null};
});
exports.saveDraft=onCall(opts,async r=>{
 requireAuth(r);
 const fields=normalize(r.data?.fields,true);
 const key=db.collection("selfSubmissionKeys").doc(cycle+"_"+r.auth.uid);
 const draft=db.collection("drafts").doc(r.auth.uid+"_"+cycle);
 await db.runTransaction(async tx=>{
  await requireOpenIntake(tx);
  if((await tx.get(key)).exists)throw new HttpsError("already-exists","Your official application was already submitted.");
  tx.set(draft,{uid:r.auth.uid,cycle,fields,updatedAt:stamp()});
 });
 return {saved:true};
});
exports.submitEntry=onCall(opts,async r=>{
 const type=str(r.data?.type,24);
 if(type==="nomination"&&!bool(r.data?.declaration))err("A nomination authenticity declaration is required.");
 if(type==="self"){
  requireAuth(r);
  if(r.auth.token.email_verified!==true)throw new HttpsError("failed-precondition","Verify your account email before final submission.");
  if(!bool(r.data?.declarations?.truthful)||!bool(r.data?.declarations?.requirements))
   throw new HttpsError("failed-precondition","Both application declarations must be acknowledged.");
  const draft=db.collection("drafts").doc(r.auth.uid+"_"+cycle);
  const key=db.collection("selfSubmissionKeys").doc(cycle+"_"+r.auth.uid);
  const entry=db.collection("entries").doc();
  const result=await db.runTransaction(async tx=>{
    const prior=await tx.get(key);
    if(prior.exists){
     const existing=await tx.get(db.collection("entries").doc(prior.get("entryId")));
     return {entryId:prior.get("entryId"),formsQueued:existing.get("formsQueued")===true};
    }
    await requireOpenIntake(tx);
    const saved=await tx.get(draft);
    if(!saved.exists)err("Save your application first.");
    const fields=saved.get("fields");
    const guardian=fields.ageBand==="adult"?{guardianName:"",guardianEmail:"",guardianRelationship:""}:{};
    const d=normalize({...fields,...guardian,applicantEmail:r.auth.token.email});
    validateFinal(d);
    const formsQueued=queueStudentForms(tx,entry.id,d,r.auth.uid,[0,1],d.ageBand==="minor");
    tx.create(key,{entryId:entry.id,createdAt:stamp()});
    tx.create(entry,{
      ...d,type:"self",entryId:entry.id,cycle,status:"submitted",applicantUid:r.auth.uid,
      submitterUid:r.auth.uid,submittedAt:stamp(),createdAt:stamp(),lastUpdatedAt:stamp(),
      publicId:null,studentDeclaration:{truthful:true,requirements:true,recordedAt:new Date().toISOString(),version:"2027-v1"},guardianStatus:d.ageBand==="adult"?"not_required":"pending",
      referenceStatus:"pending",referenceCount:0,selectionReady:false,decision:null,
      duplicateKey:dedupe(d),formsQueued
    });
    tx.delete(draft);
    tx.create(db.collection("auditLogs").doc(),{action:"self_submitted",entryId:entry.id,actorUid:r.auth.uid,at:stamp()});
    return {entryId:entry.id,formsQueued};
  });
  return {received:true,...result};
 }
 if(type!=="nomination")err("Unknown submission type.");
 if(!r.auth?.uid)throw new HttpsError("unauthenticated","Sign in or use the anonymous entry mode.");
 const d=normalize(r.data?.fields);
 if(d.studentName.length<3||d.school.length<2||!["9","10","11","12"].includes(d.grade)||!d.graduationYear||d.personalStatement.length<180)
  err("Provide the student name, school, grade, year and a meaningful nomination statement.");
 const privacy=str(r.data?.privacy,20);
 if(!["named","confidential","anonymous"].includes(privacy))err("Choose a nomination privacy preference.");
 const nominator={
  name:privacy==="anonymous"?"":str(r.data?.nominatorName,120),
  email:privacy==="anonymous"?"":mail(r.data?.nominatorEmail),
  relationship:privacy==="anonymous"?"":str(r.data?.relationship,100),
  message:str(r.data?.message,1800)
 };
 if(privacy!=="anonymous"){
  requireAuth(r);
  if(!r.auth.token.email_verified||!nominator.name||nominator.email!==r.auth.token.email?.toLowerCase())
   throw new HttpsError("failed-precondition","Named and confidential nominators must sign in with their verified matching email.");
 }
 const requestId=str(r.data?.requestId,100);
 if(requestId&&!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestId))err("Invalid nomination receipt key.");
 // A random receipt key is independent of the student's or nominator's identity.
 const receipt=requestId?db.collection("nominationReceipts").doc(hash(cycle+":"+requestId)):null;
 const doc=db.collection("entries").doc();
 const day=new Date().toISOString().slice(0,10);
 // A signed-in administrator can process multiple nominations. Public submissions keep the daily limit.
 const isVerifiedAdmin=isAdmin(r)&&r.auth.token.email_verified===true&&r.auth.token.firebase?.sign_in_provider!=="anonymous";
 const quota=isVerifiedAdmin?null:db.collection("submissionQuotas").doc(hash(r.auth.uid+day));
 const entryId=await db.runTransaction(async tx=>{
  if(receipt){
   const prior=await tx.get(receipt);
   if(prior.exists)return prior.get("entryId");
  }
  await requireOpenIntake(tx);
  if(quota){
   const q=await tx.get(quota),count=Number(q.data()?.count||0);
   if(count>=2)throw new HttpsError("resource-exhausted","This account has submitted two nominations today. You can submit another after midnight UTC.");
   tx.set(quota,{count:count+1,updatedAt:stamp()},{merge:true});
  }
  if(receipt)tx.create(receipt,{entryId:doc.id,createdAt:stamp()});
  tx.create(doc,{
   ...d,personalStatement:d.personalStatement,type:"nomination",privacy,nominator,
   cycle,status:"submitted",entryId:doc.id,
   submitterUid:privacy==="anonymous"?null:r.auth.uid,applicantUid:null,
   submittedAt:stamp(),createdAt:stamp(),lastUpdatedAt:stamp(),publicId:null,
   nominatorDeclaration:{truthful:true,recordedAt:new Date().toISOString(),version:"2027-v1"},
   guardianStatus:"pending",referenceStatus:"pending",referenceCount:0,selectionReady:false,
   decision:null,duplicateKey:dedupe(d)
  });
  tx.create(db.collection("auditLogs").doc(),{
   action:"nomination_submitted",entryId:doc.id,actorUid:privacy==="anonymous"?null:r.auth.uid,at:stamp(),privacy
  });
  return doc.id;
 });
 return {received:true,entryId};
});

/**
 * Committee-only import of nominations received outside the public portal.
 * Each uploaded CSV record becomes an independent nomination; it does not
 * assert a nominator's declaration or verify eligibility, references or consent.
 */
exports.importNominations=onCall({...opts,timeoutSeconds:120},async r=>{
 owner(r);
 if(r.auth.token.email_verified!==true)
  throw new HttpsError("failed-precondition","Verify your administrator email before importing nominations.");
 const rawRows=r.data?.rows;
 if(!Array.isArray(rawRows)||rawRows.length<1||rawRows.length>20)
  err("Import between 1 and 20 nomination rows per request.");
 const sourceFile=str(r.data?.sourceFile,120)||"Emailed nominations CSV";
 const results=new Array(rawRows.length);
 const candidates=[],seen=new Map();
 for(const [index,raw] of rawRows.entries()){
  const rowNumber=Number.isInteger(raw?.rowNumber)&&raw.rowNumber>1&&raw.rowNumber<100000?raw.rowNumber:index+2;
  try{
   if(!raw||typeof raw!=="object"||Array.isArray(raw))err("Invalid CSV record.");
   const d=normalize(raw);
   if(d.studentName.length<3)err("A student name of at least 3 characters is required.");
   if(d.personalStatement.length<15)err("Include at least 15 characters explaining the nomination.");
   if(d.grade&&!["9","10","11","12"].includes(d.grade))
    err("Grade must be 9, 10, 11, 12 or blank.");
   if(raw.graduationYear!==undefined&&raw.graduationYear!==null&&String(raw.graduationYear).trim()&&!d.graduationYear)
    err("Graduation year must be 2026–2040 or blank.");
   if(d.ageBand&&!["minor","adult"].includes(d.ageBand))
    err("Under 18 must be Yes, No or blank.");
   const nominator={
    name:str(raw.nominatorName,120),email:mail(raw.nominatorEmail),
    relationship:str(raw.relationship,100),message:str(raw.nominatorMessage,1800)
   };
   const privacy=nominator.name||nominator.email?"confidential":"anonymous";
   // Content-based receipt: reimporting a previously handled email/CSV
   // does not generate another student record.
   const fingerprint=hash(JSON.stringify([
    cycle,d.studentName.toLowerCase().replace(/\s+/g," "),
    d.school.toLowerCase().replace(/\s+/g," "),
    d.personalStatement.toLowerCase().replace(/\s+/g," "),
    nominator.email,nominator.name.toLowerCase()
   ]));
   if(seen.has(fingerprint)){
    results[index]={rowNumber,status:"duplicate",message:"Identical nomination already appears earlier in this batch."};
    continue;
   }
   seen.set(fingerprint,index);
   candidates.push({index,rowNumber,d,nominator,privacy,fingerprint,sourceReceivedAt:str(raw.sourceReceivedAt,100)});
  }catch(e){
   results[index]={rowNumber,status:"invalid",message:e.message||"Invalid nomination."};
  }
 }
 if(candidates.length){
  const receipts=candidates.map(c=>db.collection("nominationImportKeys").doc(c.fingerprint));
  const created=await db.runTransaction(async tx=>{
   const existing=await Promise.all(receipts.map(ref=>tx.get(ref)));
   const out=[];
   for(const [i,c] of candidates.entries()){
    if(existing[i].exists){
     out.push({index:c.index,rowNumber:c.rowNumber,status:"duplicate",
      entryId:existing[i].get("entryId"),message:"This nomination was already imported."});
     continue;
    }
    const entry=db.collection("entries").doc();
    const record={
     ...c.d,type:"nomination",privacy:c.privacy,nominator:c.nominator,
     cycle,status:"submitted",entryId:entry.id,
     submitterUid:r.auth.uid,applicantUid:null,
     submittedAt:stamp(),createdAt:stamp(),lastUpdatedAt:stamp(),publicId:null,
     guardianStatus:"pending",referenceStatus:"pending",referenceCount:0,
     selectionReady:false,verifiedEligibility:false,decision:null,
     duplicateKey:dedupe(c.d),
     source:"committee_csv",sourceFile,sourceReceivedAt:c.sourceReceivedAt,
     importedBy:r.auth.uid,importedAt:stamp(),
     // No declaration or reference verification is inferred from email text.
     importedUnverified:true
    };
    tx.create(entry,record);
    tx.create(receipts[i],{entryId:entry.id,cycle,sourceFile,createdAt:stamp(),actorUid:r.auth.uid});
    tx.create(db.collection("auditLogs").doc(),{
     action:"nomination_imported",entryId:entry.id,actorUid:r.auth.uid,
     at:stamp(),sourceFile,rowNumber:c.rowNumber
    });
    out.push({index:c.index,rowNumber:c.rowNumber,status:"created",entryId:entry.id});
   }
   return out;
  });
  for(const item of created)results[item.index]=item;
 }
 return {results,created:results.filter(item=>item.status==="created").length,
  duplicates:results.filter(item=>item.status==="duplicate").length,
  invalid:results.filter(item=>item.status==="invalid").length};
});

exports.getMyEntries=onCall(opts,async r=>{
 requireAuth(r);
 const q=await db.collection("entries").where("applicantUid","==",r.auth.uid).limit(30).get();
 return {entries:q.docs.map(s=>safeSummary(s.data(),s.id))};
});
exports.getMyEntry=onCall(opts,async r=>{
 requireAuth(r);
 const id=str(r.data?.entryId,140),doc=await db.collection("entries").doc(id).get();
 if(!doc.exists||doc.get("applicantUid")!==r.auth.uid)throw new HttpsError("permission-denied","Entry unavailable.");
 const d=doc.data();
 const milestoneSnap=await doc.ref.collection("milestones").orderBy("createdAt","desc").limit(30).get();
 return {entry:{
   milestones:milestoneSnap.docs.map(m=>({id:m.id,title:m.get("title"),details:m.get("details"),date:m.get("date"),verified:m.get("verified")===true})),
   ...safeSummary(d,doc.id),wasFinalist:!!d.finalistAt,preferredName:d.preferredName||"",
   school:d.school,submittedAt:d.submittedAt?.toDate?.()?.toISOString?.()||null,
   guardianStatus:d.guardianStatus,referenceStatus:d.referenceStatus,
   selectedAt:d.selectedAt?.toDate?.()?.toISOString?.()||null,publicId:d.publicId||null,
   founderNote:d.status==="selected"?d.founderNote||"":"",recognitionName:d.recognitionName||d.studentName,
   deliveryPreference:d.deliveryPreference||"digital",address:d.address||null,opportunities:true,
   nominationFollowUp:d.type==="nomination"?await nominationFollowUp(doc):null
 }};
});
exports.listReviewQueue=onCall(opts,async r=>{
 staff(r);
 const cursor=str(r.data?.cursor,140);
 let query=db.collection("entries").orderBy("submittedAt","desc").orderBy(admin.firestore.FieldPath.documentId(),"desc");
 if(cursor){
  if(cursor.includes("/"))err("Invalid queue cursor.");
  const after=await db.collection("entries").doc(cursor).get();
  if(!after.get("submittedAt"))err("Invalid queue cursor.");
  query=query.startAfter(after);
 }
 const [q,settings]=await Promise.all([query.limit(81).get(),isAdmin(r)?intakeRef.get():null]);
 const page=q.docs.slice(0,80);
 const [personalReviews,recusals]=page.length?await Promise.all([
  db.getAll(...page.map(doc=>doc.ref.collection("reviews").doc(r.auth.uid)),{fieldMask:["recommend"]}),
  db.getAll(...page.map(doc=>doc.ref.collection("recusals").doc(r.auth.uid)),{fieldMask:["uid"]})
 ]):[[],[]];
 const reviewedIds=new Set(personalReviews.filter(doc=>doc.exists).map(doc=>doc.ref.parent.parent.id));
 const recusedIds=new Set(recusals.filter(doc=>doc.exists).map(doc=>doc.ref.parent.parent.id));
 const entries=page.flatMap(doc=>{
  if(recusedIds.has(doc.id))return [];
  const entry=doc.data();
  return [{...safeSummary(entry,doc.id),school:entry.school||"",myReviewSaved:reviewedIds.has(doc.id),
   requirementsPending:selectionRequirements(entry).length}];
 });
 return {entries,nextCursor:q.size>80?page.at(-1).id:null,
  intake:settings?intakeSettings(settings):null,personalReviewQueue:true
 };
});
exports.getReviewEntry=onCall(opts,async r=>{
 staff(r);
 const id=str(r.data?.entryId,140);
 if(!id||id.includes("/"))err("Choose an entry.");
 const ref=db.collection("entries").doc(id);
 const [snap,recusal]=await Promise.all([ref.get(),ref.collection("recusals").doc(r.auth.uid).get()]);
 if(!snap.exists)throw new HttpsError("not-found","Entry not found.");
 if(recusal.exists)throw new HttpsError("permission-denied","You have recused yourself from reviewing this entry.");
 const d=snap.data();
 const [refs,votes,endorsements,duplicates]=await Promise.all([
  ref.collection("references").get(),ref.collection("reviews").get(),ref.collection("endorsements").limit(20).get(),
  d.duplicateKey?db.collection("entries").where("duplicateKey","==",d.duplicateKey).limit(10).get():null
 ]);
 const mine=votes.docs.find(vote=>vote.id===r.auth.uid)?.data()||null;
 const approvals=votes.docs.filter(vote=>vote.get("recommend")==="select").length;
 const manage=isAdmin(r);
 const roster=manage&&d.status==="finalist"&&d.cycle===cycle
  ?await db.collection("entries").where("status","==","selected").where("cycle","==",cycle).limit(2).get():null;
 const decisionReadiness=manage&&!entryClosed(d.status)?{
  method:votes.size<3?"founder":"committee",
  select:[...decisionBlockers(d,"select",votes,mine),
   ...(roster?.size>=2?["Two Beacon Scholars have already been selected for this class."]:[])],
  decline:decisionBlockers(d,"decline",votes,mine)
 }:null;
 return {entry:{
   ...safeSummary(d,id),selectionStages:true,canManage:isAdmin(r),school:d.school,graduationYear:d.graduationYear,gpa:d.gpa,
   personalStatement:d.personalStatement,activities:d.activities,academicInterests:d.academicInterests,
   service:d.service,futureGoals:d.futureGoals,responsibilities:d.responsibilities,
   honors:d.honors,additionalInfo:d.additionalInfo,
   referenceStatus:d.referenceStatus,referenceCount:d.referenceCount||0,
   nominationFollowUpNeeded:!!d.entryKeyHash&&!d.nominationFollowUp?.requestedAt,
   referenceSuggestions:isAdmin(r)?d.references||[]:[],
   duplicateCount:duplicates?.size||0,
   nominator:isAdmin(r)&&d.privacy!=="anonymous"?d.nominator:null,
   duplicateKey:d.duplicateKey,eligibilityNote:isAdmin(r)?d.eligibilityNote||"":"",
   references:refs.docs.map(x=>{
     const reference=x.data();
     if(isAdmin(r))return {id:x.id,...reference};
     return {id:x.id,slot:reference.slot??Number(x.id),verified:reference.verified,answers:reference.answers};
   }),
   applicantEmail:isAdmin(r)?d.applicantEmail||"":null,
   guardianEmail:isAdmin(r)?d.guardianEmail||"":null,
   guardianName:isAdmin(r)?d.guardianName||"":null,
   ageBand:d.ageBand||"unknown",
   verifiedEligibility:d.verifiedEligibility===true,
   endorsementCount:d.endorsementCount||0,
   endorsements:endorsements.docs.map(v=>({
     statement:v.get("statement"),privacy:v.get("privacy"),
     nominator:isAdmin(r)?v.get("nominator"):null,
     sourceEntryId:isAdmin(r)?v.get("sourceEntryId"):null
   })),
   reviewCount:votes.size,decisionFromStatus:manage?d.decisionFromStatus||null:null,
   finalistAt:d.finalistAt?.toDate?.()?.toISOString?.()||null,decisionMethod:manage?d.decisionMethod||null:null,
   approveVotes:manage||mine?approvals:null,
   myReview:mine?{scores:mine.scores,total:mine.total,recommend:mine.recommend,notes:mine.notes,
    submittedAt:mine.submittedAt?.toDate?.()?.toISOString?.()||null}:null,decisionReadiness,
   requirements:selectionRequirements(d).map(({code})=>code),
   guardianStatus:d.ageBand==="adult"?"not_required":d.guardianStatus||"pending",
   founderNote:isAdmin(r)?d.founderNote||"":"",
   nominationLetter:isAdmin(r)?{
    keyIssued:!!d.entryKeyHash,needsEntryKey:d.type==="nomination"&&!d.applicantUid&&!entryClosed(d.status),
    followUpRequested:d.nominationFollowUp?.requestedAt?.toDate?.()?.toISOString?.()||null,
    formsQueued:d.nominationFollowUp?.formsQueued===true
   }:null
 }};
});
exports.recuse=onCall(opts,async r=>{
 staff(r);
 const id=str(r.data?.entryId,140),reason=str(r.data?.reason,400);
 if(reason.length<5)err("Provide a brief reason for recusal.");
 const ref=db.collection("entries").doc(id);
 await db.runTransaction(async tx=>{
  const snap=await tx.get(ref);
  if(!snap.exists)throw new HttpsError("not-found","Entry not found.");
  if(entryClosed(snap.get("status")))throw new HttpsError("failed-precondition","Entry is not open for review.");
  tx.set(ref.collection("recusals").doc(r.auth.uid),{reason,uid:r.auth.uid,at:stamp()});
  tx.delete(ref.collection("reviews").doc(r.auth.uid));
  tx.update(ref,{lastUpdatedAt:stamp()});
  tx.create(db.collection("auditLogs").doc(),{action:"reviewer_recused",entryId:id,actorUid:r.auth.uid,at:stamp()});
 });
 return {ok:true};
});
exports.recordReview=onCall(opts,async r=>{
 staff(r);
 const id=str(r.data?.entryId,140),ref=db.collection("entries").doc(id);
 const scores=r.data?.scores||{},max={character:30,perseverance:25,service:20,leadership:15,potential:10},out={};
 for(const [k,m] of Object.entries(max)){const n=Number(scores[k]);if(!Number.isInteger(n)||n<0||n>m)err("Invalid score: "+k);out[k]=n;}
 const recommend=str(r.data?.recommend,20);
 if(!["select","decline","discuss"].includes(recommend))err("Select a recommendation.");
 const recusal=ref.collection("recusals").doc(r.auth.uid);
 const review=ref.collection("reviews").doc(r.auth.uid);
 await db.runTransaction(async tx=>{
  const [snap,recused,existingReviews]=await Promise.all([tx.get(ref),tx.get(recusal),tx.get(ref.collection("reviews"))]);
  if(!snap.exists)throw new HttpsError("not-found","Entry not found.");
  if(recused.exists)throw new HttpsError("permission-denied","You are recused.");
  if(entryClosed(snap.get("status")))throw new HttpsError("failed-precondition","Entry is not open for review.");
  if(existingReviews.size>=5&&!existingReviews.docs.some(x=>x.id===r.auth.uid))
   throw new HttpsError("failed-precondition","The committee already has five reviews.");
  tx.set(review,{uid:r.auth.uid,scores:out,total:Object.values(out).reduce((a,b)=>a+b,0),
   recommend,notes:str(r.data?.notes,2400),submittedAt:stamp()});
  tx.update(ref,{lastUpdatedAt:stamp()});
  tx.create(db.collection("auditLogs").doc(),{action:"committee_review",entryId:id,actorUid:r.auth.uid,at:stamp()});
 });
 return {ok:true};
});
const reviewStages=["submitted","screening","under_review","finalist"];
function selectionRequirements(entry){
 const pending=[];
 if(entry.entryKeyHash&&!entry.nominationFollowUp?.requestedAt)
  pending.push({code:"follow_up",message:"The nominee must connect their Entry Key and submit their follow-up details first."});
 if(!entry.verifiedEligibility)
  pending.push({code:"eligibility",message:"Eligibility must be verified first."});
 if((entry.referenceCount||0)<2)
  pending.push({code:"references",message:"Two verified references are required."});
 if(entry.ageBand!=="adult"&&entry.guardianStatus!=="verified")
  pending.push({code:"consent",message:"Guardian consent must be verified."});
 return pending;
}
function requireSelectionRequirements(entry){
 const missing=selectionRequirements(entry)[0];
 if(missing)throw new HttpsError("failed-precondition",missing.message);
}
function decisionBlockers(entry,decision,votes,mine,method=votes.size<3?"founder":"committee"){
 const reasons=decision==="select"?selectionRequirements(entry).map(item=>item.message):[];
 if(decision==="select"&&entry.status!=="finalist")reasons.unshift("Advance this student to Finalist before selecting a Beacon Scholar.");
 if(decision==="decline"&&!entry.verifiedEligibility)reasons.push("Eligibility must be verified first.");
 if(method==="founder"){
  if(votes.size>=3)reasons.push("Use the committee decision once three evaluations are on file.");
  else if(mine?.recommend!==decision)reasons.push(decision==="select"
   ?"Save your own evaluation with a recommendation to select."
   :"Save your own evaluation with a recommendation against selection.");
 }else if(votes.size<3||votes.size>5){
  reasons.push("Committee decisions require 3–5 evaluations. With fewer than three, save your evaluation and use Founder review.");
 }else if(decision==="select"&&votes.docs.filter(vote=>vote.get("recommend")==="select").length<2){
  reasons.push("Selection needs at least two favorable recommendations.");
 }
 return reasons;
}
exports.setEligibility=onCall(opts,async r=>{
 owner(r);
 const id=str(r.data?.entryId,140),eligible=r.data?.eligible===true;
 if(!id||id.includes("/"))err("Choose an entry.");
 const ref=db.collection("entries").doc(id);
 await db.runTransaction(async tx=>{
  const [s,recusal]=await Promise.all([tx.get(ref),tx.get(ref.collection("recusals").doc(r.auth.uid))]);
  if(!s.exists)throw new HttpsError("not-found","Entry not found.");
  if(recusal.exists)throw new HttpsError("permission-denied","You recused yourself from this entry.");
  if(entryClosed(s.get("status")))throw new HttpsError("failed-precondition","Entry is no longer open for decisions.");
  if(r.data?.fromStatus&&r.data.fromStatus!==s.get("status"))
   throw new HttpsError("failed-precondition","The stage changed. Reload the selection file and try again.");
  if(eligible&&r.data?.fromStatus==="submitted")
   throw new HttpsError("failed-precondition","Start eligibility screening first.");
  if(eligible&&(!Number.isFinite(s.get("gpa"))||s.get("gpa")<2.5))
   throw new HttpsError("failed-precondition","Verify an unweighted GPA of at least 2.5 before approving eligibility.");
  const status=s.get("status"),notes=str(r.data?.notes,1000);
  const next=eligible?(status==="finalist"?"finalist":"under_review"):"screening";
  tx.update(ref,{verifiedEligibility:eligible,eligibilityNote:notes,status:next,lastUpdatedAt:stamp(),
   ...(next==="screening"?{finalistAt:null}:{})});
  tx.create(db.collection("auditLogs").doc(),{action:"eligibility_review",entryId:id,actorUid:r.auth.uid,at:stamp(),
   eligible,fromStatus:status,toStatus:next});
 });
 return {ok:true};
});
exports.moveSelectionStage=onCall(opts,async r=>{
 owner(r);
 const id=str(r.data?.entryId,140),from=str(r.data?.fromStatus,20),to=str(r.data?.toStatus,20);
 const reason=str(r.data?.reason,600);
 if(!id||id.includes("/")||!reviewStages.includes(to))err("Choose an entry and a valid stage.");
 const ref=db.collection("entries").doc(id);
 return db.runTransaction(async tx=>{
  const [snapshot,recusal]=await Promise.all([tx.get(ref),tx.get(ref.collection("recusals").doc(r.auth.uid))]);
  if(!snapshot.exists)throw new HttpsError("not-found","Entry not found.");
  if(recusal.exists)throw new HttpsError("permission-denied","You recused yourself from this entry.");
  const entry=snapshot.data();
  if(entry.status!==from)throw new HttpsError("failed-precondition","The stage changed. Reload the selection file and try again.");
  const finalized=from==="selected"||from==="not_selected";
  const formerStage=from==="selected"?"finalist":
   reviewStages.includes(entry.decisionFromStatus)?entry.decisionFromStatus:entry.verifiedEligibility?"under_review":"screening";
  const step=reviewStages.indexOf(to)-reviewStages.indexOf(from);
  if(finalized){
   if(to!==formerStage)err("Reopen the entry at its previous review stage.");
   if(reason.length<5)err("Enter a reason for reopening the decision.");
  }else if(!reviewStages.includes(from)||Math.abs(step)!==1){
   err("Move to the next or previous review stage.");
  }
  if(to==="under_review"&&step===1)
   throw new HttpsError("failed-precondition","Use eligibility verification to advance into committee review.");
  if(to==="finalist"&&from==="under_review")requireSelectionRequirements(entry);
  const changes={status:to,lastUpdatedAt:stamp()};
  if(to==="finalist")changes.finalistAt=entry.finalistAt||stamp();
  if(to!=="finalist")changes.finalistAt=null;
  if(to==="screening"||to==="submitted")changes.verifiedEligibility=false;
  if(finalized)Object.assign(changes,{decision:null,decisionMethod:null,decisionFromStatus:null,
   decidedBy:null,selectedAt:null,publicId:null,scholarAccepted:false,publicityConsent:false});
  if(from==="selected"){
   const lock=db.collection("programSettings").doc(entry.cycle||cycle);
   await tx.get(lock);
   tx.set(lock,{scholarRosterVersion:admin.firestore.FieldValue.increment(1)},{merge:true});
  }
  tx.update(ref,changes);
  tx.create(db.collection("auditLogs").doc(),{action:"selection_stage_changed",entryId:id,actorUid:r.auth.uid,at:stamp(),
   fromStatus:from,toStatus:to,reason});
  return {ok:true,status:to};
 });
});
exports.createInvitation=onCall(opts,async r=>{
 owner(r);
 const entryId=str(r.data?.entryId,140),kind=str(r.data?.kind,25),slot=Number(r.data?.slot);
 if(!["reference","guardian","scholar"].includes(kind))err("Choose guardian, reference or Scholar.");
 if(kind==="reference"&&![0,1].includes(slot))err("Choose reference 1 or 2.");
 const ref=db.collection("entries").doc(entryId),s=await ref.get();
 if(!s.exists)throw new HttpsError("not-found","Entry not found.");
 const d=s.data();
 if(["merged","withdrawn"].includes(d.status)||(kind!=="scholar"&&["selected","not_selected"].includes(d.status)))throw new HttpsError("failed-precondition","Entry is not accepting this invitation.");
 const recipient=kind==="guardian"?{name:d.guardianName||"Guardian",email:d.guardianEmail}:
  kind==="scholar"?{name:d.studentName,email:d.applicantEmail}:{...(d.references||[])[slot]};
 if(!recipient?.email)throw new HttpsError("failed-precondition","This entry is missing the recipient email. Ask applicant to correct it.");
 if(kind==="guardian"&&d.guardianStatus==="verified")throw new HttpsError("failed-precondition","Guardian consent is already verified. Withdraw it before issuing another invitation.");
 if(kind==="reference"){
  const oldReference=await ref.collection("references").doc(String(slot)).get();
  if(oldReference.get("verified")===true)throw new HttpsError("failed-precondition","Reference already verified. Invalidate it before requesting a replacement.");
 }
 const useAppsScript=kind!=="scholar"&&beaconMail.enabled();
 const {url,expiresAt}=await db.runTransaction(async tx=>{
  const fresh=await tx.get(ref);
  const record=fresh.data();
  const currentEmail=kind==="guardian"?record?.guardianEmail:kind==="scholar"?record?.applicantEmail:record?.references?.[slot]?.email;
  if(!record||currentEmail!==recipient.email||["merged","withdrawn"].includes(record.status)||
     (kind!=="scholar"&&entryClosed(record.status))||
     (kind==="guardian"&&(record.ageBand==="adult"||record.guardianStatus==="verified")))
   throw new HttpsError("failed-precondition","The entry changed. Reopen the selection file and try again.");
  if(kind==="reference"&&(await tx.get(ref.collection("references").doc(String(slot)))).get("verified")===true)
   throw new HttpsError("failed-precondition","This reference is already verified.");
  const previous=await tx.get(db.collection("invitations").where("entryId","==",entryId));
  for(const old of previous.docs){
   if(old.get("status")==="pending"&&old.get("kind")===kind&&(kind!=="reference"||old.get("slot")===slot))
    tx.update(old.ref,{status:"superseded",supersededAt:stamp()});
  }
  return createPrivateInvitation(tx,entryId,kind,slot,recipient,r.auth.uid,d.studentName,useAppsScript);
 });
 let queued=useAppsScript;
 if(!queued&&mailEnabled.value()==="true"){
   // The official Firebase Trigger Email extension must be configured for 'mail'
   // with a valid SMTP provider. No public client may write to this collection.
   await db.collection("mail").add({
     to:[recipient.email],createdAt:stamp(),
     message:{subject:kind==="guardian"?"Beacon Scholars: Parent/guardian authorization":
       kind==="scholar"?"Beacon Scholars: Connect your account":"Beacon Scholars: Confidential reference request",
       text:"Hello "+recipient.name+",\n\nThe Beacon Scholars team invites you to complete a private "+kind+
       " form. Open the secure one-time link:\n"+url+
       "\n\nThis link expires in 14 days. Do not forward it. Contact The Prayer Project if you did not expect this invitation.\n\nBeacon Scholars • The Prayer Project"}
   });
   queued=true;
 }
 // An admin may copy the URL for secure manual delivery when automatic mail is disabled.
 return {url,recipientEmail:recipient.email,expiresAt,queued};
});
exports.getInvitation=onCall(opts,async r=>{
 const token=str(r.data?.token,150),s=await db.collection("invitations").doc(hash(token)).get();
 if(!s.exists||s.get("expiresAt").toMillis()<Date.now()||s.get("status")!=="pending")throw new HttpsError("not-found","This invitation has expired or was already used.");
 return {kind:s.get("kind"),recipientName:s.get("recipientName"),expiresAt:s.get("expiresAt").toDate().toISOString()};
});
exports.respondInvitation=onCall(opts,async r=>{
 const token=str(r.data?.token,150),ref=db.collection("invitations").doc(hash(token));
 const response=r.data?.response||{};
 const type=str(response.type,30),fullName=str(response.fullName,120),signature=str(response.signature,120);
 if(!fullName||!signature||!bool(response.attest))err("Provide full name, electronic signature and confirmation.");
 const snap=await ref.get();
 if(!snap.exists||snap.get("expiresAt").toMillis()<Date.now()||snap.get("status")!=="pending")throw new HttpsError("not-found","This invitation is invalid or expired.");
 const i=snap.data(),entryRef=db.collection("entries").doc(i.entryId);
 if(i.kind==="reference"){
  if(type!=="reference")err("Invalid response type.");
  const answers=[0,1,2,3,4].map(n=>str(response["answer"+n],1600));
  if(answers.some(x=>x.length<15))err("Complete all five reference questions.");
  const target=entryRef.collection("references").doc(String(i.slot));
  await db.runTransaction(async tx=>{
   const [fresh,entry,prior]=await Promise.all([tx.get(ref),tx.get(entryRef),tx.get(target)]);
   if(fresh.get("status")!=="pending"||fresh.get("expiresAt").toMillis()<Date.now()||
      !entry.exists||entryClosed(entry.get("status"))||prior.get("verified")===true||
      entry.get("references")?.[i.slot]?.email!==i.recipientEmail)
    throw new HttpsError("failed-precondition","This reference link is no longer active.");
   tx.set(target,{fullName,signature,answers,recipientEmail:i.recipientEmail,slot:i.slot,submittedAt:stamp(),verified:false});
   tx.update(ref,{status:"completed",usedAt:stamp()});
   tx.update(entryRef,{referenceStatus:"awaiting_verification",lastUpdatedAt:stamp()});
  });
 }else if(i.kind==="guardian"){
  if(type!=="guardian")err("Invalid response type.");
  if(!bool(response.consent)||!bool(response.isGuardian))err("Consent and guardian authority are both required.");
  await db.runTransaction(async tx=>{
   const [fresh,entry]=await Promise.all([tx.get(ref),tx.get(entryRef)]);
   if(fresh.get("status")!=="pending"||fresh.get("expiresAt").toMillis()<Date.now()||
      !entry.exists||entryClosed(entry.get("status"))||entry.get("guardianStatus")==="verified"||
      entry.get("ageBand")==="adult"||entry.get("guardianEmail")!==i.recipientEmail)
    throw new HttpsError("failed-precondition","This guardian link is no longer active.");
   tx.update(entryRef,{guardianStatus:"signed_pending_verification",guardianRecord:{
     fullName,signature,relationship:str(response.relationship,100),
     consent:true,publicityConsent:bool(response.publicityConsent),
     signedAt:new Date().toISOString(),consentVersion:"2027-v1",verified:false},
     lastUpdatedAt:stamp()});
   tx.update(ref,{status:"completed",usedAt:stamp()});
  });
 }else{throw new HttpsError("permission-denied","Wrong invitation type.");}
 await audit("invitation_completed",i.entryId,null,{kind:i.kind,slot:i.slot});
 return {ok:true};
});
exports.verifyRequirement=onCall(opts,async r=>{
 owner(r);
 const id=str(r.data?.entryId,140),kind=str(r.data?.kind,20),slot=Number(r.data?.slot);
 if(!["guardian","reference"].includes(kind))err("Invalid requirement.");
 if(kind==="reference"&&![0,1].includes(slot))err("Invalid reference.");
 const entry=db.collection("entries").doc(id);
 await db.runTransaction(async tx=>{
  const s=await tx.get(entry);
  if(!s.exists)throw new HttpsError("not-found","Entry not found.");
  if(entryClosed(s.get("status")))throw new HttpsError("failed-precondition","Entry is closed.");
  if(kind==="reference"){
   const doc=entry.collection("references").doc(String(slot));
   const [rs,other]=await Promise.all([tx.get(doc),tx.get(entry.collection("references").doc(String(1-slot)))]);
   if(!rs.exists)throw new HttpsError("failed-precondition","Reference not submitted.");
   if(other.get("verified")===true&&other.get("recipientEmail")===rs.get("recipientEmail"))
    throw new HttpsError("failed-precondition","The two verified references must come from different people.");
   const count=other.get("verified")===true?2:1;
   tx.update(doc,{verified:true,verifiedBy:r.auth.uid,verifiedAt:stamp()});
   tx.update(entry,{referenceCount:count,referenceStatus:count===2?"verified":"pending",lastUpdatedAt:stamp()});
  }else{
   if(!s.get("guardianRecord")?.consent)throw new HttpsError("failed-precondition","Guardian has not signed.");
   tx.update(entry,{"guardianRecord.verified":true,"guardianRecord.verifiedBy":r.auth.uid,guardianStatus:"verified",lastUpdatedAt:stamp()});
  }
  tx.create(db.collection("auditLogs").doc(),{action:"requirement_verified",entryId:id,actorUid:r.auth.uid,at:stamp(),kind,
   slot:kind==="reference"?slot:null});
 });
 return {ok:true};
});
exports.finalizeDecision=onCall(opts,async r=>{
 owner(r);
 const id=str(r.data?.entryId,140),decision=str(r.data?.decision,20),note=str(r.data?.founderNote,3400);
 if(!id||id.includes("/"))err("Choose an entry.");
 if(!["select","decline"].includes(decision))err("Invalid decision.");
 const method=r.data?.reviewMethod??"committee";
 if(!["committee","founder"].includes(method))err("Choose a review method.");
 const entry=db.collection("entries").doc(id);
 return db.runTransaction(async tx=>{
  const snap=await tx.get(entry);
  if(!snap.exists)throw new HttpsError("not-found","Entry not found.");
  const d=snap.data();
  if(entryClosed(d.status))throw new HttpsError("failed-precondition","Entry cannot be finalized.");
  if(r.data?.fromStatus&&r.data.fromStatus!==d.status)
   throw new HttpsError("failed-precondition","The stage changed. Reload the selection file and try again.");
  const [votes,recusal]=await Promise.all([
   tx.get(entry.collection("reviews")),tx.get(entry.collection("recusals").doc(r.auth.uid))
  ]);
  if(recusal.exists)throw new HttpsError("permission-denied","You recused yourself from this entry.");
  const mine=votes.docs.find(vote=>vote.id===r.auth.uid)?.data()||null;
  const [blocker]=decisionBlockers(d,decision,votes,mine,method);
  if(blocker)throw new HttpsError("failed-precondition",blocker);
  const selected=decision==="select",entryCycle=d.cycle||cycle;
  if(selected&&entryCycle===cycle){
   const lock=intakeRef;
   // Serialize roster changes, including when the selected-entries query is empty.
   await tx.get(lock);
   const scholars=await tx.get(db.collection("entries").where("status","==","selected").where("cycle","==",entryCycle).limit(2));
   if(scholars.size>=2)throw new HttpsError("failed-precondition","Two Beacon Scholars have already been selected for this class.");
   tx.set(lock,{scholarRosterVersion:admin.firestore.FieldValue.increment(1)},{merge:true});
  }
  const publicId=selected?"BCN-"+entryCycle+"-"+id.slice(0,8).toUpperCase():null;
  tx.update(entry,{status:selected?"selected":"not_selected",decision,decisionFromStatus:d.status,decisionMethod:method,decidedBy:r.auth.uid,
   selectedAt:selected?stamp():null,publicId,founderNote:selected?note:"",lastUpdatedAt:stamp()});
  tx.create(db.collection("auditLogs").doc(),{
   action:"decision_finalized",entryId:id,actorUid:r.auth.uid,at:stamp(),decision,decisionMethod:method,reviewCount:votes.size
  });
  if(mailEnabled.value()==="true"&&d.applicantEmail){
   tx.create(db.collection("mail").doc(),{to:[d.applicantEmail],createdAt:stamp(),message:{
    subject:selected?"Beacon Scholars: Recognition Decision":"Beacon Scholars: Application Decision",
    text:selected?
      "Congratulations. You have been selected as a Beacon Scholar. Sign in at "+origin+" to review your recognition. Recognition is honorary, with no financial award promised.":
      "Thank you for your Beacon Scholars submission. Following committee review, your entry was not selected this cycle. We appreciate your story and your willingness to be considered."
   }});
  }
  return {ok:true,publicId};
 });
});
exports.saveScholarPreferences=onCall(opts,async r=>{
 requireAuth(r);
 const id=str(r.data?.entryId,140),entry=db.collection("entries").doc(id),snap=await entry.get();
 if(!snap.exists||snap.get("applicantUid")!==r.auth.uid||snap.get("status")!=="selected")
  throw new HttpsError("permission-denied","Scholar record unavailable.");
 const preference=str(r.data?.deliveryPreference,20);
 if(!["digital","mail"].includes(preference))err("Choose digital or mail.");
 const address=r.data?.address||{};
 const obj={line1:str(address.line1,160),line2:str(address.line2,100),city:str(address.city,100),state:str(address.state,80),zip:str(address.zip,15)};
 if(preference==="mail"&&(!obj.line1||!obj.city||!obj.state||!obj.zip))err("Provide your mailing address.");
 await entry.update({recognitionName:str(r.data?.recognitionName,120)||snap.get("studentName"),deliveryPreference:preference,
  address:preference==="mail"?obj:null,publicityConsent:bool(r.data?.publicityConsent)&&(snap.get("ageBand")==="adult"||snap.get("guardianRecord")?.publicityConsent===true),
  scholarAccepted:true,acceptedAt:stamp(),lastUpdatedAt:stamp()});
 await audit("scholar_accepted",id,r.auth.uid);
 return {ok:true};
});

exports.updateEntryContacts=onCall(opts,async r=>{
 owner(r);
 const id=str(r.data?.entryId,140),ref=db.collection("entries").doc(id),snap=await ref.get();
 if(!snap.exists)throw new HttpsError("not-found","Entry not found.");
 if(["selected","not_selected","merged","withdrawn"].includes(snap.get("status")))throw new HttpsError("failed-precondition","Entry is closed.");
 const original=snap.data(),fields=r.data?.fields||{},changes={lastUpdatedAt:stamp()};
 if("guardianEmail" in fields)changes.guardianEmail=mail(fields.guardianEmail);
 if("guardianName" in fields)changes.guardianName=str(fields.guardianName,120);
 if("applicantEmail" in fields)changes.applicantEmail=mail(fields.applicantEmail);
 if("ageBand" in fields){if(!["minor","adult",""].includes(fields.ageBand))err("Invalid age band.");changes.ageBand=fields.ageBand;}
 if("gpa" in fields){const n=fields.gpa===""?null:Number(fields.gpa);if(n!==null&&(!Number.isFinite(n)||n<0||n>4))err("GPA outside valid range.");changes.gpa=n;}
 if("references" in fields)changes.references=references(fields.references);
 const guardianChanged="guardianEmail" in changes&&changes.guardianEmail!==original.guardianEmail;
 const refContacts=x=>(x||[]).map(z=>({name:str(z.name,120),email:mail(z.email)}));
 const refsChanged="references" in changes&&JSON.stringify(refContacts(changes.references))!==JSON.stringify(refContacts(original.references));
 const applicantChanged="applicantEmail" in changes&&changes.applicantEmail!==original.applicantEmail;
 if(guardianChanged){changes.guardianStatus="pending";changes.guardianRecord=admin.firestore.FieldValue.delete();}
 if(refsChanged){changes.referenceCount=0;changes.referenceStatus="pending";}
 if("gpa" in changes&&changes.gpa!==original.gpa)changes.verifiedEligibility=false;
 if("ageBand" in changes&&changes.ageBand!==original.ageBand)changes.verifiedEligibility=false;
 await db.runTransaction(async tx=>{
  const current=await tx.get(ref);
  if(!current.exists||entryClosed(current.get("status")))
   throw new HttpsError("failed-precondition","Entry is closed.");
  if(!current.updateTime.isEqual(snap.updateTime))
   throw new HttpsError("failed-precondition","The selection file changed. Reload it and try again.");
  const old=refsChanged?await tx.get(ref.collection("references")):null;
  const invites=guardianChanged||refsChanged||applicantChanged
   ?await tx.get(db.collection("invitations").where("entryId","==",id).limit(100)):null;
  tx.update(ref,changes);
  for(const reference of old?.docs||[])tx.delete(reference.ref);
  for(const invite of invites?.docs||[]){
   const kind=invite.get("kind");
   if(invite.get("status")==="pending"&&((guardianChanged&&kind==="guardian")||
     (refsChanged&&kind==="reference")||(applicantChanged&&kind==="scholar")))
    tx.update(invite.ref,{status:"revoked",revokedAt:stamp()});
  }
  tx.create(db.collection("auditLogs").doc(),{action:"admin_contact_update",entryId:id,actorUid:r.auth.uid,at:stamp(),
   fields:Object.keys(changes).filter(k=>k!=="lastUpdatedAt")});
 });
 return {ok:true};
});
exports.useVerifiedNominatorReference=onCall(opts,async r=>{
 owner(r);
 const entryId=str(r.data?.entryId,140),entry=db.collection("entries").doc(entryId),doc=await entry.get();
 if(!doc.exists)throw new HttpsError("not-found","Entry unavailable.");
 const d=doc.data();
 if(d.type!=="nomination"||d.privacy==="anonymous"||!d.nominator?.email||["merged","withdrawn","selected","not_selected"].includes(d.status))throw new HttpsError("failed-precondition","No eligible verified nominator for this open entry.");
 const slot=Number(r.data?.slot);
 if(![0,1].includes(slot))err("Choose reference slot 1 or 2.");
 if(!bool(r.data?.identityVerified))err("Verify nominator identity independently first.");
 const other=await entry.collection("references").doc(String(1-slot)).get();
 if(other.get("recipientEmail")===d.nominator.email)
  throw new HttpsError("failed-precondition","This nominator already occupies the other reference slot.");
 const ref=entry.collection("references").doc(String(slot));
 await ref.set({fullName:d.nominator.name,signature:"Verified nominator statement",answers:[
  d.nominator.relationship||"Known by nominator",
  d.personalStatement,d.personalStatement,
  d.personalStatement,d.personalStatement
 ],recipientEmail:d.nominator.email,slot,submittedAt:d.submittedAt,verified:true,
  verifiedBy:r.auth.uid,verifiedAt:stamp(),source:"verified_nominator"});
 const all=await entry.collection("references").get();
 const count=all.docs.filter(x=>x.get("verified")===true||x.id===String(slot)).length;
 await entry.update({referenceCount:count,referenceStatus:count>=2?"verified":"pending"});
 await audit("nominator_as_reference",entryId,r.auth.uid,{slot});
 return {ok:true};
});
exports.createNominationKey=onCall(opts,async r=>{
 owner(r);
 const entryId=str(r.data?.entryId,140);
 if(!entryId||entryId.includes("/"))err("Choose a nomination.");
 const entry=db.collection("entries").doc(entryId);
 const token=crypto.randomBytes(16).toString("hex").toUpperCase();
 const key=keyRef(token),expires=Date.now()+30*86400000;
 await db.runTransaction(async tx=>{
  const snapshot=await tx.get(entry);
  if(!snapshot.exists||snapshot.get("type")!=="nomination"||entryClosed(snapshot.get("status"))||snapshot.get("applicantUid"))
   throw new HttpsError("failed-precondition","This nomination is no longer waiting to be connected.");
  const oldKey=snapshot.get("entryKeyHash");
  if(oldKey&&r.data?.replace!==true&&snapshot.get("entryKeyExpiresAt")?.toMillis()>Date.now())
   throw new HttpsError("failed-precondition","An Entry Key already exists. Reopen this selection file before issuing a replacement.");
  const expiresAt=admin.firestore.Timestamp.fromMillis(expires);
  tx.create(key,{entryId,expiresAt});
  tx.update(entry,{entryKeyHash:key.id,entryKeyExpiresAt:expiresAt,lastUpdatedAt:stamp()});
  if(oldKey)tx.delete(db.collection("nominationKeys").doc(oldKey));
  tx.create(db.collection("auditLogs").doc(),{action:"nomination_key_issued",entryId,actorUid:r.auth.uid,at:stamp()});
 });
 return {key:token.match(/.{4}/g).join("-"),expiresAt:new Date(expires).toISOString()};
});
async function claimEntryKey(r){
 const token=str(r.data?.entryKey,80).replace(/[\s-]/g,"").toUpperCase();
 if(!/^[0-9A-F]{32}$/.test(token))err("Enter the complete Entry Key from your letter.");
 const key=keyRef(token),email=mail(r.auth.token.email);
 if(!email)throw new HttpsError("failed-precondition","Use a verified email account.");
 return db.runTransaction(async tx=>{
  const ticket=await tx.get(key);
  const invalid=()=>new HttpsError("not-found","This Entry Key is invalid, expired, or already used.");
  if(!ticket.exists||ticket.get("expiresAt").toMillis()<Date.now())throw invalid();
  const entry=db.collection("entries").doc(ticket.get("entryId"));
  const record=await tx.get(entry);
  if(!record.exists||record.get("type")!=="nomination"||entryClosed(record.get("status"))||record.get("entryKeyHash")!==key.id)throw invalid();
  if(ticket.get("usedBy")===r.auth.uid&&record.get("applicantUid")===r.auth.uid)return {ok:true,entryId:entry.id};
  if(ticket.get("usedBy")||record.get("applicantUid"))throw invalid();
  const studentEmail=mail(record.get("applicantEmail"));
  if(studentEmail&&studentEmail!==email)throw new HttpsError("permission-denied","Sign in with the student email Beacon has on file, or contact Beacon to correct it.");
  tx.update(entry,{applicantUid:r.auth.uid,applicantEmail:email,lastUpdatedAt:stamp()});
  tx.update(key,{usedBy:r.auth.uid,usedAt:stamp()});
  tx.create(db.collection("auditLogs").doc(),{action:"nomination_key_claimed",entryId:entry.id,actorUid:r.auth.uid,at:stamp()});
  return {ok:true,entryId:entry.id};
 });
}
async function nominationFollowUp(snapshot){
 const submitted=snapshot.get("nominationFollowUp");
 const responses=await snapshot.ref.collection("references").get();
 return {
  canSubmit:!entryClosed(snapshot.get("status"))&&!submitted?.requestedAt,
  requested:!!submitted?.requestedAt,
  formsQueued:submitted?.formsQueued===true,
  ageBand:snapshot.get("ageBand")||"",
  guardianLocked:!!snapshot.get("guardianRecord")?.consent&&snapshot.get("guardianStatus")!=="withdrawn",
  references:[0,1].map(slot=>{
   const reference=responses.docs.find(doc=>doc.id===String(slot));
   return reference?(reference.get("verified")===true?"Verified":"Response received"):"Pending";
  })
 };
}
exports.submitNominationFollowUp=onCall(opts,async r=>{
 requireAuth(r);
 if(r.auth.token.email_verified!==true)throw new HttpsError("failed-precondition","Verify your account email first.");
 const entryId=str(r.data?.entryId,140);
 if(!entryId||entryId.includes("/"))err("Choose your nomination.");
 const entry=db.collection("entries").doc(entryId), fields=r.data?.fields||{};
 return db.runTransaction(async tx=>{
  const snapshot=await tx.get(entry);
  if(!snapshot.exists||snapshot.get("type")!=="nomination"||snapshot.get("applicantUid")!==r.auth.uid)
   throw new HttpsError("permission-denied","This nomination is not connected to your account.");
  const prior=snapshot.get("nominationFollowUp");
  if(prior?.requestedAt)return {ok:true,formsQueued:prior.formsQueued===true};
  if(entryClosed(snapshot.get("status")))throw new HttpsError("failed-precondition","This nomination is no longer under consideration.");
  const responses=await Promise.all([0,1].map(slot=>tx.get(entry.collection("references").doc(String(slot)))));
  const contacts=references(fields.references);
  const savedReferences=snapshot.get("references")||[];
  const nextReferences=responses.map((response,slot)=>{
   if(response.exists)return savedReferences[slot]||{name:"",email:"",relationship:""};
   const reference=contacts[slot];
   if(!reference?.name||!reference.email)err("Provide a name and email for each outstanding reference.");
   return reference;
  });
  const referenceEmails=responses.map((response,slot)=>mail(response.get("recipientEmail")||nextReferences[slot].email)).filter(Boolean);
  const guardianLocked=!!snapshot.get("guardianRecord")?.consent&&snapshot.get("guardianStatus")!=="withdrawn";
  const ageBand=guardianLocked?"minor":fields.ageBand;
  if(!["minor","adult"].includes(ageBand))err("Choose whether you are under 18.");
  const guardianName=ageBand==="minor"?str(guardianLocked?snapshot.get("guardianName"):fields.guardianName,120):"";
  const guardianEmail=ageBand==="minor"?mail(guardianLocked?snapshot.get("guardianEmail"):fields.guardianEmail):"";
  if(ageBand==="minor"&&!guardianLocked&&(!guardianName||!guardianEmail))err("Provide your parent or guardian’s name and email.");
  const studentEmail=mail(r.auth.token.email);
  if(guardianEmail&&guardianEmail===studentEmail)err("Use a separate email for your parent or guardian.");
  if(new Set(referenceEmails).size!==referenceEmails.length||referenceEmails.some(email=>email===studentEmail||email===guardianEmail))
   err("Use a different email for each reference, the student, and the parent or guardian.");
  const guardianStatus=ageBand==="adult"?"not_required":guardianLocked?snapshot.get("guardianStatus"):"pending";
  const referenceCount=responses.filter(response=>response.get("verified")===true).length;
  const referenceStatus=referenceCount===2?"verified":responses.some(response=>response.exists&&response.get("verified")!==true)?"awaiting_verification":"pending";
  const slots=[0,1].filter(slot=>!responses[slot].exists);
  const guardianNeeded=ageBand==="minor"&&!guardianLocked;
  if(beaconMail.enabled()){
   const previous=await tx.get(db.collection("invitations").where("entryId","==",entryId));
   for(const invitation of previous.docs){
    const kind=invitation.get("kind");
    if(invitation.get("status")==="pending"&&
       ((kind==="reference"&&slots.includes(invitation.get("slot")))||(kind==="guardian"&&guardianNeeded)))
     tx.update(invitation.ref,{status:"superseded",supersededAt:stamp()});
   }
  }
  const formsQueued=queueStudentForms(tx,entryId,{
   references:nextReferences,guardianName,guardianEmail,studentName:snapshot.get("studentName")
  },r.auth.uid,slots,guardianNeeded);
  tx.update(entry,{references:nextReferences,ageBand,guardianName,guardianEmail,guardianStatus,referenceCount,referenceStatus,
   ...(guardianLocked?{}:{guardianRecord:admin.firestore.FieldValue.delete()}),
   nominationFollowUp:{requestedAt:stamp(),formsQueued},lastUpdatedAt:stamp()});
  tx.create(db.collection("auditLogs").doc(),{action:"nomination_follow_up_requested",entryId,actorUid:r.auth.uid,at:stamp()});
  return {ok:true,formsQueued};
 });
});

exports.claimNomination=onCall(opts,async r=>{
 requireAuth(r);
 if(!r.auth.token.email_verified)throw new HttpsError("failed-precondition","Verify your account email first.");
 if(r.data?.entryKey!==undefined)return claimEntryKey(r);
 const token=str(r.data?.token,150),invite=db.collection("invitations").doc(hash(token)),s=await invite.get();
 if(!s.exists||s.get("kind")!=="scholar"||s.get("status")!=="pending"||s.get("expiresAt").toMillis()<Date.now())
  throw new HttpsError("not-found","Claim invitation invalid or expired.");
 if(s.get("recipientEmail")!==r.auth.token.email?.toLowerCase())
  throw new HttpsError("permission-denied","Sign in using the email address invited by Beacon.");
 const entry=db.collection("entries").doc(s.get("entryId"));
 await db.runTransaction(async tx=>{
  const [fresh,e]=await Promise.all([tx.get(invite),tx.get(entry)]);
  if(fresh.get("status")!=="pending"||!e.exists||["merged","withdrawn"].includes(e.get("status")))throw new HttpsError("failed-precondition","Claim unavailable.");
  if(e.get("applicantUid")&&e.get("applicantUid")!==r.auth.uid)throw new HttpsError("already-exists","Record belongs to another account.");
  tx.update(entry,{applicantUid:r.auth.uid,applicantEmail:r.auth.token.email.toLowerCase(),lastUpdatedAt:stamp()});
  tx.update(invite,{status:"completed",usedAt:stamp()});
 });
 await audit("nominee_claimed",s.get("entryId"),r.auth.uid);
 return {ok:true,entryId:s.get("entryId")};
});

exports.verifyScholar=onCall(opts,async r=>{
 const id=str(r.data?.publicId,50).toUpperCase();
 if(!/^BCN-\d{4}-[A-Z0-9]{8}$/.test(id))return {valid:false};
 const q=await db.collection("entries").where("publicId","==",id).limit(1).get();
 if(q.empty||q.docs[0].get("status")!=="selected")return {valid:false};
 const d=q.docs[0].data();
 return {valid:true,classYear:d.cycle,program:"Beacon Scholars • The Prayer Project",
   name:d.scholarAccepted===true&&d.publicityConsent===true?(d.recognitionName||d.studentName):null,
   privateRecord:d.publicityConsent!==true};
});
exports.addMilestone=onCall(opts,async r=>{
 requireAuth(r);
 const entryId=str(r.data?.entryId,140),entry=db.collection("entries").doc(entryId),snap=await entry.get();
 if(!snap.exists||snap.get("applicantUid")!==r.auth.uid||snap.get("status")!=="selected")
  throw new HttpsError("permission-denied","Scholar account required.");
 const title=str(r.data?.title,140),details=str(r.data?.details,800),date=str(r.data?.date,10);
 if(title.length<5||details.length<10||!/^\d{4}-\d{2}-\d{2}$/.test(date))err("Add a title, description and valid date.");
 const q=await entry.collection("milestones").limit(51).get();
 if(q.size>=50)throw new HttpsError("resource-exhausted","Milestone limit reached.");
 const m=await entry.collection("milestones").add({title,details,date,verified:false,createdAt:stamp(),creatorUid:r.auth.uid});
 await audit("scholar_milestone_created",entryId,r.auth.uid,{milestoneId:m.id});
 return {ok:true};
});
exports.verifyMilestone=onCall(opts,async r=>{
 owner(r);
 const entryId=str(r.data?.entryId,140),milestoneId=str(r.data?.milestoneId,140);
 const ref=db.collection("entries").doc(entryId).collection("milestones").doc(milestoneId),s=await ref.get();
 if(!s.exists)throw new HttpsError("not-found","Milestone not found.");
 await ref.update({verified:bool(r.data?.verified),verifiedBy:r.auth.uid,verifiedAt:stamp()});
 await audit("milestone_verified",entryId,r.auth.uid,{milestoneId});
 return {ok:true};
});
exports.withdrawApplication=onCall(opts,async r=>{
 requireAuth(r);
 const id=str(r.data?.entryId,140),ref=db.collection("entries").doc(id);
 await db.runTransaction(async tx=>{
  const s=await tx.get(ref);
  if(!s.exists||s.get("applicantUid")!==r.auth.uid)throw new HttpsError("permission-denied","Not your application.");
  if(entryClosed(s.get("status")))
   throw new HttpsError("failed-precondition","Contact Beacon to request a records or recognition review.");
  tx.update(ref,{status:"withdrawn",withdrawnAt:stamp(),lastUpdatedAt:stamp()});
  tx.create(db.collection("auditLogs").doc(),{action:"application_withdrawn",entryId:id,actorUid:r.auth.uid,at:stamp()});
 });
 return {ok:true};
});

exports.revokeGuardianConsent=onCall(opts,async r=>{
 owner(r);
 const entryId=str(r.data?.entryId,140),reason=str(r.data?.reason,600);
 if(reason.length<8)err("Provide a documented reason for guardian consent withdrawal.");
 const ref=db.collection("entries").doc(entryId);
 await db.runTransaction(async tx=>{
  const snap=await tx.get(ref);
  if(!snap.exists)throw new HttpsError("not-found","Entry not found.");
  if(snap.get("status")==="selected")throw new HttpsError("failed-precondition","Recognition was already finalized; initiate a formal privacy review instead.");
  tx.update(ref,{guardianStatus:"withdrawn",lastUpdatedAt:stamp(),
   "guardianRecord.verified":false,consentWithdrawal:{reason,recordedBy:r.auth.uid,at:new Date().toISOString()}});
  tx.create(db.collection("auditLogs").doc(),{action:"guardian_consent_withdrawn",entryId,actorUid:r.auth.uid,at:stamp(),reason});
 });
 return {ok:true};
});
exports.invalidateReference=onCall(opts,async r=>{
 owner(r);
 const entryId=str(r.data?.entryId,140),slot=Number(r.data?.slot),reason=str(r.data?.reason,600);
 if(![0,1].includes(slot)||reason.length<8)err("Choose reference 1 or 2 and explain the problem.");
 const ref=db.collection("entries").doc(entryId);
 const reference=ref.collection("references").doc(String(slot));
 const other=ref.collection("references").doc(String(1-slot));
 await db.runTransaction(async tx=>{
  const [snap,current,remaining]=await Promise.all([tx.get(ref),tx.get(reference),tx.get(other)]);
  if(!snap.exists)throw new HttpsError("not-found","Entry not found.");
  if(snap.get("status")==="selected")throw new HttpsError("failed-precondition","Recognition finalized; initiate formal review.");
  if(!current.exists)throw new HttpsError("not-found","Reference does not exist.");
  tx.update(reference,{verified:false,invalidReason:reason,invalidatedBy:r.auth.uid,invalidatedAt:stamp()});
  tx.update(ref,{referenceCount:remaining.get("verified")===true?1:0,referenceStatus:"pending",lastUpdatedAt:stamp()});
  tx.create(db.collection("auditLogs").doc(),{action:"reference_invalidated",entryId,actorUid:r.auth.uid,at:stamp(),slot,reason});
 });
 return {ok:true};
});

exports.mergeNomination=onCall(opts,async r=>{
 owner(r);
 const sourceId=str(r.data?.sourceEntryId,140),destId=str(r.data?.destinationEntryId,140);
 if(!sourceId||!destId||sourceId===destId)err("Select two different application IDs.");
 const sourceRef=db.collection("entries").doc(sourceId),destRef=db.collection("entries").doc(destId);
 const [s,d]=await Promise.all([sourceRef.get(),destRef.get()]);
 if(!s.exists||!d.exists)throw new HttpsError("not-found","Entry not found.");
 const source=s.data(),dest=d.data();
 if(source.type!=="nomination")throw new HttpsError("failed-precondition","Only nominations can become supporting endorsements.");
 if(source.duplicateKey!==dest.duplicateKey||source.cycle!==dest.cycle)
  throw new HttpsError("failed-precondition","These entries do not match on normalized student name, school, year and cycle.");
 if(["selected","not_selected","merged","withdrawn"].includes(source.status))
  throw new HttpsError("failed-precondition","Source nomination has already been finalized.");
 if(["selected","not_selected","merged","withdrawn"].includes(dest.status))
  throw new HttpsError("failed-precondition","Destination is not accepting more endorsements.");
 const endorsement=destRef.collection("endorsements").doc(sourceId);
 await db.runTransaction(async tx=>{
  const [currentSource,currentDestination,old]=await Promise.all([tx.get(sourceRef),tx.get(destRef),tx.get(endorsement)]);
  if(old.exists||currentSource.get("status")==="merged")throw new HttpsError("already-exists","Nomination already merged.");
  if(!currentSource.exists||!currentDestination.exists||entryClosed(currentSource.get("status"))||entryClosed(currentDestination.get("status")))
   throw new HttpsError("failed-precondition","Both entries must remain open to merge a nomination.");
  tx.create(endorsement,{
   sourceEntryId:sourceId,statement:source.personalStatement,
   privacy:source.privacy||"confidential",nominator:source.nominator||null,
   message:source.nominator?.message||"",mergedAt:stamp(),mergedBy:r.auth.uid
  });
  tx.update(destRef,{endorsementCount:admin.firestore.FieldValue.increment(1),lastUpdatedAt:stamp()});
  tx.update(sourceRef,{status:"merged",mergedInto:destId,mergedAt:stamp(),lastUpdatedAt:stamp()});
 });
 await audit("nomination_merged",sourceId,r.auth.uid,{destinationEntryId:destId});
 return {ok:true,destinationEntryId:destId};
});
