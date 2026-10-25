"use strict";
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineString } = require("firebase-functions/params");
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();
// Intake stays CLOSED until consent, reference invitation and anti-abuse
// procedures are reviewed. Set BEACON_INTAKE_OPEN=true when actually ready.
const intakeOpen = defineString("BEACON_INTAKE_OPEN", { default: "false" });
const cors = ["https://beacon.ask4prayers.com","https://silly-cheese.github.io"];
const options = { region: "us-central1", cors, maxInstances: 10, memory: "256MiB" };
const text = (v,max=160) => typeof v==="string"?v.trim().slice(0,max):"";
function email(v) {
  const value=text(v,254);
  if (!value) return "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new HttpsError("invalid-argument","Please provide a valid email address.");
  return value.toLowerCase();
}
function authenticated(req) {
  if (!req.auth || !req.auth.uid) throw new HttpsError("unauthenticated","Sign in to submit an entry.");
}
function validateEntry(req) {
  const p=req.data||{},type=p.type;
  if (!["self","nomination"].includes(type)) throw new HttpsError("invalid-argument","Invalid entry type.");
  const studentName=text(p.studentName,120),school=text(p.school,160),grade=text(p.grade,3),year=Number(p.graduationYear),statement=text(p.statement,6000);
  if(studentName.length<3||school.length<2||!["9","10","11","12"].includes(grade)||!Number.isInteger(year)||year<2026||year>2040)
    throw new HttpsError("invalid-argument","Complete the student's name, school, grade and graduation year.");
  if(statement.length<180) throw new HttpsError("invalid-argument","Please provide a more complete personal statement or nomination.");
  const privacy=type==="self"?"self":text(p.privacy,20);
  if(type==="nomination"&&!["named","confidential","anonymous"].includes(privacy))
    throw new HttpsError("invalid-argument","Select a nomination privacy option.");
  const nominatorName=privacy==="anonymous"?"":text(p.nominatorName,120);
  const nominatorEmail=privacy==="anonymous"?"":email(p.nominatorEmail);
  if(type==="nomination"&&privacy!=="anonymous"&&(nominatorName.length<3||!nominatorEmail))
    throw new HttpsError("invalid-argument","Please provide nominator name and email, or select fully anonymous.");
  if(type==="self"&&(req.auth.token.firebase?.sign_in_provider==="anonymous"||!req.auth.token.email_verified))
    throw new HttpsError("failed-precondition","Verify your student account email before submitting.");
  const refs=(Array.isArray(p.references)?p.references:[]).slice(0,2).map((r)=>({
    name:text(r?.name,120),email:email(r?.email)
  }));
  while(refs.length<2) refs.push({name:"",email:""});
  if(refs.some(r=>(r.name&&!r.email)||(!r.name&&r.email)))
    throw new HttpsError("invalid-argument","Provide both name and email for any listed reference.");
  return {
    type,studentName,school,grade,graduationYear:year,statement,
    privacy,nominatorName,nominatorEmail,relationship:text(p.relationship,120),
    message:text(p.message,1500),studentContact:email(p.studentContact),
    guardianEmail:email(p.guardianEmail),minor:!!p.minor,references:refs,
    cycle:year===2026?2026:2027 // Initial recognition cycle; managed cycles come later.
  };
}
exports.submitEntry=onCall(options,async(req)=>{
  if (intakeOpen.value()!=="true") throw new HttpsError("failed-precondition","Applications are not open yet.");
  authenticated(req);
  // IMPORTANT: No open public intake without Firebase App Check enforcement.
  // An anonymous Firebase Auth identity is not sufficient anti-abuse protection.
  if(!req.app) throw new HttpsError("failed-precondition","App verification is required.");
  const p=validateEntry(req);
  const uid=req.auth.uid;
  const day=new Date().toISOString().slice(0,10);
  const quota=db.collection("submissionQuotas").doc(uid+"_"+day);
  const entry=db.collection("entries").doc();
  const selfKey=db.collection("selfSubmissionKeys").doc(p.cycle+"_"+uid);
  await db.runTransaction(async(tx)=>{
    const reads=[tx.get(quota)];
    if(p.type==="self")reads.push(tx.get(selfKey));
    const results=await Promise.all(reads);
    const existing=Number(results[0].data()?.count||0);
    if(existing>=3)throw new HttpsError("resource-exhausted","Daily submission limit reached.");
    if(p.type==="self"&&results[1].exists)throw new HttpsError("already-exists","You already submitted an application for this cycle.");
    tx.set(quota,{count:existing+1,lastAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
    if(p.type==="self")tx.create(selfKey,{entryId:entry.id,createdAt:admin.firestore.FieldValue.serverTimestamp()});
    tx.create(entry,{
      ...p,entryId:entry.id,submitterUid:p.privacy==="anonymous"?null:uid,
      applicantUid:p.type==="self"?uid:null,
      submittedAt:admin.firestore.FieldValue.serverTimestamp(),
      status:"submitted",selectionReady:false,guardianConsentStatus:"not_verified",
      referencesStatus:"not_verified",reviewDecision:null,
      // Nominator contact details are confidential and must not appear in public outputs.
      lastUpdatedAt:admin.firestore.FieldValue.serverTimestamp()
    });
  });
  return {entryId:entry.id,received:true};
});
exports.getMyEntries=onCall(options,async(req)=>{
  authenticated(req);
  if(req.auth.token.firebase?.sign_in_provider==="anonymous")
    throw new HttpsError("permission-denied","Use a verified student account.");
  const snapshot=await db.collection("entries").where("applicantUid","==",req.auth.uid).limit(30).get();
  return {entries:snapshot.docs.map(d=>({
    entryId:d.id,studentName:d.get("studentName"),cycle:d.get("cycle"),status:d.get("status")
  }))};
});
exports.listReviewQueue=onCall(options,async(req)=>{
  authenticated(req);
  if(req.auth.token.admin!==true&&req.auth.token.reviewer!==true)
    throw new HttpsError("permission-denied","Reviewer access is required.");
  const snapshot=await db.collection("entries").orderBy("submittedAt","desc").limit(50).get();
  return {entries:snapshot.docs.map(d=>({
    entryId:d.id,studentName:d.get("studentName"),type:d.get("type"),
    grade:d.get("grade"),status:d.get("status"),cycle:d.get("cycle")
  }))};
});