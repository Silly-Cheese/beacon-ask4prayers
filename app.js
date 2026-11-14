import {auth,callable} from "./beacon-firebase.js";
import {
  onAuthStateChanged,signInWithEmailAndPassword,createUserWithEmailAndPassword,
  signInAnonymously,signOut,sendEmailVerification,sendPasswordResetEmail,reload
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
const $=id=>document.getElementById(id),qs=(s,root=document)=>root.querySelector(s),qsa=(s,root=document)=>[...root.querySelectorAll(s)];
const call=async(name,data={})=>(await callable(name)(data)).data;
const PAGE={home:"public-view",mission:"public-view",selection:"public-view",opportunities:"public-view",faq:"public-view",apply:"apply-view",nominate:"nominate-view",account:"account-view",dashboard:"dashboard-view",scholar:"scholar-view",committee:"committee-view",policy:"policy-view",reference:"reference-view",consent:"consent-view",claim:"claim-view",verify:"verify-view"};
let currentUser=null,settings={cycle:"2027",intakeOpen:false},intakeState="loading",step=0;
let draftLoadedFor=null,draftLoading=null,saveTimer=null,savingPromise=null,inviteToken=null,activeScholarId=null;
let studentBusy=false,nominationBusy=false,nominationRequestId=null,submittedApplication=null,accountReturn="dashboard";
const stepNames=["About you","Your story","References and guardian","Review and submit"];
const finalStep=stepNames.length-1;
const timestamp=s=>s?new Date(s).toLocaleDateString():"";
const escaped=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let toastTimeout;
function notify(msg){
  const el=$("notice");el.hidden=false;el.textContent=msg;
  clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>el.hidden=true,9000);
}
function readable(e){
  const c=String(e?.code||"");
  if(c.includes("failed-precondition"))return e.message||"A required verification step is incomplete.";
  if(c.includes("permission-denied"))return "This action requires additional authorization.";
  if(c.includes("unauthenticated"))return "Sign in with your Beacon account first.";
  if(c.includes("unavailable"))return "The secure service is currently unavailable. Please try again.";
  return e?.message||"An unexpected error occurred.";
}
function el(tag,txt,klass){
  const n=document.createElement(tag);if(txt!==undefined)n.textContent=txt;
  if(klass)n.className=klass;return n;
}
function whenOpen(){
 if(intakeState!=="open")throw Error("Intake is currently unavailable. Check the program status before trying again.");
}
function accountNeeded(){return !!currentUser&&!currentUser.isAnonymous;}
function route(){
 const [key,...parts]=(location.hash.slice(1)||"home").split("/");
 const page=Object.hasOwn(PAGE,key)?key:"home";
 if(page==="account"){
  const target=parts.join("/");
  accountReturn=/^(apply|nominate|dashboard)$|^claim\/[A-Za-z0-9_-]{43}$/.test(target)?target:"dashboard";
  const link=$("account-continue");
  link.href="#"+accountReturn;
  link.textContent=accountReturn==="apply"?"Continue to your application →":accountReturn==="nominate"?"Return to your nomination →":accountReturn.startsWith("claim/")?"Return to your invitation →":accountReturn==="committee"?"Open Committee →":"Open dashboard →";
 }
 inviteToken=(page==="reference"||page==="consent"||page==="claim")?parts.join("/"):null;
 Object.values(PAGE).forEach(id=>{const node=$(id);if(node)node.hidden=true;});
 $(PAGE[page]).hidden=false;
 $("main-nav").classList.remove("open");$("menu-toggle").setAttribute("aria-expanded","false");
 qsa("#main-nav a").forEach(a=>a.removeAttribute("aria-current"));
 qsa('#main-nav a[href="#'+page+'"]').forEach(a=>a.setAttribute("aria-current","page"));
 if(["mission","selection","opportunities","faq"].includes(page))requestAnimationFrame(()=>$(page).scrollIntoView({behavior:"smooth",block:"start"}));
 else window.scrollTo({top:0,behavior:"instant"});
 if(page==="apply")prepareApplication();
 if(page==="dashboard")showDashboard();
 if(page==="committee")showCommittee();
 if(page==="scholar")showScholar();
 if(page==="reference"||page==="consent")loadInvitation(page);
 if(page==="claim"){
  $("claim-account-link").href="#account/claim/"+encodeURIComponent(inviteToken||"");
  loadClaim();
 }
 if(page==="verify"&&parts.length){const input=qs('input[name="publicId"]',$("verify-form"));input.value=parts[0];checkScholarId(parts[0]);}
}
$("menu-toggle").addEventListener("click",()=>{
 const open=$("main-nav").classList.toggle("open");$("menu-toggle").setAttribute("aria-expanded",String(open));
});
$("year").textContent=String(new Date().getFullYear());
window.addEventListener("hashchange",route);
function refreshGates(){
 const signed=accountNeeded();
 $("account-guest").hidden=signed;
 $("account-signed-in").hidden=!signed;
 $("account-link").textContent=signed?"My Account":"Sign in";
 const open=intakeState==="open";
 $("student-auth-gate").hidden=signed||!open;
 $("student-wizard").hidden=!signed||!open||!!submittedApplication;
 $("student-intake-gate").hidden=open&&(!signed||!!submittedApplication||draftLoadedFor===currentUser.uid);
 $("nomination-intake-gate").hidden=open;
 $("nomination-layout").hidden=!open||!$("nomination-receipt").hidden;
 const status={
  loading:"Checking availability…",
  unavailable:"We couldn’t check availability. Please reload this page to try again.",
  closed:"are currently closed."
 };
 const publicStatus=$("public-intake-status");
 publicStatus.dataset.state=intakeState;
 publicStatus.textContent=open?"Class of "+settings.cycle+" • Applications and nominations are open."
  :intakeState==="closed"?"Applications and nominations "+status.closed:status[intakeState];
 $("student-intake-gate").textContent=open?"Loading your application…"
  :intakeState==="closed"?"Student applications "+status.closed:status[intakeState];
 $("nomination-intake-gate").textContent=intakeState==="closed"?"Nominations "+status.closed:status[intakeState];
 $("account-email").textContent=signed?currentUser.email:"";
 $("account-verification").textContent=signed?(currentUser.emailVerified?"Email verified":"Check your email and verify it before submitting your final application."):"";
 $("verify-email").hidden=!signed||currentUser.emailVerified;
 $("nom-submit").disabled=!open||nominationBusy;
 $("student-submit").disabled=!open||studentBusy;
 $("student-next").disabled=!open||!signed||draftLoadedFor!==currentUser.uid||studentBusy;
 qsa(".wizard-step",student).forEach(panel=>{
  panel.disabled=!open||!signed||draftLoadedFor!==currentUser.uid;
  panel.inert=studentBusy;
 });
 $("student-prev").disabled=studentBusy;
 nominationPrivacy();
}
onAuthStateChanged(auth,async u=>{
 const previousUid=currentUser?.isAnonymous?null:currentUser?.uid;
 const nextUid=u?.isAnonymous?null:u?.uid;
 if(previousUid!==nextUid){
  clearTimeout(saveTimer);draftLoadedFor=null;draftLoading=null;submittedApplication=null;step=0;
  student.reset();$("student-receipt").hidden=true;$("student-receipt").replaceChildren();
  formError("student");countEssay();toggleGuardian();updateStep();
 }
 currentUser=u;
 refreshGates();
 if(location.hash==="#apply")await prepareApplication();
 if(location.hash==="#dashboard")showDashboard();
 if(location.hash==="#committee")showCommittee();
 if(location.hash==="#scholar")showScholar();
});
function updateIntakeStatus(program){
 settings=program;
 intakeState=typeof program?.intakeOpen!=="boolean"?"unavailable":program.intakeOpen?"open":"closed";
 refreshGates();
}
function formError(kind,message=""){
 const error=$(kind+"-form-error");
 error.textContent=message;
 error.hidden=!message;
}
async function intakeError(kind,error){
 formError(kind,readable(error));
 if(error?.code==="functions/failed-precondition"&&error.message==="Applications and nominations are currently closed."){
  try{updateIntakeStatus(await call("getProgramSettings"));}catch{}
 }
}
async function init(){
 route();
 try{
  updateIntakeStatus(await call("getProgramSettings"));
 }catch{
  intakeState="unavailable";
 }
 refreshGates();
 if(location.hash==="#apply")await prepareApplication();
 if(location.hash==="#dashboard"&&accountNeeded())showDashboard();
}
$("auth-form").addEventListener("submit",async e=>{
 e.preventDefault();const d=new FormData(e.currentTarget);
 try{await signInWithEmailAndPassword(auth,String(d.get("email")).trim(),String(d.get("password")));notify("Signed in to Beacon.");location.hash="#"+accountReturn;}
 catch(err){notify(readable(err));}
});
$("create-account").addEventListener("click",async()=>{
 const form=$("auth-form");if(!form.reportValidity())return;
 const d=new FormData(form);
 try{
  const cred=await createUserWithEmailAndPassword(auth,String(d.get("email")).trim(),String(d.get("password")));
  try{
   await sendEmailVerification(cred.user);
   notify("Account created. Check your inbox to verify your email before submitting.");
  }catch(e){notify("Account created. Use the button on your account page to resend the verification email.");}
  location.hash="#"+accountReturn;
 }catch(e){notify(readable(e));}
});
$("sign-out").addEventListener("click",async()=>{await signOut(auth);draftLoadedFor=null;notify("Signed out.");location.hash="#home";});
$("verify-email").addEventListener("click",async()=>{try{await sendEmailVerification(auth.currentUser);notify("Verification email sent.");}catch(e){notify(readable(e));}});
$("reset-password").addEventListener("click",async()=>{
 const email=String(new FormData($("auth-form")).get("email")||"").trim();
 if(!email){notify("Enter your account email first.");return;}
 try{await sendPasswordResetEmail(auth,email);notify("If an account exists, you'll receive a reset email.");}catch(e){notify(readable(e));}
});

