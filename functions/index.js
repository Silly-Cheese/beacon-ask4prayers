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
const isIntakeOpen=snapshot=>snapshot.get("intakeOpen")??(legacyIntake.value().trim().toLowerCase()==="true");
async function requireOpenIntake(tx){
 if(!isIntakeOpen(await tx.get(intakeRef)))
  throw new HttpsError("failed-precondition","Applications and nominations are currently closed.");
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
exports.getProgramSettings=onCall(opts,async()=>({
 cycle,intakeOpen:isIntakeOpen(await intakeRef.get()),honoraryOnly:true,brandedVerification:beaconMail.enabled()
}));
exports.setIntakeStatus=onCall(opts,async r=>{
 owner(r);
 const intakeOpen=r.data?.intakeOpen;
 if(typeof intakeOpen!=="boolean")err("Choose whether to open or close applications and nominations.");
 await db.runTransaction(async tx=>{
  const settings=await tx.get(intakeRef);
  if(settings.exists&&settings.get("intakeOpen")===intakeOpen)return;
  tx.set(intakeRef,{intakeOpen,updatedAt:stamp(),updatedBy:r.auth.uid},{merge:true});
  tx.create(db.collection("auditLogs").doc(),{
   action:"intake_status_changed",cycle,intakeOpen,actorUid:r.auth.uid,at:stamp()
  });
 });
 return {cycle,intakeOpen,honoraryOnly:true,brandedVerification:beaconMail.enabled()};
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
   ...safeSummary(d,doc.id),preferredName:d.preferredName||"",
   school:d.school,submittedAt:d.submittedAt?.toDate?.()?.toISOString?.()||null,
   guardianStatus:d.guardianStatus,referenceStatus:d.referenceStatus,
   selectedAt:d.selectedAt?.toDate?.()?.toISOString?.()||null,publicId:d.publicId||null,
   founderNote:d.founderNote||"",recognitionName:d.recognitionName||d.studentName,
   deliveryPreference:d.deliveryPreference||"digital",address:d.address||null,opportunities:true,
   nominationFollowUp:d.type==="nomination"?await nominationFollowUp(doc):null
 }};
});
exports.listReviewQueue=onCall(opts,async r=>{
 staff(r);
 const q=await db.collection("entries").orderBy("submittedAt","desc").limit(80).get();
 return {entries:q.docs.map(s=>safeSummary(s.data(),s.id)),
  intake:isAdmin(r)?{cycle,intakeOpen:isIntakeOpen(await intakeRef.get()),honoraryOnly:true}:null
 };
});
exports.getReviewEntry=onCall(opts,async r=>{
 staff(r);
 const id=str(r.data?.entryId,140),snap=await db.collection("entries").doc(id).get();
 if(!snap.exists)throw new HttpsError("not-found","Entry not found.");
 const d=snap.data();
 const refs=await db.collection("entries").doc(id).collection("references").get();
 const votes=await db.collection("entries").doc(id).collection("reviews").get();
 const endorsements=await db.collection("entries").doc(id).collection("endorsements").limit(20).get();
 const recusals=await db.collection("entries").doc(id).collection("recusals").get();
 if(recusals.docs.some(x=>x.id===r.auth.uid))throw new HttpsError("permission-denied","You have recused yourself from reviewing this entry.");
 return {entry:{
   ...safeSummary(d,id),canManage:isAdmin(r),school:d.school,graduationYear:d.graduationYear,gpa:d.gpa,
   personalStatement:d.personalStatement,activities:d.activities,academicInterests:d.academicInterests,
   service:d.service,futureGoals:d.futureGoals,responsibilities:d.responsibilities,
   honors:d.honors,additionalInfo:d.additionalInfo,guardianStatus:d.guardianStatus,
   referenceStatus:d.referenceStatus,referenceCount:d.referenceCount||0,
   referenceSuggestions:isAdmin(r)?d.references||[]:[],
   duplicateCount:(await db.collection("entries").where("duplicateKey","==",d.duplicateKey).limit(10).get()).size,
   nominator:isAdmin(r)&&d.privacy!=="anonymous"?d.nominator:null,
   duplicateKey:d.duplicateKey,verifiedEligibility:d.verifiedEligibility===true,
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
   reviewCount:votes.size,decisionMethod:isAdmin(r)?d.decisionMethod||null:null,approveVotes:votes.docs.filter(x=>x.get("recommend")==="select").length,
   myReview:votes.docs.find(x=>x.id===r.auth.uid)?.data()||null,
   recusalCount:recusals.size,
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
 if(!(await ref.get()).exists)throw new HttpsError("not-found","Entry not found.");
 await ref.collection("recusals").doc(r.auth.uid).set({reason,uid:r.auth.uid,at:stamp()});
 await ref.collection("reviews").doc(r.auth.uid).delete();
 await audit("reviewer_recused",id,r.auth.uid);
 return {ok:true};
});
exports.recordReview=onCall(opts,async r=>{
 staff(r);
 const id=str(r.data?.entryId,140),ref=db.collection("entries").doc(id);
 const snap=await ref.get();
 if(!snap.exists)throw new HttpsError("not-found","Entry not found.");
 if((await ref.collection("recusals").doc(r.auth.uid).get()).exists)throw new HttpsError("permission-denied","You are recused.");
 if(["selected","not_selected","merged","withdrawn"].includes(snap.get("status")))throw new HttpsError("failed-precondition","Entry is not open for review.");
 const scores=r.data?.scores||{},max={character:30,perseverance:25,service:20,leadership:15,potential:10},out={};
 for(const [k,m] of Object.entries(max)){const n=Number(scores[k]);if(!Number.isInteger(n)||n<0||n>m)err("Invalid score: "+k);out[k]=n;}
 const recommend=str(r.data?.recommend,20);
 if(!["select","decline","discuss"].includes(recommend))err("Select a recommendation.");
 const existingReviews=await ref.collection("reviews").get();
 if(existingReviews.size>=5&&!existingReviews.docs.some(x=>x.id===r.auth.uid))
  throw new HttpsError("failed-precondition","The committee already has five reviews.");
 await ref.collection("reviews").doc(r.auth.uid).set({
  uid:r.auth.uid,scores:out,total:Object.values(out).reduce((a,b)=>a+b,0),
  recommend,notes:str(r.data?.notes,2400),submittedAt:stamp()
 });
 await audit("committee_review",id,r.auth.uid);
 return {ok:true};
});
exports.setEligibility=onCall(opts,async r=>{
 owner(r);
 const id=str(r.data?.entryId,140),eligible=r.data?.eligible===true;
 const ref=db.collection("entries").doc(id),s=await ref.get();
 if(!s.exists)throw new HttpsError("not-found","Entry not found.");
 if(eligible&&(!Number.isFinite(s.get("gpa"))||s.get("gpa")<2.5))
   throw new HttpsError("failed-precondition","Verify an unweighted GPA of at least 2.5 before approving eligibility.");
 if(["selected","not_selected","merged","withdrawn"].includes(s.get("status")))throw new HttpsError("failed-precondition","Entry is no longer open for decisions.");
 await ref.update({verifiedEligibility:eligible,eligibilityNote:str(r.data?.notes,1000),status:eligible?"under_review":"screening",lastUpdatedAt:stamp()});
 await audit("eligibility_review",id,r.auth.uid,{eligible});
 return {ok:true};
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
 const entry=db.collection("entries").doc(id),s=await entry.get();
 if(!s.exists)throw new HttpsError("not-found","Entry not found.");
 if(kind==="reference"){
  if(![0,1].includes(slot))err("Invalid reference.");
  const doc=entry.collection("references").doc(String(slot)),rs=await doc.get();
  if(!rs.exists)throw new HttpsError("failed-precondition","Reference not submitted.");
  const other=await entry.collection("references").doc(String(1-slot)).get();
  if(other.get("verified")===true&&other.get("recipientEmail")===rs.get("recipientEmail"))
   throw new HttpsError("failed-precondition","The two verified references must come from different people.");
  await doc.update({verified:true,verifiedBy:r.auth.uid,verifiedAt:stamp()});
  const both=await entry.collection("references").get();
  const count=both.docs.filter(x=>x.id==="0"||x.id==="1").filter(x=>x.get("verified")===true||x.id===String(slot)).length;
  await entry.update({referenceCount:count,referenceStatus:count>=2?"verified":"pending"});
 }else{
  if(!s.get("guardianRecord")?.consent)throw new HttpsError("failed-precondition","Guardian has not signed.");
  await entry.update({"guardianRecord.verified":true,"guardianRecord.verifiedBy":r.auth.uid,guardianStatus:"verified"});
 }
 await audit("requirement_verified",id,r.auth.uid,{kind,slot});
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
  if(decision==="select"&&d.entryKeyHash&&!d.nominationFollowUp?.requestedAt)
   throw new HttpsError("failed-precondition","The nominee must connect their Entry Key and submit their follow-up details first.");
  if(!d.verifiedEligibility)throw new HttpsError("failed-precondition","Eligibility must be verified first.");
  if(decision==="select"&&(d.referenceCount||0)<2)throw new HttpsError("failed-precondition","Two verified references are required.");
  if(decision==="select"&&d.ageBand!=="adult"&&d.guardianStatus!=="verified")throw new HttpsError("failed-precondition","Guardian consent must be verified.");
  const [votes,recusal]=await Promise.all([
   tx.get(entry.collection("reviews")),tx.get(entry.collection("recusals").doc(r.auth.uid))
  ]);
  if(recusal.exists)throw new HttpsError("permission-denied","You recused yourself from this entry.");
  if(method==="founder"){
   if(votes.size>=3)throw new HttpsError("failed-precondition","Use the committee decision once three evaluations are on file.");
   const evaluation=votes.docs.find(vote=>vote.id===r.auth.uid);
   if(evaluation?.get("recommend")!==decision)
    throw new HttpsError("failed-precondition","Save your own evaluation with a recommendation that matches this decision.");
  }else{
   if(votes.size<3||votes.size>5)throw new HttpsError("failed-precondition","Committee decisions require 3–5 evaluations. With fewer than three, save your evaluation and use Founder review.");
   if(decision==="select"&&votes.docs.filter(vote=>vote.get("recommend")==="select").length<2)
    throw new HttpsError("failed-precondition","Selection needs at least two favorable recommendations.");
  }
  const selected=decision==="select",publicId=selected?"BCN-"+cycle+"-"+id.slice(0,8).toUpperCase():null;
  tx.update(entry,{status:selected?"selected":"not_selected",decision,decisionMethod:method,decidedBy:r.auth.uid,
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
 await ref.update(changes);
 if(refsChanged){
   const old=await ref.collection("references").get();
   await Promise.all(old.docs.map(x=>x.ref.delete()));
 }
 if(guardianChanged||refsChanged||applicantChanged){
  const oldInvites=await db.collection("invitations").where("entryId","==",id).limit(100).get();
  const revokes=oldInvites.docs.filter(x=>x.get("status")==="pending"&&(
   (guardianChanged&&x.get("kind")==="guardian")||
   (refsChanged&&x.get("kind")==="reference")||
   (applicantChanged&&x.get("kind")==="scholar")
  ));
  await Promise.all(revokes.map(x=>x.ref.update({status:"revoked",revokedAt:stamp()})));
 }
 await audit("admin_contact_update",id,r.auth.uid,{fields:Object.keys(changes).filter(k=>k!=="lastUpdatedAt")});
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
 const id=str(r.data?.entryId,140),ref=db.collection("entries").doc(id),s=await ref.get();
 if(!s.exists||s.get("applicantUid")!==r.auth.uid)throw new HttpsError("permission-denied","Not your application.");
 if(["selected","not_selected"].includes(s.get("status")))
  throw new HttpsError("failed-precondition","Contact Beacon to request a records or recognition review.");
 await ref.update({status:"withdrawn",withdrawnAt:stamp(),lastUpdatedAt:stamp()});
 await audit("application_withdrawn",id,r.auth.uid);
 return {ok:true};
});

exports.revokeGuardianConsent=onCall(opts,async r=>{
 owner(r);
 const entryId=str(r.data?.entryId,140),reason=str(r.data?.reason,600);
 if(reason.length<8)err("Provide a documented reason for guardian consent withdrawal.");
 const ref=db.collection("entries").doc(entryId),snap=await ref.get();
 if(!snap.exists)throw new HttpsError("not-found","Entry not found.");
 if(snap.get("status")==="selected")throw new HttpsError("failed-precondition","Recognition was already finalized; initiate a formal privacy review instead.");
 await ref.update({guardianStatus:"withdrawn",lastUpdatedAt:stamp(),
   "guardianRecord.verified":false,consentWithdrawal:{reason,recordedBy:r.auth.uid,at:new Date().toISOString()}});
 await audit("guardian_consent_withdrawn",entryId,r.auth.uid,{reason});
 return {ok:true};
});
exports.invalidateReference=onCall(opts,async r=>{
 owner(r);
 const entryId=str(r.data?.entryId,140),slot=Number(r.data?.slot),reason=str(r.data?.reason,600);
 if(![0,1].includes(slot)||reason.length<8)err("Choose reference 1 or 2 and explain the problem.");
 const ref=db.collection("entries").doc(entryId),snap=await ref.get();
 if(!snap.exists)throw new HttpsError("not-found","Entry not found.");
 if(snap.get("status")==="selected")throw new HttpsError("failed-precondition","Recognition finalized; initiate formal review.");
 const doc=ref.collection("references").doc(String(slot)),d=await doc.get();
 if(!d.exists)throw new HttpsError("not-found","Reference does not exist.");
 await doc.update({verified:false,invalidReason:reason,invalidatedBy:r.auth.uid,invalidatedAt:stamp()});
 const other=await ref.collection("references").get();
 const count=other.docs.filter(x=>x.id!==String(slot)&&x.get("verified")===true).length;
 await ref.update({referenceCount:count,referenceStatus:count>=2?"verified":"pending",lastUpdatedAt:stamp()});
 await audit("reference_invalidated",entryId,r.auth.uid,{slot,reason});
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
