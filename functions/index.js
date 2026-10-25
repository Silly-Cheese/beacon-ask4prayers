"use strict";
const {onCall,HttpsError}=require("firebase-functions/v2/https");
const {defineString}=require("firebase-functions/params");
const admin=require("firebase-admin");
const crypto=require("node:crypto");
admin.initializeApp();
const db=admin.firestore();
const open=defineString("BEACON_INTAKE_OPEN",{default:"false"});
const mailEnabled=defineString("BEACON_EMAIL_ENABLED",{default:"false"});
const cycle="2027";
const origin="https://beacon.ask4prayers.com";
const opts={region:"us-central1",cors:[origin,"https://silly-cheese.github.io"],maxInstances:10,memory:"256MiB",enforceAppCheck:true};
const stamp=()=>admin.firestore.FieldValue.serverTimestamp();
const clean=(v,n=180)=>typeof v==="string"?v.trim().slice(0,n):"";
const mail=v=>{const s=clean(v,254).toLowerCase();if(s&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))throw new HttpsError("invalid-argument","Invalid email address.");return s;};
const err=(m)=>{throw new HttpsError("invalid-argument",m);};
const requireAuth=r=>{if(!r.auth?.uid||r.auth.token.firebase?.sign_in_provider==="anonymous")throw new HttpsError("unauthenticated","Sign in with your Beacon account first.");};
const staff=r=>{requireAuth(r);if(!(r.auth.token.admin===true||r.auth.token.reviewer===true))throw new HttpsError("permission-denied","Committee access required.");};
const owner=r=>{requireAuth(r);if(r.auth.token.admin!==true)throw new HttpsError("permission-denied","Administrator access required.");};
const isAdmin=r=>r.auth?.token?.admin===true;
const gate=()=>{if(open.value()!=="true")throw new HttpsError("failed-precondition","Public intake is not open yet.");};
const hash=v=>crypto.createHash("sha256").update(v).digest("hex");
const SECRET=(v)=>crypto.randomBytes(32).toString("base64url");
const str=(v,max=180)=>clean(v,max);
const y=v=>{const n=Number(v);return Number.isInteger(n)&&n>=2026&&n<=2040?n:null;};
const bool=v=>v===true;
const dedupe=o=>hash([o.studentName,o.school,o.graduationYear].map(x=>String(x).toLowerCase().trim().replace(/\s+/g,"")).join("|"));
function references(v) {
 if(!Array.isArray(v))return [];
 return v.slice(0,2).map(x=>({name:str(x?.name,120),email:mail(x?.email),relationship:str(x?.relationship,100)}))
  .filter(x=>x.name||x.email);
}
function normalize(v) {
 const d=v&&typeof v==="object"?v:{};
 const o={
 studentName:str(d.studentName,120),preferredName:str(d.preferredName,100),
 school:str(d.school,160),grade:str(d.grade,4),graduationYear:y(d.graduationYear),
 state:str(d.state,80),educationType:str(d.educationType,40),
 applicantEmail:mail(d.applicantEmail),ageBand:str(d.ageBand,20),
 gpa:d.gpa===""||d.gpa==null?null:Number(d.gpa),
 academicInterests:str(d.academicInterests,1800),futureGoals:str(d.futureGoals,1800),
 activities:str(d.activities,2400),service:str(d.service,2400),responsibilities:str(d.responsibilities,2400),
 honors:str(d.honors,1600),personalStatement:str(d.personalStatement,6000),
 additionalInfo:str(d.additionalInfo,2000),guardianName:str(d.guardianName,120),
 guardianEmail:mail(d.guardianEmail),guardianRelationship:str(d.guardianRelationship,100),
 references:references(d.references)
 };
 if(o.gpa!==null&&(!Number.isFinite(o.gpa)||o.gpa<0||o.gpa>4))err("GPA must be between 0 and 4.0 (unweighted).");
 return o;
}
function validateFinal(d){
 if(d.studentName.length<3||d.school.length<2||!["9","10","11","12"].includes(d.grade)||!d.graduationYear)err("Complete your name, school, grade and graduation year.");
 if(d.personalStatement.length<180)err("Please complete the personal essay.");
 if(d.ageBand!=="adult"&&d.ageBand!=="minor")err("Please indicate whether you are under 18.");
 if(d.ageBand==="minor"&&!d.guardianEmail)err("Provide a guardian email so consent can be requested.");
 if(d.references.length!==2||d.references.some(x=>!x.name||!x.email)||d.references[0].email===d.references[1].email)err("Provide two different references with names and email addresses.");
 // GPA is documented at eligibility screening; nominations may lack access to grades.
}
const safeSummary=(d,id)=>({entryId:id,studentName:d.studentName||"",type:d.type||"self",cycle:d.cycle||cycle,status:d.status||"draft",grade:d.grade||"",referenceStatus:d.referenceStatus||"pending",guardianStatus:d.guardianStatus||"pending",createdAt:d.createdAt?.toDate?.()?.toISOString?.()||null});
async function audit(action,entryId,uid,extra={}){await db.collection("auditLogs").add({action,entryId,actorUid:uid||null,at:stamp(),...extra});}
exports.getProgramSettings=onCall({...opts,enforceAppCheck:false},async()=>({cycle,intakeOpen:open.value()==="true",honoraryOnly:true}));
exports.getDraft=onCall(opts,async r=>{
 requireAuth(r);
 const snap=await db.collection("drafts").doc(r.auth.uid+"_"+cycle).get();
 return {draft:snap.exists?snap.data().fields:null,updatedAt:snap.data()?.updatedAt?.toDate?.()?.toISOString?.()||null};
});
exports.saveDraft=onCall(opts,async r=>{
 requireAuth(r);gate();
 const fields=normalize(r.data?.fields);
 await db.collection("drafts").doc(r.auth.uid+"_"+cycle).set({uid:r.auth.uid,cycle,fields,updatedAt:stamp()},{merge:true});
 return {saved:true};
});
exports.submitEntry=onCall(opts,async r=>{
 gate();
 const type=str(r.data?.type,24);
 if(type==="nomination"&&!bool(r.data?.declaration))err("A nomination authenticity declaration is required.");
 if(type==="self"){
  requireAuth(r);
  if(r.auth.token.email_verified!==true)throw new HttpsError("failed-precondition","Verify your account email before final submission.");
  if(!bool(r.data?.declarations?.truthful)||!bool(r.data?.declarations?.requirements))
   throw new HttpsError("failed-precondition","Both application declarations must be acknowledged.");
  const draft=await db.collection("drafts").doc(r.auth.uid+"_"+cycle).get();
  if(!draft.exists)err("Save your application first.");
  const d=draft.data().fields;validateFinal(d);
  const key=db.collection("selfSubmissionKeys").doc(cycle+"_"+r.auth.uid);
  const entry=db.collection("entries").doc();
  await db.runTransaction(async tx=>{
    const prior=await tx.get(key);
    if(prior.exists)throw new HttpsError("already-exists","You have already submitted an entry this cycle.");
    tx.create(key,{entryId:entry.id,createdAt:stamp()});
    tx.create(entry,{
      ...d,applicantEmail:r.auth.token.email?.toLowerCase()||"",type:"self",entryId:entry.id,cycle,status:"submitted",applicantUid:r.auth.uid,
      submitterUid:r.auth.uid,submittedAt:stamp(),createdAt:stamp(),lastUpdatedAt:stamp(),
      publicId:null,studentDeclaration:{truthful:true,requirements:true,recordedAt:new Date().toISOString(),version:"2027-v1"},guardianStatus:d.ageBand==="adult"?"not_required":"pending",
      referenceStatus:"pending",referenceCount:0,selectionReady:false,decision:null,
      duplicateKey:dedupe(d)
    });
  });
  await audit("self_submitted",entry.id,r.auth.uid);
  return {received:true,entryId:entry.id};
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
 const doc=db.collection("entries").doc();
 const day=new Date().toISOString().slice(0,10);
 // per UID quota is intentionally conservative; App Check is also mandatory.
 const quota=db.collection("submissionQuotas").doc(hash(r.auth.uid+day));
 await db.runTransaction(async tx=>{
  const q=await tx.get(quota),n=Number(q.data()?.count||0);
  if(n>=2)throw new HttpsError("resource-exhausted","Daily nomination limit reached.");
  tx.set(quota,{count:n+1,updatedAt:stamp()},{merge:true});
  tx.create(doc,{
   ...d,personalStatement:d.personalStatement,type:"nomination",privacy,nominator,
   cycle,status:"submitted",entryId:doc.id,
   submitterUid:privacy==="anonymous"?null:r.auth.uid,applicantUid:null,
   submittedAt:stamp(),createdAt:stamp(),lastUpdatedAt:stamp(),publicId:null,
   nominatorDeclaration:{truthful:true,recordedAt:new Date().toISOString(),version:"2027-v1"},
   guardianStatus:"pending",referenceStatus:"pending",referenceCount:0,selectionReady:false,
   decision:null,duplicateKey:dedupe(d)
  });
 });
 await audit("nomination_submitted",doc.id,privacy==="anonymous"?null:r.auth.uid,{privacy});
 return {received:true,entryId:doc.id};
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
   deliveryPreference:d.deliveryPreference||"digital",address:d.address||null,opportunities:true
 }};
});
exports.listReviewQueue=onCall(opts,async r=>{
 staff(r);
 const q=await db.collection("entries").orderBy("submittedAt","desc").limit(80).get();
 return {entries:q.docs.map(s=>safeSummary(s.data(),s.id))};
});
exports.getReviewEntry=onCall(opts,async r=>{
 staff(r);
 const id=str(r.data?.entryId,140),snap=await db.collection("entries").doc(id).get();
 if(!snap.exists)throw new HttpsError("not-found","Entry not found.");
 const d=snap.data();
 const refs=await db.collection("entries").doc(id).collection("references").get();
 const votes=await db.collection("entries").doc(id).collection("reviews").get();
 const recusals=await db.collection("entries").doc(id).collection("recusals").get();
 if(recusals.docs.some(x=>x.id===r.auth.uid))throw new HttpsError("permission-denied","You have recused yourself from reviewing this entry.");
 return {entry:{
   ...safeSummary(d,id),school:d.school,graduationYear:d.graduationYear,gpa:d.gpa,
   personalStatement:d.personalStatement,activities:d.activities,academicInterests:d.academicInterests,
   service:d.service,futureGoals:d.futureGoals,responsibilities:d.responsibilities,
   honors:d.honors,additionalInfo:d.additionalInfo,guardianStatus:d.guardianStatus,
   referenceStatus:d.referenceStatus,referenceCount:d.referenceCount||0,
   referenceSuggestions:d.references||[],
   duplicateCount:(await db.collection("entries").where("duplicateKey","==",d.duplicateKey).limit(10).get()).size,
   nominator:isAdmin(r)&&d.privacy!=="anonymous"?d.nominator:null,
   duplicateKey:d.duplicateKey,verifiedEligibility:d.verifiedEligibility===true,
   references:refs.docs.map(x=>({id:x.id,...x.data()})),
   applicantEmail:isAdmin(r)?d.applicantEmail||"":null,
   guardianEmail:isAdmin(r)?d.guardianEmail||"":null,
   ageBand:d.ageBand||"unknown",
   verifiedEligibility:d.verifiedEligibility===true,
   reviewCount:votes.size,approveVotes:votes.docs.filter(x=>x.get("recommend")==="select").length,
   myReview:votes.docs.find(x=>x.id===r.auth.uid)?.data()||null,
   recusalCount:recusals.size,
   founderNote:isAdmin(r)?d.founderNote||"":""
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
 if(snap.get("status")==="selected"||snap.get("status")==="not_selected")throw new HttpsError("failed-precondition","The decision is finalized.");
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
 if(["selected","not_selected"].includes(s.get("status")))throw new HttpsError("failed-precondition","Final decision is locked.");
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
 if(kind!=="scholar"&&["selected","not_selected"].includes(d.status))throw new HttpsError("failed-precondition","Decision already finalized.");
 const recipient=kind==="guardian"?{name:d.guardianName||"Guardian",email:d.guardianEmail}:
  kind==="scholar"?{name:d.studentName,email:d.applicantEmail}:{...(d.references||[])[slot]};
 if(!recipient?.email)throw new HttpsError("failed-precondition","This entry is missing the recipient email. Ask applicant to correct it.");
 const token=SECRET(),invite=db.collection("invitations").doc(hash(token)),expires=Date.now()+14*86400000;
 await invite.set({entryId,kind,slot:kind==="reference"?slot:null,recipientName:recipient.name||"",recipientEmail:recipient.email,status:"pending",createdBy:r.auth.uid,createdAt:stamp(),expiresAt:admin.firestore.Timestamp.fromMillis(expires),usedAt:null});
 await audit("invitation_created",entryId,r.auth.uid,{kind,slot});
 const url=origin+"/#"+(kind==="guardian"?"consent/":kind==="scholar"?"claim/":"reference/")+token;
 let queued=false;
 if(mailEnabled.value()==="true"){
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
 return {url,recipientEmail:recipient.email,expiresAt:new Date(expires).toISOString(),queued};
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
   const [fresh,entry]=await Promise.all([tx.get(ref),tx.get(entryRef)]);
   if(fresh.get("status")!=="pending"||!entry.exists)throw new HttpsError("failed-precondition","Invitation unavailable.");
   tx.set(target,{fullName,signature,answers,recipientEmail:i.recipientEmail,slot:i.slot,submittedAt:stamp(),verified:false});
   tx.update(ref,{status:"completed",usedAt:stamp()});
   tx.update(entryRef,{referenceStatus:"awaiting_verification",lastUpdatedAt:stamp()});
  });
 }else if(i.kind==="guardian"){
  if(type!=="guardian")err("Invalid response type.");
  if(!bool(response.consent)||!bool(response.isGuardian))err("Consent and guardian authority are both required.");
  await db.runTransaction(async tx=>{
   const [fresh,entry]=await Promise.all([tx.get(ref),tx.get(entryRef)]);
   if(fresh.get("status")!=="pending"||!entry.exists)throw new HttpsError("failed-precondition","Invitation unavailable.");
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
 if(!["select","decline"].includes(decision))err("Invalid decision.");
 const entry=db.collection("entries").doc(id),snap=await entry.get();
 if(!snap.exists)throw new HttpsError("not-found","Entry not found.");
 const d=snap.data();
 if(["selected","not_selected"].includes(d.status))throw new HttpsError("failed-precondition","Decision already finalized.");
 if(!d.verifiedEligibility)throw new HttpsError("failed-precondition","Eligibility must be verified first.");
 const votes=await entry.collection("reviews").get();
 if(votes.size<3||votes.size>5)throw new HttpsError("failed-precondition","Require 3–5 independent committee reviews.");
 if(decision==="select"&&votes.docs.filter(x=>x.get("recommend")==="select").length<2)throw new HttpsError("failed-precondition","Selection needs at least two favorable recommendations.");
 if(decision==="select"&&(d.referenceCount||0)<2)throw new HttpsError("failed-precondition","Two verified references are required.");
 if(decision==="select"&&d.ageBand!=="adult"&&d.guardianStatus!=="verified")throw new HttpsError("failed-precondition","Guardian consent must be verified.");
 const publicId="BCN-"+cycle+"-"+id.slice(0,8).toUpperCase();
 await entry.update({status:decision==="select"?"selected":"not_selected",decision,selectedAt:decision==="select"?stamp():null,
  publicId:decision==="select"?publicId:null,founderNote:decision==="select"?note:"",lastUpdatedAt:stamp()});
 await audit("decision_finalized",id,r.auth.uid,{decision});
 if(mailEnabled.value()==="true"&&d.applicantEmail){
  await db.collection("mail").add({to:[d.applicantEmail],createdAt:stamp(),message:{
   subject:decision==="select"?"Beacon Scholars: Recognition Decision":"Beacon Scholars: Application Decision",
   text:decision==="select"?
     "Congratulations. You have been selected as a Beacon Scholar. Sign in at "+origin+" to review your recognition. Recognition is honorary, with no financial award promised.":
     "Thank you for your Beacon Scholars submission. Following committee review, your entry was not selected this cycle. We appreciate your story and your willingness to be considered."
  }});
 }
 return {ok:true,publicId:decision==="select"?publicId:null};
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
 if(["selected","not_selected"].includes(snap.get("status")))throw new HttpsError("failed-precondition","Entry finalized.");
 const fields=r.data?.fields||{},changes={lastUpdatedAt:stamp()};
 if("guardianEmail" in fields)changes.guardianEmail=mail(fields.guardianEmail);
 if("guardianName" in fields)changes.guardianName=str(fields.guardianName,120);
 if("applicantEmail" in fields)changes.applicantEmail=mail(fields.applicantEmail);
 if("ageBand" in fields){if(!["minor","adult"].includes(fields.ageBand))err("Invalid age band.");changes.ageBand=fields.ageBand;}
 if("gpa" in fields){const n=fields.gpa===""?null:Number(fields.gpa);if(n!==null&&(!Number.isFinite(n)||n<0||n>4))err("GPA outside valid range.");changes.gpa=n;}
 if("references" in fields)changes.references=references(fields.references);
 await ref.update(changes);
 await audit("admin_contact_update",id,r.auth.uid,{fields:Object.keys(changes).filter(k=>k!=="lastUpdatedAt")});
 return {ok:true};
});
exports.useVerifiedNominatorReference=onCall(opts,async r=>{
 owner(r);
 const entryId=str(r.data?.entryId,140),entry=db.collection("entries").doc(entryId),doc=await entry.get();
 if(!doc.exists)throw new HttpsError("not-found","Entry unavailable.");
 const d=doc.data();
 if(d.type!=="nomination"||d.privacy==="anonymous"||!d.nominator?.email)throw new HttpsError("failed-precondition","No identified nominator for this entry.");
 const slot=Number(r.data?.slot);
 if(![0,1].includes(slot))err("Choose reference slot 1 or 2.");
 if(!bool(r.data?.identityVerified))err("Verify nominator identity independently first.");
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
exports.claimNomination=onCall(opts,async r=>{
 requireAuth(r);
 if(!r.auth.token.email_verified)throw new HttpsError("failed-precondition","Verify your account email first.");
 const token=str(r.data?.token,150),invite=db.collection("invitations").doc(hash(token)),s=await invite.get();
 if(!s.exists||s.get("kind")!=="scholar"||s.get("status")!=="pending"||s.get("expiresAt").toMillis()<Date.now())
  throw new HttpsError("not-found","Claim invitation invalid or expired.");
 if(s.get("recipientEmail")!==r.auth.token.email?.toLowerCase())
  throw new HttpsError("permission-denied","Sign in using the email address invited by Beacon.");
 const entry=db.collection("entries").doc(s.get("entryId"));
 await db.runTransaction(async tx=>{
  const [fresh,e]=await Promise.all([tx.get(invite),tx.get(entry)]);
  if(fresh.get("status")!=="pending"||!e.exists)throw new HttpsError("failed-precondition","Claim unavailable.");
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