const student=$("student-form");
const studentFields=()=>({
 ...Object.fromEntries(new FormData(student).entries()),
 references:[{name:qs('[name="ref1Name"]',student).value,email:qs('[name="ref1Email"]',student).value,relationship:qs('[name="ref1Relationship"]',student).value},
 {name:qs('[name="ref2Name"]',student).value,email:qs('[name="ref2Email"]',student).value,relationship:qs('[name="ref2Relationship"]',student).value}]
});
function fillStudent(d){
 if(!d)return;
 for(const [k,v] of Object.entries(d)){
  if(k==="references")continue;
  const input=qs('[name="'+k+'"]',student);
  if(input&&v!==null&&v!==undefined)input.value=String(v);
 }
 (d.references||[]).slice(0,2).forEach((r,i)=>{
  const j=i+1;
  ["Name","Email","Relationship"].forEach(k=>{
   const input=qs('[name="ref'+j+k+'"]',student);
   if(input)input.value=r[k.toLowerCase()]||"";
  });
 });
 const optional=qs(".intake-details",student);
 optional.open=qsa("textarea",optional).some(field=>field.value.trim());
 countEssay();toggleGuardian();
}
async function prepareApplication(){
 refreshGates();
 if(!accountNeeded()||intakeState!=="open"||submittedApplication||draftLoadedFor===currentUser.uid||draftLoading)return;
 const uid=currentUser.uid;
 const pending=Promise.all([call("getDraft"),call("getMyEntries")]);
 draftLoading=pending;
 try{
  const [result,submitted]=await pending;
  if(!accountNeeded()||currentUser.uid!==uid)return;
  submittedApplication=submitted.entries?.find(entry=>entry.cycle===settings.cycle)||null;
  if(submittedApplication)showReceipt("student",submittedApplication.entryId,submittedApplication.type);
  else fillStudent(result.draft);
  draftLoadedFor=uid;
  $("draft-status").textContent=result.updatedAt?"Saved "+timestamp(result.updatedAt):"No draft saved yet";
  updateStep();
  refreshGates();
 }catch(e){
  if(currentUser?.uid!==uid)return;
  $("student-intake-gate").textContent="Unable to load your application. ";
  const retry=el("button","Try again","link-button");
  retry.type="button";retry.onclick=prepareApplication;
  $("student-intake-gate").append(retry);
 }finally{
  if(draftLoading===pending)draftLoading=null;
 }
}
function showReceipt(kind,entryId,type){
 const panel=$(kind+"-receipt");
 const heading=el("h2",kind==="nomination"?"Nomination received":type==="nomination"?"Your nomination is on file":"Application on file");
 heading.tabIndex=-1;
 const code=el("code",entryId);
 const id=el("p","Entry ID ");id.append(code);
 const guidance=el("p",kind==="nomination"
  ?"This is the student’s official entry. Save the entry ID for your records. Beacon may follow up to confirm eligibility, references or guardian consent."
  :"You can check the status of this entry in your Beacon dashboard.");
 const link=el("a",kind==="nomination"?"Return to Beacon Scholars":"View your dashboard →","btn btn-gold");
 link.href=kind==="nomination"?"#home":"#dashboard";
 panel.replaceChildren(heading,id,guidance,link);
 if(kind==="nomination"){
  const another=el("button","Nominate another student","btn btn-outline");
  another.type="button";
  another.onclick=()=>{panel.hidden=true;refreshGates();qs('[name="studentName"]',nomForm).focus();};
  panel.append(" ",another);
 }
 panel.hidden=false;
 refreshGates();
 if(!panel.closest("[hidden]"))heading.focus();
}
function updateStep(){
 qsa(".wizard-step",student).forEach((panel,i)=>panel.hidden=i!==step);
 $("student-step-counter").textContent="Step "+(step+1)+" of "+stepNames.length;
 $("student-step-progress").replaceChildren(...stepNames.map((_,i)=>{const b=el("span");b.className=i<=step?"done":"";return b;}));
 $("student-prev").hidden=step===0;
 $("student-next").hidden=step===finalStep;
 $("student-submit").hidden=step!==finalStep;
 if(step===finalStep){
  const d=studentFields();
  $("student-review-summary").textContent=[
   "Student: "+(d.studentName||"Not provided"),
   "School: "+(d.school||"Not provided"),"Grade: "+(d.grade||"—"),
   "References: "+(d.references||[]).filter(x=>x.email&&x.name).length+" of 2 provided.",
   "Guardian: "+(d.ageBand==="minor"?(d.guardianEmail||"Email needed"):"Not required")
  ].join(" • ");
 }
}
function focusStudentStep(){
 updateStep();
 const legend=qs(".wizard-step:not([hidden]) legend",student);
 legend.tabIndex=-1;
 legend.focus({preventScroll:true});
 student.scrollIntoView({block:"start"});
}
function validateStep(index=step){
 const current=qs('.wizard-step[data-step="'+index+'"]',student);
 for(const control of qsa("input,select,textarea",current)){
  if(!control.checkValidity()){
   step=index;updateStep();control.reportValidity();return false;
  }
 }
 const fields=studentFields();
 let message="";
 if(index===1&&fields.personalStatement.trim().length<180)message="Your essay needs a little more detail before continuing.";
 if(index===2){
  const [academic,character]=fields.references.map(reference=>reference.email.trim().toLowerCase());
  const account=currentUser?.email?.toLowerCase(),guardian=fields.ageBand==="minor"?fields.guardianEmail.trim().toLowerCase():"";
  if(academic===character)message="Use different email addresses for your two references.";
  else if([academic,character].some(email=>email===account||email===guardian))
   message="Use reference email addresses that differ from yours and your guardian’s.";
  else if(guardian&&guardian===account)message="Use a separate email address for your guardian.";
 }
 if(!message)return true;
 step=index;updateStep();formError("student",message);return false;
}
$("student-next").addEventListener("click",async()=>{
 if(studentBusy)return;
 formError("student");
 if(!validateStep())return;
 studentBusy=true;
 refreshGates();
 try{
  await saveDraft();
  step=Math.min(finalStep,step+1);
  studentBusy=false;refreshGates();focusStudentStep();
 }catch(e){await intakeError("student",e);}
 finally{studentBusy=false;refreshGates();}
});
$("student-prev").addEventListener("click",()=>{
 if(studentBusy)return;
 formError("student");step=Math.max(0,step-1);focusStudentStep();
});
async function saveDraft(){
 clearTimeout(saveTimer);
 if(!accountNeeded()||intakeState!=="open"||draftLoadedFor!==currentUser.uid||submittedApplication)return;
 const uid=currentUser.uid;
 const fields=studentFields();
 const pending=(savingPromise||Promise.resolve()).catch(()=>{}).then(()=>{
  if(auth.currentUser?.uid!==uid||submittedApplication)throw Error("This application is no longer being edited.");
  $("draft-status").textContent="Saving…";
  return call("saveDraft",{fields});
 });
 savingPromise=pending;
 try{
  await pending;
  if(savingPromise===pending&&currentUser?.uid===uid)$("draft-status").textContent="Saved securely";
 }catch(e){
  if(savingPromise===pending&&currentUser?.uid===uid)$("draft-status").textContent="Save failed";
  throw e;
 }finally{
  if(savingPromise===pending)savingPromise=null;
 }
}
function scheduleDraftSave(){
 if(intakeState!=="open"||!accountNeeded()||draftLoadedFor!==currentUser.uid||submittedApplication||studentBusy)return;
 clearTimeout(saveTimer);
 $("draft-status").textContent="Unsaved changes";
 saveTimer=setTimeout(()=>saveDraft().catch(()=>{}),1100);
}
student.addEventListener("input",()=>{countEssay();scheduleDraftSave();});
student.addEventListener("change",()=>{toggleGuardian();scheduleDraftSave();});
function toggleGuardian(){
 const isMinor=qs('[name="ageBand"]',student).value==="minor";
 $("student-guardian-fields").hidden=!isMinor;
 qsa('input[name="guardianName"],input[name="guardianEmail"]',student).forEach(control=>control.required=isMinor);
}
function countEssay(){const t=qs('[name="personalStatement"]',student).value.trim();$("essay-word-count").textContent=(t?t.split(/\s+/).length:0)+" words";}
async function verifiedEmail(){
 const user=auth.currentUser;
 await reload(user);
 currentUser=user;
 refreshGates();
 if(!user.emailVerified)throw Error("Verify your email before submitting. You can resend the verification email from your account page.");
 await user.getIdToken(true);
 return user.email?.toLowerCase();
}
student.addEventListener("submit",async e=>{
 e.preventDefault();
 if(studentBusy||step!==finalStep||submittedApplication)return;
 formError("student");
 if(!stepNames.every((_,index)=>validateStep(index)))return;
 studentBusy=true;refreshGates();
 try{
  whenOpen();if(!accountNeeded())throw Error("Create and sign in to an account first.");
  await verifiedEmail();
  try{await saveDraft();}catch(error){
   if(!String(error.code).includes("already-exists"))throw error;
  }
  const result=await call("submitEntry",{type:"self",declarations:{truthful:true,requirements:true}});
  submittedApplication={entryId:result.entryId,type:"self"};
  clearTimeout(saveTimer);student.reset();
  showReceipt("student",result.entryId,"self");
 }catch(e){await intakeError("student",e);}
 finally{studentBusy=false;refreshGates();}
});

const nomForm=$("nomination-form");
nomForm.addEventListener("input",()=>{if(!nominationBusy)nominationRequestId=null;});
function nominationPrivacy(){
 const privacy=qs('input[name="privacy"]:checked',nomForm)?.value;
 const anonymous=privacy==="anonymous",signed=accountNeeded();
 $("nominator-identity").hidden=anonymous;
 $("nomination-sign-in").hidden=signed;
 const status=$("nomination-account-status");
 status.hidden=!signed;
 status.textContent=signed?"Signed in as "+currentUser.email:"";
 qsa("#nominator-identity input").forEach(input=>{
  input.disabled=anonymous;
  input.required=!anonymous&&input.name==="nominatorName";
 });
}
qsa('input[name="privacy"]',nomForm).forEach(x=>x.addEventListener("change",()=>{formError("nomination");nominationPrivacy();}));
nominationPrivacy();
nomForm.addEventListener("submit",async e=>{
 e.preventDefault();
 if(nominationBusy||!$("nomination-receipt").hidden)return;
 formError("nomination");
 for(const input of nomForm.elements){
  if(!input.checkValidity()){
   const details=input.closest("details");
   if(details)details.open=true;
   input.reportValidity();return;
  }
 }
 nominationBusy=true;refreshGates();
 try{
  whenOpen();
  const d=new FormData(nomForm),get=x=>String(d.get(x)||"").trim();
  const privacy=get("privacy");
  let nominatorEmail="";
  if(privacy!=="anonymous"){
   if(!accountNeeded()){location.hash="#account/nominate";return;}
   nominatorEmail=await verifiedEmail();
  }else if(!auth.currentUser){await signInAnonymously(auth);}
  const fields={
   studentName:get("studentName"),school:get("school"),grade:get("grade"),
   graduationYear:get("graduationYear"),state:get("state"),guardianEmail:get("guardianEmail"),applicantEmail:get("applicantEmail"),
   personalStatement:get("personalStatement"),
   references:[{name:get("ref1Name"),email:get("ref1Email")},{name:get("ref2Name"),email:get("ref2Email")}]
  };
  nominationRequestId||=crypto.randomUUID();
  const out=await call("submitEntry",{
   type:"nomination",privacy,fields,requestId:nominationRequestId,declaration:get("declaration")==="on",nominatorName:get("nominatorName"),
   nominatorEmail,relationship:get("relationship"),message:get("message")
  });
  nominationRequestId=null;
  nomForm.reset();nominationPrivacy();
  showReceipt("nomination",out.entryId);
 }catch(err){await intakeError("nomination",err);}
 finally{nominationBusy=false;refreshGates();}
});

const statusLabels={
 submitted:"Submitted",screening:"Eligibility screening",under_review:"Under review",selected:"Selected",
 not_selected:"Not selected",withdrawn:"Withdrawn",merged:"Merged",verified:"Verified",
 pending:"Pending",not_required:"Not required",signed_pending_verification:"Awaiting verification",
 awaiting_verification:"Awaiting verification"
};
const statusText=value=>statusLabels[value]||String(value||"Pending").replace(/_/g," ");
const entryType=entry=>entry.type==="nomination"?"Nomination":"Application";
function statusBadge(value){
 const badge=el("span",statusText(value),"workspace-status");
 badge.dataset.status=value||"pending";
 return badge;
}
function workspaceCard(title,description){
 const panel=el("section",undefined,"workspace-card");
 panel.append(el("h2",title));
 if(description)panel.append(el("p",description,"muted"));
 return panel;
}
function workspaceLink(label,href,kind="btn-outline"){
 const link=el("a",label,"btn "+kind);link.href=href;return link;
}
function entryRow(entry,buttonLabel,onClick){
 const row=el("article",undefined,"entry-row workspace-entry");
 const info=el("div");
 info.append(el("h3",entry.studentName),el("p",entryType(entry)+" · "+entry.cycle+(entry.grade?" · Grade "+entry.grade:"")));
 const actions=el("div",undefined,"workspace-actions");
 const button=el("button",buttonLabel,"btn btn-outline");button.type="button";button.onclick=onClick;
 actions.append(statusBadge(entry.status),button);
 row.append(info,actions);
 return row;
}
function workspaceFacts(facts){
 const list=el("dl",undefined,"workspace-facts");
 for(const [label,value] of facts){
  const cell=el("div");
  cell.append(el("dt",label),el("dd",String(value??"—")));
  list.append(cell);
 }
 return list;
}
async function showDashboard(){
 const root=$("dashboard-content");root.replaceChildren();
 if(!accountNeeded()){
  const gate=workspaceCard("Sign in to continue","Your drafts and submitted entries are linked to your Beacon account.");
  gate.append(workspaceLink("Sign in or create an account","#account/dashboard","btn-gold"));root.append(gate);return;
 }
 root.textContent="Loading your Beacon record…";
 try{
  const [draft,submitted]=await Promise.all([call("getDraft"),call("getMyEntries")]);
  const entries=submitted.entries||[];
  root.replaceChildren();
  const currentEntry=entries.find(entry=>entry.cycle===settings.cycle);
  if(!currentEntry){
   const start=workspaceCard(draft.draft?"Saved application":"Apply for recognition",
    draft.draft?(draft.updatedAt?"Last saved "+timestamp(draft.updatedAt)+".":"Your progress is saved."):
    "Enter the Class of "+settings.cycle+" selection cycle.");
   if(intakeState==="open")start.append(workspaceLink(draft.draft?"Resume application":"Start application","#apply","btn-gold"));
   else start.append(el("p","Applications are "+(intakeState==="closed"?"currently closed.":"currently unavailable."),"help"));
   root.append(start);
  }
  const list=workspaceCard("Submitted entries");
  if(!entries.length)list.append(el("p","You haven’t submitted an entry yet.","muted"));
  for(const entry of entries){
   list.append(entryRow(entry,"View details",async()=>{
    try{const {entry:record}=await call("getMyEntry",{entryId:entry.entryId});showEntryDetails(root,record);}
    catch(error){notify(readable(error));}
   }));
  }
  root.append(list);
 }catch(e){root.textContent=readable(e);}
}
function showEntryDetails(root,entry){
 $("application-detail")?.remove();
 const panel=workspaceCard(entry.studentName);panel.id="application-detail";
 panel.append(workspaceFacts([
  ["Entry",entryType(entry)],["Status",statusText(entry.status)],["References",statusText(entry.referenceStatus)],
  ["Guardian permission",statusText(entry.guardianStatus)],["Entry ID",entry.entryId]
 ]));
 if(entry.status==="selected")panel.append(workspaceLink("Open Scholar Passport","#scholar","btn-gold"));
 root.append(panel);panel.scrollIntoView({behavior:"smooth",block:"nearest"});
}

function infoRow(label,value){const p=el("p");const b=el("strong",label+": ");p.append(b,document.createTextNode(String(value||"—")));return p;}
function printDocument(sheet){
 const area=$("print-document");
 area.replaceChildren(sheet.cloneNode(true));
 const clear=()=>area.replaceChildren();
 window.addEventListener("afterprint",clear,{once:true});
 try{window.print();}
 catch(error){window.removeEventListener("afterprint",clear);clear();throw error;}
}
function studentLetter(title,name,paragraphs,closing,footer){
 const sheet=el("article",undefined,"paper-document student-letter");
 sheet.append(
  el("div","THE PRAYER PROJECT • BEACON SCHOLARS","paper-kicker"),
  el("div",undefined,"paper-divider"),
  el("h2",title),
  el("p","Dear "+name+","),
  ...paragraphs.map(paragraph=>el("p",paragraph)),
  el("p",closing),
  el("div","Christopher Shelley","signature"),
  el("p","Founder, The Prayer Project"),
  el("div",undefined,"paper-divider"),
  el("small",footer+" · beacon.ask4prayers.com")
 );
 return sheet;
}
function congratulationsLetter(record){
 const paragraphs=[
  "Congratulations! It is my pleasure to recognize you as a Beacon Scholar in the Class of "+record.cycle+".",
  "The selection committee saw character, perseverance and promise in your story. The way you care for others, the responsibilities you carry and the courage you show as you grow are worth recognizing.",
  "I hope you’ll carry this encouragement with you as you keep learning, serving and pursuing the difference you hope to make."
 ];
 if(record.founderNote)paragraphs.push(record.founderNote);
 const footer=["Official Beacon Scholar Recognition",record.publicId].filter(Boolean).join(" · ");
 return studentLetter("Congratulations, Beacon Scholar",record.recognitionName||record.studentName,paragraphs,"With sincere congratulations,",footer);
}
function nominationLetter(record){
 return studentLetter("You were nominated for Beacon Scholars",record.studentName,[
  "Someone in your community thought of you when they had the chance to recognize a student whose character and potential deserve to be seen. They took the time to nominate you for Beacon Scholars.",
  "Your nomination counts as your official entry. You don’t need to complete a separate application. The Beacon team may reach out about eligibility, references or parent or guardian permission as part of the review.",
  "I hope it encourages you to know that someone noticed the way you show up for others and took the time to tell us about you."
 ],"With encouragement,","Beacon Scholars · Class of "+record.cycle);
}
function committeeLetterActions(record){
 if(!record.canManage)return null;
 const actions=el("div",undefined,"review-actions");
 const options=[];
 if(record.status==="selected")options.push(["Print congratulations letter",congratulationsLetter]);
 if(record.type==="nomination"||record.endorsementCount>0||record.endorsements?.length)
  options.push(["Print nomination letter",nominationLetter]);
 for(const [label,createLetter] of options){
  const button=el("button",label,"btn btn-outline");button.type="button";
  button.onclick=()=>printDocument(createLetter(record));
  actions.append(button);
 }
 return actions.childElementCount?actions:null;
}
async function showScholar(){
 const root=$("scholar-content");root.textContent="Loading Scholar Passport…";
 if(!accountNeeded()){root.innerHTML='<p>Sign in to access your private Scholar record.</p><a href="#account" class="btn btn-gold">Sign in</a>';return;}
 try{
  const r=await call("getMyEntries"),selected=r.entries?.find(e=>e.status==="selected");
  if(!selected){root.textContent="No selected Scholar record is linked to this account yet.";return;}
  activeScholarId=selected.entryId;
  const record=(await call("getMyEntry",{entryId:activeScholarId})).entry;
  root.replaceChildren();
  const recognition=workspaceCard(record.recognitionName||record.studentName,"Beacon Scholar · Class of "+record.cycle);
  recognition.classList.add("recognition-card");
  recognition.append(workspaceFacts([["Scholar ID",record.publicId]]));
  const grid=el("div",undefined,"workspace-columns");
  const delivery=workspaceCard("Delivery preferences");
  const milestonePanel=workspaceCard("Private milestones","Keep a record of service, leadership, and personal growth.");
  grid.append(delivery,milestonePanel);
  root.append(recognition,grid);
  const form=el("form",undefined,"entry-form");form.id="scholar-settings";
  form.innerHTML='<div class="field-grid"><label>Recognition name <input name="recognitionName" maxlength="120" required></label><label>Delivery preference <select name="deliveryPreference"><option value="digital">Digital</option><option value="mail">Mail physical copies</option></select></label></div><div id="scholar-address" class="field-grid" hidden><label>Address or P.O. Box <input name="line1"></label><label>Apt / Unit <input name="line2"></label><label>City <input name="city"></label><label>State <input name="state"></label><label>ZIP <input name="zip"></label></div><label class="check-label"><input type="checkbox" name="publicityConsent"> Allow optional public recognition where all required guardian permissions are on file.</label><button class="btn btn-outline" type="submit">Save delivery preferences</button>';
  form.elements.recognitionName.value=record.recognitionName||record.studentName;
  form.elements.deliveryPreference.value=record.deliveryPreference||"digital";
  if(record.address){
   for(const field of ["line1","line2","city","state","zip"])form.elements[field].value=record.address[field]||"";
  }
  const addressFields=qs("#scholar-address",form);
  addressFields.hidden=form.elements.deliveryPreference.value!=="mail";
  form.elements.deliveryPreference.addEventListener("change",()=>{addressFields.hidden=form.elements.deliveryPreference.value!=="mail";});
  form.addEventListener("submit",async e=>{
   e.preventDefault();const d=new FormData(form);
   try{await call("saveScholarPreferences",{entryId:activeScholarId,recognitionName:d.get("recognitionName"),deliveryPreference:d.get("deliveryPreference"),address:{line1:d.get("line1"),line2:d.get("line2"),city:d.get("city"),state:d.get("state"),zip:d.get("zip")},publicityConsent:d.has("publicityConsent")});notify("Scholar preferences saved securely.");await showScholar();}catch(err){notify(readable(err));}
  });
  delivery.append(form);
  const milestones=el("div",undefined,"workspace-stack milestone-list");
  for(const item of record.milestones||[]){
   const card=el("article",undefined,"milestone-card");
   card.append(el("h3",item.title));card.append(el("p",item.details));
   card.append(el("span",item.date+" • "+(item.verified?"Verified milestone":"Personal milestone"),"help"));
   milestones.append(card);
  }
  if(!(record.milestones||[]).length)milestones.append(el("p","No milestones recorded yet.","muted"));
  milestonePanel.append(milestones);
  const milestoneForm=el("form",undefined,"entry-form");
  milestoneForm.innerHTML='<h3>Add a private milestone</h3><label>Milestone title <input name="title" minlength="5" maxlength="140" required></label><label>Date <input type="date" name="date" required></label><label>What happened and why does it matter? <textarea name="details" rows="4" minlength="10" maxlength="800" required></textarea></label><button class="btn btn-outline" type="submit">Save milestone</button>';
  milestoneForm.addEventListener("submit",async e=>{
   e.preventDefault();const d=new FormData(milestoneForm);
   try{await call("addMilestone",{entryId:activeScholarId,title:d.get("title"),date:d.get("date"),details:d.get("details")});notify("Milestone saved.");showScholar();}
   catch(err){notify(readable(err));}
  });
  milestonePanel.append(milestoneForm);
  const verifyLink=workspaceLink("Verify Scholar ID","#verify/"+encodeURIComponent(record.publicId));
  const toolbar=el("div",undefined,"workspace-actions");
  const printLetter=el("button","Print official letter","btn btn-gold"),printCert=el("button","Print certificate","btn btn-outline");
  toolbar.append(printLetter,printCert,verifyLink);recognition.append(toolbar);
  const name=escaped(record.recognitionName||record.studentName);
  const id=escaped(record.publicId);
  const letter=congratulationsLetter(record);
  const certificate=el("section",undefined,"paper-document cert");certificate.id="official-certificate";
  certificate.innerHTML='<div class="paper-kicker">THE PRAYER PROJECT</div><div class="paper-seal">✦</div><h2>BEACON SCHOLARS</h2><h3>CERTIFICATE OF RECOGNITION</h3><p>Presented with distinction to</p><h2 class="recipient-name">'+name+'</h2><p>In recognition of exceptional character, promise, perseverance, and the potential to make a meaningful difference.</p><h3>Beacon Scholar • Class of '+escaped(record.cycle)+'</h3><div class="paper-divider"></div><div class="signature">Christopher Shelley</div><p>Founder, The Prayer Project</p><small>Recognition ID: '+id+' · beacon.ask4prayers.com</small>';
  printLetter.onclick=()=>printDocument(letter);
  printCert.onclick=()=>printDocument(certificate);

 }catch(e){root.textContent=readable(e);}
}

const prompts=[
 "How do you know this student, and for how long?",
 "What character or integrity qualities distinguish this student?",
 "Share a specific example of kindness, leadership, perseverance or service.",
 "How has this student demonstrated personal growth or future potential?",
 "Why do you recommend this individual for Beacon Scholars?"
];
$("reference-questions").replaceChildren(...prompts.map((q,i)=>{
 const l=el("label",q);const t=el("textarea");t.name="answer"+i;t.rows=4;t.required=true;t.minLength=15;t.maxLength=1600;l.append(t);return l;
}));
async function loadClaim(){
 const info=$("claim-info");
 if(!inviteToken){info.textContent="No invitation token was provided.";return;}
 try{
  const result=await call("getInvitation",{token:inviteToken});
  if(result.kind!=="scholar")throw Error("This invitation is not for a Scholar account.");
  info.textContent="You've been invited to connect the nomination for "+result.recipientName+". Sign in with your verified invited email address to continue.";
 }catch(err){info.textContent=readable(err);}
}
$("claim-now").addEventListener("click",async()=>{
 if(!accountNeeded()){location.hash="#account/claim/"+encodeURIComponent(inviteToken||"");return;}
 try{
  await verifiedEmail();
  const result=await call("claimNomination",{token:inviteToken});
  history.replaceState(null,"",location.pathname+"#dashboard");
  notify("Your nomination is now connected to your Beacon account. No separate application is required.");
  route();
 }catch(e){notify(readable(e));}
});
async function loadInvitation(kind){
 const intro=$(kind+"-intro"),form=$(kind+"-form");
 form.hidden=false;intro.textContent="Checking the invitation…";
 if(!inviteToken){intro.textContent="This link does not contain a valid invitation.";form.hidden=true;return;}
 try{
  const result=await call("getInvitation",{token:inviteToken});
  if(result.kind!==(kind==="consent"?"guardian":"reference"))throw Error("This is the wrong invitation link.");
  intro.textContent="Invitation for "+result.recipientName+". Your response goes privately to the Beacon Selection Committee. Expires "+timestamp(result.expiresAt)+".";
 }catch(e){intro.textContent=readable(e);form.hidden=true;}
}
function responseData(form){
 const d=new FormData(form),o={};for(const [k,v] of d.entries())o[k]=v;
 o.attest=d.has("attest");o.isGuardian=d.has("isGuardian");o.consent=d.has("consent");o.publicityConsent=d.has("publicityConsent");
 return o;
}
for(const kind of ["reference","consent"]){
 $(kind+"-form").addEventListener("submit",async e=>{
  e.preventDefault();const form=e.currentTarget;
  if(!form.reportValidity())return;
  try{
   const response=responseData(form);response.type=kind==="consent"?"guardian":"reference";
   await call("respondInvitation",{token:inviteToken,response});
   form.replaceChildren(el("div","Thank you. Your confidential response has been recorded and will be reviewed by Beacon personnel.","callout"));
   // Remove the private invitation token from the browser URL.
   history.replaceState(null,"",location.pathname+"#"+kind);
   notify("Your response was securely recorded.");
  }catch(err){notify(readable(err));}
 });
}

function renderIntakeControls(program){
 const panel=el("section",undefined,"review-card intake-controls workspace-card");
 const status=el("p");status.setAttribute("role","status");
 const button=el("button",undefined,"btn btn-gold");button.type="button";
 const error=el("p",undefined,"intake-error");error.setAttribute("role","alert");error.hidden=true;
 const actions=el("div",undefined,"workspace-actions");
 for(const [label,path] of [["View application","#apply"],["View nomination","#nominate"]]){
  const link=el("a",label,"btn btn-outline");link.href=path;actions.append(link);
 }
 const overview=el("div",undefined,"workspace-card-heading");
 const copy=el("div");copy.append(el("h2","Applications and nominations"),status);
 overview.append(copy,button);panel.append(overview,error,actions);
 const render=()=>{
  status.textContent=program.intakeOpen?"Open for the Class of "+program.cycle+".":"Closed for the Class of "+program.cycle+".";
  button.textContent=program.intakeOpen?"Close applications and nominations":"Open applications and nominations";
 };
 button.onclick=async()=>{
  button.disabled=true;error.hidden=true;
  try{
   program=await call("setIntakeStatus",{intakeOpen:!program.intakeOpen});
   updateIntakeStatus(program);render();
  }catch(e){error.textContent=readable(e);error.hidden=false;}
  finally{button.disabled=false;}
 };
 render();
 return panel;
}

async function showCommittee(){
 const box=$("committee-content"),detail=$("review-detail");
 reviewRequest++;
 box.hidden=false;detail.hidden=true;detail.replaceChildren();box.textContent="Checking access…";
 if(!accountNeeded()){
  const gate=workspaceCard("Committee sign-in","Use your authorized reviewer or administrator account.");
  gate.append(workspaceLink("Sign in","#account/committee","btn-gold"));box.replaceChildren(gate);return;
 }
 const uid=currentUser.uid;
 try{
  const result=await call("listReviewQueue");
  if(currentUser?.uid!==uid)return;
  box.replaceChildren();
  if(result.intake)box.append(renderIntakeControls(result.intake));
  const entries=result.entries||[];
  const queue=workspaceCard("Selection queue");
  const stats=el("div",undefined,"workspace-stats");
  for(const [label,count] of [
   ["Recent entries",entries.length],["Nominations",entries.filter(e=>e.type==="nomination").length],
   ["Under review",entries.filter(e=>e.status==="under_review").length],["Selected",entries.filter(e=>e.status==="selected").length]
  ]){
   const tile=el("div");tile.append(el("strong",String(count)),el("span",label));stats.append(tile);
  }
  queue.append(stats);
  if(!entries.length)queue.append(el("p","No entries have been submitted.","muted"));
  for(const item of entries)queue.append(entryRow(item,"Open Selection File",()=>openReview(item.entryId)));
  box.append(queue);
 }catch(e){
  if(currentUser?.uid===uid)box.replaceChildren(workspaceCard("Committee access",readable(e)));
 }
}
function reviewField(label,placeholder,rows,maxLength,value=""){
 const field=el("label",label,"workspace-field");
 const input=el("textarea");input.rows=rows;input.maxLength=maxLength;input.placeholder=placeholder;input.value=value;
 field.append(input);
 return {field,input};
}
let reviewRequest=0;
async function openReview(entryId){
 const container=$("review-detail"),queue=$("committee-content");
 const request=++reviewRequest,uid=currentUser?.uid;
 queue.hidden=true;container.hidden=false;
 const back=el("button","← Selection queue","link-button workspace-back");back.type="button";
 back.onclick=()=>{showCommittee();$("committee-view").scrollIntoView({block:"start"});};
 container.replaceChildren(back,el("p","Loading selection file…","muted"));
 try{
  const result=await call("getReviewEntry",{entryId}),d=result.entry;
  if(request!==reviewRequest||currentUser?.uid!==uid||location.hash!=="#committee")return;
  container.replaceChildren(back);
  const core=workspaceCard(d.studentName);
  const summary=el("div",undefined,"workspace-card-heading");
  summary.append(el("p",entryType(d)+(d.grade?" · Grade "+d.grade:""),"muted"),statusBadge(d.status));
  core.append(summary);
  const letters=committeeLetterActions(d);
  if(letters)core.append(letters);
  core.append(workspaceFacts([
   ["School",d.school||"—"],["Reported GPA",d.gpa??"Not reported"],["Eligibility",d.verifiedEligibility?"Verified":"Pending"],
   ["References",d.referenceCount+" of 2 verified"],["Guardian consent",statusText(d.guardianStatus)],
   ["Committee reviews",d.reviewCount+" recorded · "+d.approveVotes+" recommend selection"],["Entry ID",d.entryId]
  ]));
  const story=el("div",undefined,"review-story");
  for(const [key,label] of [["personalStatement","Essay or nomination"],["academicInterests","Academic interests"],["futureGoals","Future goals"],["service","Community service"],["activities","Leadership and activities"],["responsibilities","Responsibilities and personal growth"],["additionalInfo","Additional context"]]){
   if(d[key])story.append(el("h3",label),el("p",d[key]));
  }
  if(story.childElementCount)core.append(story);
  if(d.duplicateCount>1){core.append(el("p","Potential duplicate entries: "+d.duplicateCount+" records share the same student name, school and graduation year. Review without assuming they are duplicates.","callout"));}
  if((d.endorsements||[]).length){
   core.append(el("h3","Supporting nominations ("+d.endorsements.length+")"));
   for(const endorsement of d.endorsements){
    core.append(el("p",endorsement.statement));
    if(endorsement.nominator?.name)core.append(el("p","Confidential nominator (admin): "+endorsement.nominator.name,"help"));
   }
  }
  if(d.nominator){core.append(el("h3","Confidential nominator identity — ADMIN ONLY"));core.append(infoRow("Name",d.nominator.name));core.append(infoRow("Email",d.nominator.email));}
  container.append(core);
  const refs=workspaceCard("References and consent");
  refs.id="review-references";
  if(!d.references?.length)refs.append(el("p","No reference responses have been recorded yet.","muted"));
  const referenceLabels=["Academic reference","Character reference"];
  (d.referenceSuggestions||[]).forEach((r,i)=>{
   if(r.name||r.email)refs.append(infoRow(referenceLabels[i], [r.name,r.email].filter(Boolean).join(" • ")));
  });
  for(const r of d.references||[]){
   refs.append(el("h3",referenceLabels[r.slot]+" — "+(r.verified?"Verified":"Awaiting verification")));
   if(r.fullName)refs.append(infoRow("Full name",r.fullName));
   for(let i=0;i<(r.answers||[]).length;i++){refs.append(el("p",prompts[i],"help"));refs.append(el("p",r.answers[i]));}
   if(!d.canManage)continue;
   if(!r.verified){
    const button=el("button","Confirm reference identity and verify","btn btn-outline");
    button.type="button";button.onclick=()=>action("verifyRequirement",{entryId,kind:"reference",slot:Number(r.slot)},entryId);refs.append(button);
   }else{
    const {field,input:reason}=reviewField("Reason for invalidation","Explain why this reference is being invalidated",2,600);
    refs.append(field);
    const revoke=el("button","Invalidate reference "+(Number(r.slot)+1),"btn btn-outline");
    revoke.type="button";revoke.onclick=()=>action("invalidateReference",{entryId,slot:Number(r.slot),reason:reason.value},entryId);refs.append(revoke);
   }
  }
  container.append(refs);
  if(d.canManage){
   const tools=el("div",undefined,"review-actions");
   referenceLabels.forEach((label,slot)=>{
    const btn=el("button","Invite "+label.toLowerCase(),"btn btn-outline");
    btn.type="button";btn.onclick=()=>invitation(entryId,"reference",slot);tools.append(btn);
   });
   const guardian=el("button","Create guardian consent invitation","btn btn-outline");guardian.type="button";guardian.onclick=()=>invitation(entryId,"guardian",null);tools.append(guardian);
   if(d.guardianStatus==="signed_pending_verification"){const verify=el("button","Verify guardian authorization","btn btn-outline");verify.type="button";verify.onclick=()=>action("verifyRequirement",{entryId,kind:"guardian"},entryId);tools.append(verify);}
   if(d.guardianStatus==="verified"||d.guardianStatus==="signed_pending_verification"){
    const {field,input:reason}=reviewField("Reason for consent withdrawal","Describe the guardian’s request",2,600);
    refs.append(field);
    const revoke=el("button","Record guardian consent withdrawal","btn btn-outline");revoke.type="button";
    revoke.onclick=()=>action("revokeGuardianConsent",{entryId,reason:reason.value},entryId);tools.append(revoke);
   }
   refs.append(tools);
   const manage=workspaceCard("Student details and invitations");
   manage.id="review-student-details";
   manage.append(el("p","Use only confirmed information. Nominations can be submitted before the student's references or guardian contact information are available.","help"));
   const dataForm=el("form",undefined,"entry-form");
   dataForm.innerHTML='<div class="field-grid"><label>Nominee contact email <input type="email" name="applicantEmail"></label><label>Guardian email <input type="email" name="guardianEmail"></label><label>Guardian name <input name="guardianName"></label><label>Student age band <select name="ageBand"><option value="">Unknown</option><option value="minor">Under 18</option><option value="adult">18 or older</option></select></label><label>Verified unweighted GPA <input type="number" min="0" max="4" step=".01" name="gpa"></label></div><p>Qualified references</p><div class="field-grid"><label>Academic reference name <input name="ref1Name"></label><label>Academic reference email <input type="email" name="ref1Email"></label><label>Character reference name <input name="ref2Name"></label><label>Character reference email <input type="email" name="ref2Email"></label></div><button class="btn btn-outline" type="submit">Save verified contact details</button>';
   for(const key of ["applicantEmail","guardianEmail","guardianName","ageBand","gpa"])if(d[key]!==null&&d[key]!==undefined&&dataForm.elements[key])dataForm.elements[key].value=String(d[key]);
   (d.referenceSuggestions||[]).forEach((v,i)=>{const j=i+1;dataForm.elements["ref"+j+"Name"].value=v.name||"";dataForm.elements["ref"+j+"Email"].value=v.email||"";});
   dataForm.addEventListener("submit",async e=>{
    e.preventDefault();const f=new FormData(dataForm);
    await action("updateEntryContacts",{entryId,fields:{
     applicantEmail:f.get("applicantEmail"),guardianEmail:f.get("guardianEmail"),guardianName:f.get("guardianName"),
     ageBand:f.get("ageBand"),gpa:f.get("gpa"),
     references:[{name:f.get("ref1Name"),email:f.get("ref1Email")},{name:f.get("ref2Name"),email:f.get("ref2Email")}]
    }},entryId);
   });
   manage.append(dataForm);
   if(d.type==="nomination"){
    const mergeBox=el("div",undefined,"workspace-subsection");
    const destLabel=el("label","Merge this nomination into another entry (destination application ID)");
    const dest=el("input");dest.placeholder="Destination entry ID";dest.maxLength=140;
    destLabel.append(dest);mergeBox.append(destLabel);
    const merge=el("button","Merge as supporting endorsement","btn btn-outline");merge.type="button";
    merge.onclick=async()=>{
     if(!dest.value.trim())return notify("Enter the destination entry ID.");
     if(!confirm("Merge this nomination into "+dest.value.trim()+"? Confirm the student records truly represent the same person."))return;
     try{await call("mergeNomination",{sourceEntryId:entryId,destinationEntryId:dest.value.trim()});notify("Nomination linked as an endorsement. The original entry remains in the audit trail.");showCommittee();}
     catch(e){notify(readable(e));}
    };
    mergeBox.append(merge);manage.append(mergeBox);
   }
   const invitations=el("div",undefined,"workspace-actions");
   const claimBtn=el("button","Generate student account-claim invitation","btn btn-outline");
   claimBtn.type="button";claimBtn.onclick=()=>invitation(entryId,"scholar",null);invitations.append(claimBtn);
   if(d.type==="nomination"&&d.nominator?.email){
    referenceLabels.forEach((label,slot)=>{
     const btn=el("button","Verify nominator as "+label.toLowerCase(),"btn btn-outline");btn.type="button";
     btn.onclick=()=>{if(confirm("I independently verified this nominator's identity and eligibility to serve as this reference."))action("useVerifiedNominatorReference",{entryId,slot,identityVerified:true},entryId);};
     invitations.append(btn);
    });
   }
   manage.append(invitations);
   container.append(manage);
  }
  const control=workspaceCard("Independent evaluation","Score each criterion and record your recommendation. Final decisions require three to five distinct reviews.");
  control.id="review-evaluation";
  const reviewForm=el("form",undefined,"entry-form");reviewForm.innerHTML=
  '<div class="rubric-grid">'+[
   ["character","Character & integrity",30],["perseverance","Perseverance & growth",25],["service","Service & compassion",20],["leadership","Leadership & initiative",15],["potential","Purpose & potential",10]
  ].map(([key,label,max])=>'<label>'+label+' / '+max+'<input type="number" name="'+key+'" min="0" max="'+max+'" required value="'+(d.myReview?.scores?.[key]??0)+'"></label>').join("")+
  '</div><label>Committee recommendation <select name="recommend"><option value="discuss">Discuss further</option><option value="select">Recommend selection</option><option value="decline">Do not recommend</option></select></label><label>Independent reviewer notes <textarea name="notes" rows="5" maxlength="2400"></textarea></label><button type="submit" class="btn btn-gold">Save evaluation</button>';
  reviewForm.elements.recommend.value=d.myReview?.recommend||"discuss";
  reviewForm.elements.notes.value=d.myReview?.notes||"";
  reviewForm.addEventListener("submit",async e=>{
   e.preventDefault();const f=new FormData(e.currentTarget),scores={};
   for(const key of ["character","perseverance","service","leadership","potential"])scores[key]=Number(f.get(key));
   await action("recordReview",{entryId,scores,recommend:f.get("recommend"),notes:f.get("notes")},entryId);
  });
  control.append(reviewForm);
  const recusal=el("details",undefined,"workspace-subsection");
  const {field:conflictField,input:conflict}=reviewField("Reason for recusal","Describe the conflict of interest",2,400);
  const recuse=el("button","Recuse myself from this entry","btn btn-outline");
  recuse.type="button";recuse.onclick=()=>action("recuse",{entryId,reason:conflict.value},entryId);
  recusal.append(el("summary","Conflict of interest"),conflictField,recuse);
  control.append(recusal);
  container.append(control);
  if(d.canManage&&!["selected","not_selected","merged","withdrawn"].includes(d.status)){
   const adminTools=el("div",undefined,"workspace-columns");
   adminTools.id="review-admin-actions";
   const eligibility=workspaceCard("Eligibility");
   const {field:noteField,input:note}=reviewField("Verification notes","Record how eligibility was verified",3,1000);
   const eligibilityActions=el("div",undefined,"workspace-actions");
   for(const [label,eligible] of [["Mark eligible",true],["Return to screening",false]]){
    const btn=el("button",label,"btn btn-outline");btn.type="button";
    btn.onclick=()=>action("setEligibility",{entryId,eligible,notes:note.value},entryId);
    eligibilityActions.append(btn);
   }
   eligibility.append(noteField,eligibilityActions);
   const decisionCard=workspaceCard("Final decision");
   const {field:founderField,input:founder}=reviewField("Founder’s note (optional)","Write a message for the recognition letter",3,3400,d.founderNote||"");
   const decisions=el("div",undefined,"workspace-actions");
   for(const [label,decision] of [["Approve Beacon Scholar","select"],["Finalize as not selected","decline"]]){
    const button=el("button",label,decision==="select"?"btn btn-gold":"btn btn-outline");
    button.type="button";
    button.onclick=async()=>{
     if(confirm("Finalize this decision for "+d.studentName+"? The decision will be locked."))
      await action("finalizeDecision",{entryId,decision,founderNote:founder.value},entryId);
    };
    decisions.append(button);
   }
   decisionCard.append(founderField,decisions);
   adminTools.append(eligibility,decisionCard);
   container.append(adminTools);
  }
  const shortcuts=el("nav",undefined,"review-shortcuts");
  shortcuts.setAttribute("aria-label","Selection file sections");
  for(const [label,id] of [["References","review-references"],["Student details","review-student-details"],["Evaluation","review-evaluation"],["Eligibility and decision","review-admin-actions"]]){
   const target=$(id);
   if(!target)continue;
   const button=el("button",label,"link-button");button.type="button";
   button.onclick=()=>{
    const heading=qs("h2",target);
    heading.tabIndex=-1;heading.focus({preventScroll:true});
    target.scrollIntoView({behavior:"smooth",block:"start"});
   };
   shortcuts.append(button);
  }
  summary.after(shortcuts);
  back.focus({preventScroll:true});
  container.scrollIntoView({behavior:"smooth",block:"start"});
 }catch(e){
  if(request===reviewRequest&&currentUser?.uid===uid)container.replaceChildren(back,workspaceCard("Selection file",readable(e)));
 }

}
async function action(name,payload,entryId){
 try{const result=await call(name,payload);notify("Saved: "+name);if(result.publicId)notify("Scholar recognition created: "+result.publicId);await openReview(entryId);}
 catch(e){notify(readable(e));}
}
async function invitation(entryId,kind,slot){
 try{
  const result=await call("createInvitation",{entryId,kind,slot});
  let panel=$("private-invite-link");if(panel)panel.remove();
  panel=el("div",undefined,"review-card");panel.id="private-invite-link";
  panel.append(el("h3","Private invitation for "+result.recipientEmail));
  panel.append(el("p",result.queued?"An invitation email was queued through the configured Firebase mail extension. Verify delivery status before relying on it.":"Copy this one-time link and deliver it privately to the intended email recipient. Automatic email is not enabled. Verify the recipient before approving.","help"));
  const input=el("input");input.readOnly=true;input.value=result.url;input.setAttribute("aria-label","Private invitation URL");input.style.width="100%";
  panel.append(input);
  const button=el("button","Copy invitation URL","btn btn-outline");button.type="button";
  button.onclick=async()=>{try{await navigator.clipboard.writeText(result.url);notify("Private link copied.");}catch{input.select();notify("Select and copy the link above.");}};
  panel.append(button);$("review-detail").prepend(panel);
  panel.scrollIntoView({behavior:"smooth",block:"start"});
 }catch(e){notify(readable(e));}
}

async function checkScholarId(id){
 const result=$("verification-result");result.textContent="Checking recognition…";
 try{
  const data=await call("verifyScholar",{publicId:id});
  result.replaceChildren();
  if(!data.valid){result.append(el("p","No approved Scholar record matched that identification number.","danger-text"));return;}
  result.append(el("h3","Verified Beacon Scholar ✓"));
  result.append(infoRow("Recognition class",data.classYear));
  result.append(infoRow("Program",data.program));
  result.append(el("p",data.name?"Scholar: "+data.name:"This Scholar's personal details are private."));
 }catch(e){result.textContent=readable(e);}
}
$("verify-form").addEventListener("submit",e=>{
 e.preventDefault();const id=String(new FormData(e.currentTarget).get("publicId")||"").trim();
 checkScholarId(id);
});

init();
