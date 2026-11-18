import {auth,callable} from "./beacon-firebase.js";
import {
  onAuthStateChanged,onIdTokenChanged,signInWithEmailAndPassword,createUserWithEmailAndPassword,
  signInAnonymously,signOut,sendEmailVerification,sendPasswordResetEmail,reload
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
const $=id=>document.getElementById(id),qs=(s,root=document)=>root.querySelector(s),qsa=(s,root=document)=>[...root.querySelectorAll(s)];
const call=async(name,data={})=>(await callable(name)(data)).data;
const PAGE={home:"public-view",mission:"mission-view",selection:"selection-view",recognition:"recognition-view",faq:"faq-view",apply:"apply-view",nominate:"nominate-view","find-nomination":"find-nomination-view",account:"account-view",dashboard:"dashboard-view",scholar:"scholar-view",committee:"committee-view",policy:"policy-view",reference:"reference-view",consent:"consent-view",claim:"claim-view",verify:"verify-view"};
let currentUser=null,settings={cycle:"2027",intakeOpen:false},intakeState="loading",step=0;
let draftLoadedFor=null,draftLoading=null,saveTimer=null,savingPromise=null,inviteToken=null,activeScholarId=null;
let studentBusy=false,nominationBusy=false,nominationRequestId=null,submittedApplication=null,accountReturn="dashboard";
const stepNames=["About you","Your story","References and guardian","Review and submit"];
const finalStep=stepNames.length-1;
const timestamp=s=>s?new Date(s).toLocaleDateString():"";
const intakeDateLabel=value=>value?new Intl.DateTimeFormat("en-US",{dateStyle:"long",timeZone:"UTC"}).format(new Date(value+"T00:00:00Z")):"";
const deadlineLine=program=>program.intakeDeadline
 ?(program.deadlinePassed?"Intake ended ":"Applications and nominations are due ") + intakeDateLabel(program.intakeDeadline)+" at 11:59 p.m. Central Time."
 :"";
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
function route(dashboardEntryId){
 const [key,...parts]=(location.hash.slice(1)||"home").split("/");
 const page=key==="opportunities"?"recognition":Object.hasOwn(PAGE,key)?key:"home";
 if(page==="account"){
  const target=parts.join("/");
  accountReturn=/^(apply|nominate|find-nomination|dashboard|committee|claim)$|^claim\/[A-Za-z0-9_-]{43}$/.test(target)?target:"dashboard";
  const link=$("account-continue");
  link.href="#"+accountReturn;
  const destinations={apply:"Continue to your application →",nominate:"Return to your nomination →",
   claim:"Continue your nomination →","find-nomination":"Return to your nomination lookup →",committee:"Open Committee →",dashboard:"Open dashboard →"};
  link.textContent=destinations[accountReturn]||destinations.claim;
 }
 inviteToken=(page==="reference"||page==="consent"||page==="claim")?parts.join("/"):null;
 Object.values(PAGE).forEach(id=>{const node=$(id);if(node)node.hidden=true;});
 $(PAGE[page]).hidden=false;
 $("main-nav").classList.remove("open");$("menu-toggle").setAttribute("aria-expanded","false");
 qsa("#main-nav a").forEach(a=>a.removeAttribute("aria-current"));
 qsa('#main-nav a[href="#'+page+'"]').forEach(a=>a.setAttribute("aria-current","page"));
 window.scrollTo({top:0,behavior:"instant"});
 if(page==="apply")prepareApplication();
 if(page==="dashboard")showDashboard(typeof dashboardEntryId==="string"?dashboardEntryId:null);
 if(page==="committee")showCommittee();
 if(page==="find-nomination")refreshNominationLookup();
 if(page==="scholar")showScholar();
 if(page==="reference"||page==="consent")loadInvitation(page);
 if(page==="claim"){
  $("claim-account-link").href=inviteToken?"#account/claim/"+encodeURIComponent(inviteToken):"#account/claim";
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
 const deadline=deadlineLine(settings);
 for(const node of qsa("[data-intake-deadline]")){
  node.hidden=!deadline;
  node.textContent=deadline;
 }
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
 refreshNominationLookup();
}
onAuthStateChanged(auth,async u=>{
 const previousUid=currentUser?.isAnonymous?null:currentUser?.uid;
 const nextUid=u?.isAnonymous?null:u?.uid;
 if(previousUid!==nextUid){
  queueStage=queueType=queueWork="all";queueSearch="";queuePages=1;reviewDrafts.clear();
  clearTimeout(saveTimer);draftLoadedFor=null;draftLoading=null;submittedApplication=null;step=0;
  student.reset();$("student-receipt").hidden=true;$("student-receipt").replaceChildren();
  formError("student");countEssay();toggleGuardian();updateStep();
 }
 currentUser=u;
 refreshGates();
 if(location.hash==="#apply")await prepareApplication();
 if(location.hash==="#dashboard")showDashboard();
 if(location.hash==="#claim"||location.hash.startsWith("#claim/"))loadClaim();
 if(location.hash==="#committee")showCommittee();
 if(location.hash==="#scholar")showScholar();
});
function updateIntakeStatus(program){
 settings=program;
 intakeState=typeof program?.intakeOpen!=="boolean"?"unavailable":program.intakeOpen?"open":"closed";
 $("nomination-postal").hidden=program?.nominationPostalDelivery!==true;
 refreshGates();
}
function formError(kind,message=""){
 const error=$(kind+"-form-error");
 error.textContent=message;
 error.hidden=!message;
}
async function intakeError(kind,error){
 formError(kind,readable(error));
 if(error?.code==="functions/failed-precondition"&&(error.details?.intakeClosed||error.message==="Applications and nominations are currently closed.")){
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
async function requestVerification(user){
 if(settings.brandedVerification){
  const result=await call("sendBeaconVerification");
  if(result.mode==="queued")return "Verification email queued. Check your inbox and spam folder.";
  if(result.mode==="verified")return "Your email is already verified.";
 }
 await sendEmailVerification(user);
 return "Verification email sent. Check your inbox.";
}
$("create-account").addEventListener("click",async()=>{
 const form=$("auth-form");if(!form.reportValidity())return;
 const d=new FormData(form);
 try{
  const cred=await createUserWithEmailAndPassword(auth,String(d.get("email")).trim(),String(d.get("password")));
  try{
   notify("Account created. "+await requestVerification(cred.user));
  }catch(e){notify("Account created. Use the button on your account page to resend the verification email.");}
  location.hash="#"+accountReturn;
 }catch(e){notify(readable(e));}
});
$("sign-out").addEventListener("click",async()=>{await signOut(auth);draftLoadedFor=null;notify("Signed out.");location.hash="#home";});
$("verify-email").addEventListener("click",async()=>{try{notify(await requestVerification(auth.currentUser));}catch(e){notify(readable(e));}});
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
  if(result.formsQueued)notify("Application submitted. Outstanding form emails were queued.");
 }catch(e){await intakeError("student",e);}
 finally{studentBusy=false;refreshGates();}
});

const postalParts=["recipient","line1","line2","city","state","zip"];
const postalField=part=>"postal"+part[0].toUpperCase()+part.slice(1);
function readNominationAddress(get){
 const address=Object.fromEntries(postalParts.map(part=>[part,String(get(postalField(part))||"").trim()]));
 return Object.values(address).some(Boolean)?address:null;
}
const validNominationAddress=address=>!address||!!(address.line1&&address.city&&address.state&&/^\d{5}(?:-\d{4})?$/.test(address.zip));
const nominationAddressError="Enter a street address or P.O. box, city, state and valid ZIP code for the nomination letter.";
const nomForm=$("nomination-form");
$("nomination-postal").append($("nomination-postal-fields").content.cloneNode(true));
const nominationDeliveryError=$("nomination-delivery-error");
let nominationAdminUid=null;
function refreshNominationDeferral(){
 const allowed=settings?.nominationDeliveryDeferral===true&&!!nominationAdminUid&&currentUser?.uid===nominationAdminUid;
 $("nomination-delivery-deferral").hidden=!allowed;
 const control=nomForm.elements.deferNominationDelivery;
 control.disabled=!allowed;
 if(!allowed)control.checked=false;
}
onIdTokenChanged(auth,async user=>{
 const token=user&&!user.isAnonymous?await user.getIdTokenResult().catch(()=>null):null;
 if(auth.currentUser!==user)return;
 nominationAdminUid=token?.claims.admin===true&&token.claims.email_verified===true?user.uid:null;
 refreshNominationDeferral();
});
nomForm.addEventListener("input",()=>{
 if(!nominationBusy)nominationRequestId=null;
 nominationDeliveryError.hidden=true;
});
function nominationPrivacy(){
 refreshNominationDeferral();
 const privacy=qs('input[name="privacy"]:checked',nomForm)?.value;
 const anonymous=privacy==="anonymous",signed=accountNeeded();
 $("nominator-identity").hidden=anonymous;
 $("nomination-handoff").hidden=anonymous;
 nomForm.elements.nominationHandoff.disabled=anonymous;
 if(anonymous)nomForm.elements.nominationHandoff.checked=false;
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
 const d=new FormData(nomForm),get=x=>String(d.get(x)||"").trim();
 const privacy=get("privacy"),nominationHandoff=get("nominationHandoff")==="on";
 const deferNominationDelivery=get("deferNominationDelivery")==="on";
 const postalEnabled=settings?.nominationPostalDelivery===true;
 const address=postalEnabled?readNominationAddress(get):null;
 if(!validNominationAddress(address)){
  nominationDeliveryError.textContent=nominationAddressError;
  nominationDeliveryError.hidden=false;
  $("nomination-postal").open=true;
  nomForm.elements[postalField("line1")].focus();
  return;
 }
 if(!get("applicantEmail")&&!get("guardianEmail")&&!address&&!nominationHandoff&&!deferNominationDelivery){
  const contact=postalEnabled?"student or guardian email or mailing address":"student or guardian email";
  nominationDeliveryError.textContent=privacy==="anonymous"
   ?"Enter a "+contact+" so we can deliver the letter."
   :"Enter a "+contact+", or confirm you can deliver the letter privately.";
  nominationDeliveryError.hidden=false;
  nomForm.elements.applicantEmail.focus();
  return;
 }
 nominationBusy=true;refreshGates();
 try{
  whenOpen();
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
   nominatorEmail,nominationHandoff,deferNominationDelivery,relationship:get("relationship"),message:get("message"),
   ...(address?{nominationAddress:address}:{})
  });
  nominationRequestId=null;
  nomForm.reset();nominationPrivacy();
  showReceipt("nomination",out.entryId);
 }catch(err){await intakeError("nomination",err);}
 finally{nominationBusy=false;refreshGates();}
});

const statusLabels={
 processing:"Processing",submitted:"Submitted",screening:"Eligibility screening",under_review:"Committee review",finalist:"Finalist",selected:"Beacon Scholar",
 not_selected:"Not selected",withdrawn:"Withdrawn",merged:"Merged",verified:"Verified",
 pending:"Pending",not_required:"Not required",signed_pending_verification:"Awaiting verification",
 awaiting_verification:"Awaiting verification"
};
const statusText=value=>statusLabels[value==="submitted"&&settings.nominationNameLookup?"processing":value]||String(value||"Pending").replace(/_/g," ");
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
function entryRow(entry,buttonLabel,onClick,school){
 const row=el("article",undefined,"entry-row workspace-entry");
 const info=el("div");
 info.append(el("h3",entry.studentName),el("p",entryType(entry)+" · "+entry.cycle+(entry.grade?" · Grade "+entry.grade:"")+(school?" · "+school:"")));
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
async function showDashboard(openEntryId=null){
 const root=$("dashboard-content");root.replaceChildren();
 const findLink=settings.nominationNameLookup?"#find-nomination":"#claim";
 if(!accountNeeded()){
  const gate=workspaceCard("Sign in to continue","Your drafts and submitted entries are linked to your Beacon account.");
  gate.append(workspaceLink("Sign in or create an account","#account/dashboard","btn-gold"),
   workspaceLink("Check for a nomination",findLink));root.append(gate);return;
 }
 root.textContent="Loading your Beacon record…";
 try{
  const [draft,submitted]=await Promise.all([call("getDraft"),call("getMyEntries")]);
  const entries=submitted.entries||[];
  root.replaceChildren();
  if(submitted.nominationConnection?.pending)
   root.append(workspaceCard("Nomination connection pending","The committee is checking your request for "+submitted.nominationConnection.studentName+". Once confirmed, your nomination will appear under Submitted entries."));
  const claimCard=workspaceCard("Looking for a nomination?",settings.nominationNameLookup
   ?"Check by name to request a connection to your account."
   :"Use the Entry Key from an earlier letter to connect it to your account.");
  claimCard.append(workspaceLink("Check for a nomination",findLink));root.append(claimCard);
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
   list.append(entryRow(entry,entry.type==="nomination"?"View nomination":"View details",async()=>{
    try{const {entry:record}=await call("getMyEntry",{entryId:entry.entryId});showEntryDetails(root,record);}
    catch(error){notify(readable(error));}
   }));
  }
  root.append(list);
  if(openEntryId&&entries.some(entry=>entry.entryId===openEntryId)){
   const {entry}=await call("getMyEntry",{entryId:openEntryId});
   if(location.hash==="#dashboard")showEntryDetails(root,entry);
  }
 }catch(e){root.textContent=readable(e);}
}
function showEntryDetails(root,entry){
 $("application-detail")?.remove();
 const panel=workspaceCard(entry.studentName);panel.id="application-detail";
 panel.append(workspaceFacts([
  ["Entry",entryType(entry)],["Status",statusText(entry.status)],["References",statusText(entry.referenceStatus)],
  ["Guardian permission",statusText(entry.guardianStatus)],["Entry ID",entry.entryId]
 ]));
 const statusHelp={
  processing:"Beacon received your entry. The committee is confirming your account connection. Complete any follow-up available below.",
  submitted:"Beacon received your entry. Check here for requests for information.",
  screening:"Beacon is checking eligibility. Keep an eye on your reference and guardian permission statuses.",
  under_review:"Beacon is reviewing your entry. Check back here for updates."
 };
 if(statusHelp[entry.status])panel.append(el("p",statusHelp[entry.status],"help"));
 if(entry.status==="finalist"||(entry.status==="not_selected"&&entry.wasFinalist)){
  const honor=el("div",undefined,"callout finalist-notice");
  honor.append(el("h3","You’re a Beacon Finalist"),el("p","Your entry earned a place in the final round of consideration. Congratulations on reaching this stage."),workspaceLink("What finalist recognition means","#recognition"));
  panel.append(honor);
 }
 if(entry.status==="selected")panel.append(workspaceLink("Open Scholar Passport","#scholar","btn-gold"));
 if(entry.nominationFollowUp)panel.append(nominationFollowUpPanel(entry,root));
 root.append(panel);panel.scrollIntoView({behavior:"smooth",block:"nearest"});
}

function nominationFollowUpPanel(entry,root){
 const followUp=entry.nominationFollowUp;
 const panel=el("section",undefined,"workspace-subsection");
 panel.append(el("h3","Nomination follow-up"),workspaceFacts([
  ["Academic reference",followUp.references[0]],["Character reference",followUp.references[1]]
 ]));
 if(followUp.requested){
  panel.append(el("p",followUp.formsQueued
   ?"Beacon received your details and queued emails for any outstanding forms. Check here for responses."
   :"Beacon received your details. The team will arrange any outstanding reference or guardian consent forms.","muted"));
  return panel;
 }
 if(!followUp.canSubmit)return panel;
 const form=el("form",undefined,"entry-form");
 panel.append(el("p","Choose one person who knows your schoolwork and another who can speak to your character. Ask them before sharing their contact information.","muted"),form);
 const contacts=el("div",undefined,"field-grid");
 const addField=(parent,label,name,type="text")=>{
  const field=el("label",label),input=el("input");
  input.name=name;input.type=type;input.required=true;input.maxLength=type==="email"?254:120;
  field.append(input);parent.append(field);
 };
 ["Academic","Character"].forEach((label,slot)=>{
  if(followUp.references[slot]!=="Pending")return;
  addField(contacts,label+" reference name","ref"+slot+"Name");
  addField(contacts,label+" reference email","ref"+slot+"Email","email");
 });
 form.append(contacts);
 const ageLabel=el("label","Are you under 18?"),age=el("select");
 age.name="ageBand";age.required=true;
 for(const [value,label] of [["","Choose one"],["minor","Yes, I’m under 18"],["adult","No, I’m 18 or older"]]){
  const option=el("option",label);option.value=value;age.append(option);
 }
 age.value=followUp.guardianLocked?"minor":followUp.ageBand;
 age.disabled=followUp.guardianLocked;ageLabel.append(age);form.append(ageLabel);
 const guardian=el("fieldset",undefined,"follow-up-guardian");
 guardian.append(el("legend","Request parent or guardian consent"),
  el("p","Beacon will send your parent or guardian a separate form. They provide the consent themselves.","help"));
 const guardianFields=el("div",undefined,"field-grid");
 addField(guardianFields,"Parent or guardian name","guardianName");
 addField(guardianFields,"Parent or guardian email","guardianEmail","email");
 guardian.append(guardianFields);form.append(guardian);
 const showGuardian=()=>{
  guardian.hidden=age.value!=="minor"||followUp.guardianLocked;
  guardian.disabled=guardian.hidden;
 };
 age.addEventListener("change",showGuardian);showGuardian();
 const error=el("p",undefined,"intake-error");error.setAttribute("role","alert");error.hidden=true;
 const submit=el("button","Submit follow-up and request forms","btn btn-gold");
 submit.type="submit";form.append(error,submit);
 form.addEventListener("submit",async event=>{
  event.preventDefault();
  const data=new FormData(form),fields={
   ageBand:age.value,guardianName:data.get("guardianName"),guardianEmail:data.get("guardianEmail"),
   references:[0,1].map(slot=>({name:data.get("ref"+slot+"Name"),email:data.get("ref"+slot+"Email")}))
  };
  submit.disabled=true;error.hidden=true;
  try{
   const result=await call("submitNominationFollowUp",{entryId:entry.entryId,fields});
   notify(result.formsQueued?"Your follow-up is on file. Outstanding form emails were queued.":"Your follow-up is on file. Beacon will arrange the requested forms.");
   const {entry:updated}=await call("getMyEntry",{entryId:entry.entryId});
   showEntryDetails(root,updated);
  }catch(err){error.textContent=readable(err);error.hidden=false;}
  finally{submit.disabled=false;}
 });
 return panel;
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
  el("p",closing,"letter-closing"),
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
function nominationLetter(record,entryKey,includeFollowUp){
 const packet=el("div",undefined,"nomination-packet");
 const pageCount=includeFollowUp?3:2;
 const footer="Beacon Scholars · Class of "+record.cycle;
 const addPage=(title,page)=>{
  const sheet=el("article",undefined,"paper-document student-letter nomination-page");
  sheet.append(el("div","THE PRAYER PROJECT • BEACON SCHOLARS","paper-kicker"),
   el("div",undefined,"paper-divider"),el("h2",title));
  const pageFooter=el("footer",undefined,"nomination-page-footer");
  pageFooter.append(el("small",footer+" · beacon.ask4prayers.com"),el("small",page+" / "+pageCount));
  sheet.append(pageFooter);packet.append(sheet);
  return pageFooter;
 };
 const letter=studentLetter("Congratulations on your Beacon nomination",record.studentName,[
  "Someone in your community had the opportunity to put a student forward for Beacon Scholars, and they thought of you. They took the time to tell us that your character, your promise, and the way you show up for others deserve to be recognized. That is a meaningful accomplishment. I hope you take a moment to be proud of it.",
  "Often, the choices that leave the deepest impression happen in ordinary moments. You keep a commitment when it would be easier to let it go. You make room for someone who feels left out. You keep learning and growing through a difficult season. Those choices can matter to people long before you realize anyone has noticed them.",
  "Your nomination means that someone noticed enough to put your name forward. There is real honor in being thought of that way. I hope this letter gives you something you can return to on a difficult day: someone saw good in you and believed it was worth telling us about.",
  "Thank you for the ways you are already making a difference. I am glad that we have the opportunity to celebrate your nomination."
 ],"With warm congratulations,",footer);
 letter.classList.add("nomination-page");
 letter.lastElementChild.replaceWith(el("footer",footer+" · beacon.ask4prayers.com · 1 / "+pageCount,"nomination-page-footer"));
 packet.append(letter);

 const about=addPage("What it means to be a Beacon Scholar",2);
 about.before(
  el("h3","Why Beacon exists"),
  el("p","Beacon Scholars is an honorary recognition program of The Prayer Project. We created it to recognize qualities that can be easy to overlook: integrity, perseverance, compassion, growth, and the willingness to use your abilities for the good of others. Students show those qualities at home, at school, at work, and in their communities. They deserve to be seen in all of those places."),
  el("p","Sometimes the clearest example of leadership is a student who notices what needs to be done and quietly does it. Sometimes perseverance looks like showing up again after a hard week. We consider how students treat people, what they have learned from the responsibilities they carry, and the kind of difference they hope to make."),
  el("h3","What the honor includes"),
  el("p","Beacon is an honorary distinction. This inaugural cycle carries no financial award. Each selected Scholar receives an official letter and certificate recognizing the character and promise that led to their selection. We want each student to have a lasting record of the qualities someone saw in them."),
  el("h3","Two students in the inaugural class"),
  el("p","Beacon Scholars is a new program, and only two students will be selected for our inaugural class. Every nomination is an honor in itself. The final selection identifies the two students who will receive the formal distinction this cycle.")
 );
 if(!includeFollowUp)return packet;

 const next=addPage("Continue your nomination",3);
 next.before(el("p","Your nomination is already your official entry. If you would like to continue, follow the steps below."));
 const steps=el("ol",undefined,"nomination-letter-steps");
 const instructions=[
  ...(record.nominationLetter?.nameLookup?[
   "Visit beacon.ask4prayers.com/#find-nomination and enter your name as it appears on this letter.",
   "Sign in or create your Beacon account with your own email and password. Verify your email and request a connection. The committee will confirm the connection before your nomination appears in My Dashboard."
  ]:[
   entryKey?"Visit beacon.ask4prayers.com/#claim. Sign in or create a student account and verify your email.":"Sign in to Beacon and open My Dashboard.",
   entryKey?"Enter the private Entry Key below to connect the nomination to your account.":"Open the nomination already linked to your account."
  ]),
  "In My Dashboard, open your nomination and add one academic reference and one character reference. Skip any reference already received.",
  "If you’re under 18, enter your parent or guardian’s name and email to request a consent form. They complete that form separately.",
  "Submit your follow-up and check My Dashboard for updates."
 ];
 instructions.forEach(instruction=>steps.append(el("li",instruction)));
 next.before(steps);
 if(entryKey){
  const expires=new Date(entryKey.expiresAt).toLocaleDateString("en-US",{dateStyle:"long",timeZone:"America/Chicago"});
  const key=el("div",undefined,"nomination-entry-key");
  key.append(el("strong","Your private Entry Key"),el("code",entryKey.key),el("small","Use by "+expires+". Keep this key private."));
  next.before(key);
 }
 next.before(
  el("h3","What happens next"),
  el("p","Beacon confirms eligibility and follows up with your references. For students under 18, the team also verifies parent or guardian consent. The selection decision follows that review.")
 );
 return packet;
}
function committeeLetterActions(record){
 if(!record.canManage)return null;
 const actions=el("div",undefined,"review-actions");
 if(record.status==="selected"){
  const button=el("button","Print congratulations letter","btn btn-outline");button.type="button";
  button.onclick=()=>printDocument(congratulationsLetter(record));
  const claim=el("button","Generate student account-claim invitation","btn btn-outline");
  claim.type="button";claim.onclick=()=>invitation(record.entryId,"scholar",null);
  actions.append(button,claim);
 }
 const active=!selectionFilesClosed(record.status);
 if(record.type==="nomination"||record.endorsementCount>0||record.endorsements?.length){
  const button=el("button","Print nomination letter","btn btn-outline");button.type="button";
  let entryKey=null;
  button.onclick=async()=>{
   button.disabled=true;
   try{
    if(active&&record.nominationLetter?.needsEntryKey&&(!entryKey||Date.parse(entryKey.expiresAt)<=Date.now())){
     const replace=record.nominationLetter.keyIssued&&!entryKey;
     if(replace&&!confirm("Create a new Entry Key? The key on the previous letter will stop working."))return;
     entryKey=await call("createNominationKey",{entryId:record.entryId,replace:!!replace});
    }
    if(active&&record.type==="nomination"&&!record.nominationLetter)
     throw Error("Deploy the updated Firebase Functions before printing a nomination letter with an Entry Key.");
    const needsFollowUp=active&&record.type==="nomination"&&record.nominationLetter&&!record.nominationLetter.followUpRequested;
    printDocument(nominationLetter(record,entryKey,needsFollowUp));
   }catch(error){notify(readable(error));}
   finally{button.disabled=false;}
  };
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
const nominationLookupForm=$("nomination-lookup-form"),nominationConnectionForm=$("nomination-connection-form");
const nominationLookupResult=$("nomination-lookup-result");
let nominationLookupName="",nominationConnectionUid=null;
function refreshNominationLookup(){
 const enabled=settings.nominationNameLookup===true,signed=accountNeeded();
 const matched=enabled&&!!nominationLookupName;
 const connected=matched&&!!nominationConnectionUid&&nominationConnectionUid===currentUser?.uid;
 $("nomination-lookup-unavailable").hidden=enabled;
 nominationLookupForm.hidden=!enabled;
 $("nomination-lookup-account").hidden=!matched||signed;
 nominationConnectionForm.hidden=!matched||!signed||connected;
 $("nomination-lookup-dashboard").hidden=!connected;
}
nominationLookupForm.addEventListener("input",()=>{
 nominationLookupName="";nominationConnectionUid=null;nominationLookupResult.hidden=true;refreshNominationLookup();
});
nominationLookupForm.addEventListener("submit",async e=>{
 e.preventDefault();
 const button=nominationLookupForm.querySelector("button"),name=nominationLookupForm.elements.studentName.value.trim();
 if(button.disabled||settings.nominationNameLookup!==true)return;
 button.disabled=true;nominationLookupName="";nominationConnectionUid=null;refreshNominationLookup();
 nominationLookupResult.hidden=false;nominationLookupResult.textContent="Checking for a nomination…";
 try{
  if(!auth.currentUser)await signInAnonymously(auth);
  const {found}=await call("findNominationByName",{studentName:name});
  if(nominationLookupForm.elements.studentName.value.trim()!==name)return;
  if(found)nominationLookupName=name;
  nominationLookupResult.textContent=found
   ?"A nomination was found. Use the options below to request a connection to your Beacon account."
   :"No active nomination matched that name. Check the spelling or contact Beacon for help.";
 }catch(error){nominationLookupResult.textContent=readable(error);}
 finally{button.disabled=false;refreshNominationLookup();}
});
nominationConnectionForm.addEventListener("submit",async e=>{
 e.preventDefault();
 const button=nominationConnectionForm.querySelector("button"),name=nominationLookupName,uid=currentUser?.uid;
 if(button.disabled||!name||!accountNeeded())return;
 button.disabled=true;
 const fields=new FormData(nominationConnectionForm);
 try{
  await verifiedEmail();
  if(auth.currentUser?.uid!==uid||nominationLookupName!==name)return;
  const {linked}=await call("requestNominationConnection",{studentName:name,school:fields.get("school"),grade:fields.get("grade")});
  if(auth.currentUser?.uid!==uid||nominationLookupName!==name)return;
  nominationConnectionUid=uid;
  nominationLookupResult.textContent=linked?"Your nomination is available in My Dashboard."
   :"Your request is in Processing. The committee will confirm your account before your nomination appears in My Dashboard.";
 }catch(error){nominationLookupResult.textContent=readable(error);}
 finally{button.disabled=false;refreshNominationLookup();}
});
async function loadClaim(){
 const info=$("claim-info"),form=$("claim-form"),token=inviteToken;
 const signed=accountNeeded(),keyInput=form.elements.entryKey;
 $("claim-error").hidden=true;
 $("claim-account-link").hidden=signed;
 form.hidden=!signed;
 $("entry-key-field").hidden=!!token;
 keyInput.required=!token;
 info.textContent=signed?"Enter the Entry Key printed on your nomination letter.":"Sign in or create an account, then return here to enter your private Entry Key.";
 if(!token)return;
 try{
  const result=await call("getInvitation",{token});
  if(inviteToken!==token||!location.hash.startsWith("#claim/"))return;
  if(result.kind!=="scholar")throw Error("This invitation is not for a student account.");
  info.textContent="Beacon invited "+result.recipientName+" to connect a record. Use the verified email address that received the invitation.";
 }catch(err){
  if(inviteToken===token&&location.hash.startsWith("#claim/")){info.textContent=readable(err);form.hidden=true;}
 }
}
$("claim-form").addEventListener("submit",async event=>{
 event.preventDefault();
 if(!accountNeeded())return;
 const form=event.currentTarget,button=$("claim-now"),error=$("claim-error");
 if(button.disabled)return;
 const payload=inviteToken?{token:inviteToken}:{entryKey:form.elements.entryKey.value};
 button.disabled=true;error.hidden=true;
 try{
  await verifiedEmail();
  const result=await call("claimNomination",payload);
  form.reset();
  history.replaceState(null,"",location.pathname+"#dashboard");
  notify("Nomination connected. Add your references and request guardian consent if you’re under 18.");
  route(result.entryId);
 }catch(e){error.textContent=readable(e);error.hidden=false;}
 finally{button.disabled=false;}
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

const selectionStages=processing=>[processing?"processing":"submitted","screening","under_review","finalist","selected"];
const selectionFilesClosed=status=>["selected","not_selected","merged","withdrawn"].includes(status);
function renderIntakeControls(program){
 const panel=workspaceCard("Applications and nominations");
 const status=el("p");status.setAttribute("role","status");
 const error=el("p",undefined,"intake-error");error.setAttribute("role","alert");error.hidden=true;
 const toggle=el("button",undefined,"btn btn-outline");toggle.type="button";
 const header=el("div",undefined,"workspace-card-heading");
 header.append(status,toggle);panel.append(header,error);
 const deadlineAvailable=Object.hasOwn(program,"intakeDeadline");
 const form=el("form",undefined,"entry-form deadline-form");
 const field=el("label","Intake deadline");
 const input=el("input");input.type="date";input.min="2000-01-01";input.max="9999-12-31";input.required=true;
 field.append(input);
 const actions=el("div",undefined,"workspace-actions");
 const save=el("button","Save deadline","btn btn-gold");save.type="submit";
 const clear=el("button","Remove deadline","btn btn-outline");clear.type="button";
 actions.append(save,clear);form.append(field,actions);
 const deadline=el("p",undefined,"help");
 if(deadlineAvailable)panel.append(form,deadline,el("p","Applications and nominations share this date. You can close intake early with the manual switch. Follow-up on submitted entries stays available.","help"));
 const render=()=>{
  const manuallyOpen=program.intakeManuallyOpen??program.intakeOpen;
  status.textContent=program.intakeOpen?"Open for the Class of "+program.cycle+".":program.deadlinePassed?"Closed. The intake deadline has passed.":"Manually closed for the Class of "+program.cycle+".";
  toggle.textContent=manuallyOpen?"Close intake manually":"Open intake manually";
  toggle.disabled=!manuallyOpen&&!!program.deadlinePassed;
  input.value=program.intakeDeadline||"";
  deadline.textContent=deadlineLine(program)||"No deadline is set. The manual switch controls intake.";
  clear.disabled=!program.intakeDeadline;
 };
 const saveSettings=async data=>{
  toggle.disabled=save.disabled=clear.disabled=input.disabled=true;error.hidden=true;
  try{
   program=await call("setIntakeStatus",data);
   updateIntakeStatus(program);
   panel.closest("details")?.querySelector("summary")?.replaceChildren("Intake settings · "+(program.intakeOpen?"Open":"Closed"));
   notify("Intake settings saved.");
  }catch(e){error.textContent=readable(e);error.hidden=false;}
  finally{save.disabled=input.disabled=false;render();}
 };
 toggle.onclick=()=>saveSettings({intakeOpen:!(program.intakeManuallyOpen??program.intakeOpen)});
 form.onsubmit=e=>{e.preventDefault();saveSettings({intakeDeadline:input.value});};
 clear.onclick=()=>saveSettings({intakeDeadline:null});
 render();
 return panel;
}


const csvNominationFields=[
 ["studentName","Student full name",["student name","nominee name","nominee","name of student","name of nominee","student full name","full name of nominee","candidate name","student","name"]],
 ["studentFirstName","Student first name",["student first name","nominee first name","first name"]],
 ["studentLastName","Student last name",["student last name","nominee last name","last name"]],
 ["personalStatement","Nomination / reason",["nomination statement","nomination message","nomination","reason for nomination","why are you nominating this student","why do you recommend this student","why should this student be nominated","tell us why","why nominate","explanation","reason","message","student description","describe this student","comments"]],
 ["school","School",["school","school name","high school","high school name","student school","school attended"]],
 ["grade","Grade",["grade","grade level","student grade","current grade"]],
 ["graduationYear","Graduation year",["graduation year","grad year","class year","year of graduation","expected graduation"]],
 ["state","State",["state","student state"]],
 ["applicantEmail","Student email",["student email","nominee email","applicant email","student email address"]],
 ["nominatorName","Nominator name",["nominator name","submitted by","your name","name of nominator","sender name","from name","nominated by"]],
 ["nominatorEmail","Nominator email",["nominator email","your email","sender email","from email","nominator email address","email of nominator"]],
 ["relationship","Nominator relationship",["relationship","relationship to student","how do you know the student","nominator relationship"]],
 ["nominatorMessage","Additional nominator message",["nominator note","nominator message","additional nominator message"]],
 ["ageBand","Under 18?",["under 18","is student under 18","minor","age band","student age"]],
 ["gpa","Unweighted GPA",["gpa","unweighted gpa","student gpa"]],
 ["futureGoals","Future plans",["future goals","future plans","career goals","plans for future"]],
 ["activities","Activities",["activities","leadership","clubs and activities"]],
 ["service","Community service",["community service","service","volunteering"]],
 ["guardianName","Guardian name",["guardian name","parent name","parent or guardian name"]],
 ["guardianEmail","Guardian email",["guardian email","parent email","parent or guardian email"]],
 ["sourceReceivedAt","Date received",["date received","received at","received date","submission date","timestamp","date"]]
];
const csvPostalFields=[
 ["postalRecipient","Mailing Addressee",["mailing addressee","mailing recipient"]],
 ["postalLine1","Mailing Address",["mailing address","mailing address line 1","street address","address line 1","po box"]],
 ["postalLine2","Mailing Address Line 2",["mailing address line 2","mailing unit"]],
 ["postalCity","Mailing City",["mailing city","postal city"]],
 ["postalState","Mailing State",["mailing state","postal state"]],
 ["postalZip","Mailing ZIP",["mailing zip","mailing zip code","mailing postal code"]]
];
const csvKey=s=>String(s||"").toLowerCase().trim().replace(/[^a-z0-9]/g,"");
function parseNominationCsv(raw){
 const text=String(raw||"").replace(/^\uFEFF/,"");
 const rows=[];let row=[],cell="",quoted=false,afterQuote=false;
 const endCell=()=>{row.push(cell.trim());cell="";afterQuote=false;};
 const endRow=()=>{endCell();if(row.some(value=>value!==""))rows.push(row);row=[];};
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){
   if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}
   else if(c==='"'){quoted=false;afterQuote=true;}
   else cell+=c;
  }else if(c==='"'&&!cell.trim()&&!afterQuote){quoted=true;cell="";}
  else if((c===","||c==="\n"||c==="\r")&&!quoted){
   if(c===",")endCell();else{if(c==="\r"&&text[i+1]==="\n")i++;endRow();}
  }else if(afterQuote){
   if(!/\s/.test(c))throw Error("Unexpected characters after a quoted CSV value.");
  }else cell+=c;
 }
 if(quoted)throw Error("An opening CSV quote is missing its closing quote.");
 if(cell||row.length)endRow();
 if(rows.length<2)throw Error("The CSV needs a header row and at least one nomination.");
 if(rows[0].length>75)throw Error("The CSV has too many columns (maximum 75).");
 if(rows.length>301)throw Error("Upload at most 300 nominations per CSV file.");
 const headers=rows.shift().map((h,i)=>h||"Column "+(i+1));
 for(const [i,r] of rows.entries()){
  if(r.length!==headers.length)throw Error("CSV record "+(i+2)+" has "+r.length+" columns; the header has "+headers.length+". Check for an unquoted comma or newline.");
 }
 return {headers,records:rows};
}
function csvNominationTemplate(postalEnabled){
 const headers=["Student Name","Nomination Statement","School","Grade","Graduation Year","Nominator Name","Nominator Email","Nominator Relationship","Student Email","Under 18","GPA","Future Goals","Community Service","Date Received",
  ...(postalEnabled?csvPostalFields.map(([,label])=>label):[])];
 const blob=new Blob(["\uFEFF"+headers.join(",")+"\r\n"],{type:"text/csv;charset=utf-8"});
 const url=URL.createObjectURL(blob),link=document.createElement("a");
 link.href=url;link.download="beacon-nominations-template.csv";
 document.body.append(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function csvGrade(value){
 const raw=String(value||"").trim().toLowerCase();
 const match=raw.match(/^(9|10|11|12)(?:st|nd|rd|th)?(?:\s*grade)?$/);
 return match?match[1]:({freshman:"9",sophomore:"10",junior:"11",senior:"12"}[raw]||raw);
}
function csvAgeBand(value){
 const raw=String(value||"").trim().toLowerCase();
 if(!raw)return "";
 if(["yes","y","true","under 18","minor","underage"].includes(raw))return "minor";
 if(["no","n","false","adult","18+","18 or older"].includes(raw))return "adult";
 const age=Number(raw);
 if(Number.isInteger(age)&&age>=13&&age<=120)return age<18?"minor":"adult";
 return raw;
}
function renderNominationCsvImport(postalEnabled){
 const csvFields=postalEnabled?[...csvNominationFields,...csvPostalFields]:csvNominationFields;
 const outer=el("details",undefined,"workspace-card committee-import");
 outer.append(el("summary","Bulk import · emailed nominations (CSV)"));
 const content=el("div",undefined,"committee-import-content");
 content.append(
  el("p","Upload a CSV exported from your email, spreadsheet, or nomination form. Each valid row becomes its own confidential nomination in the selection queue. No email is automatically sent and no missing eligibility, reference or guardian details are treated as verified.","help")
 );
 const toolbar=el("div",undefined,"workspace-actions");
 const label=el("label","Select a CSV file");
 const picker=el("input");picker.type="file";picker.accept=".csv,text/csv";picker.setAttribute("aria-label","Choose nomination CSV file");
 label.append(picker);
 const template=el("button","Download CSV template","btn btn-outline");template.type="button";template.onclick=()=>csvNominationTemplate(postalEnabled);
 toolbar.append(label,template);content.append(toolbar);
 const message=el("p","Select a CSV to preview nominations.","help");
 message.setAttribute("role","status");
 const mapDetails=el("details",undefined,"committee-import-mapping");
 mapDetails.hidden=true;mapDetails.append(el("summary","Adjust column mapping"));
 const mappingGrid=el("div",undefined,"field-grid committee-import-fields");
 mapDetails.append(mappingGrid);
 const preview=el("div",undefined,"committee-import-preview");
 const send=el("button","Import nominations","btn btn-gold");send.type="button";send.disabled=true;
 const result=el("div",undefined,"committee-import-result");result.setAttribute("role","status");
 const actions=el("div",undefined,"workspace-actions");
 actions.append(send);content.append(message,mapDetails,preview,actions,result);outer.append(content);
 let filename="",headers=[],records=[],mapping={},busy=false;
 const readField=(row,key)=>Number.isInteger(mapping[key])&&mapping[key]>=0?String(row[mapping[key]]||"").trim():"";
 const mappedRows=()=>{
  const seen=new Set();
  return records.map((record,index)=>{
   const values={rowNumber:index+2};
   for(const [key] of csvNominationFields){
    if(key!=="studentFirstName"&&key!=="studentLastName")values[key]=readField(record,key);
   }
   if(!values.studentName)values.studentName=[readField(record,"studentFirstName"),readField(record,"studentLastName")].filter(Boolean).join(" ");
   values.grade=csvGrade(values.grade);
   values.ageBand=csvAgeBand(values.ageBand);
   const issues=[];
   if(postalEnabled){
    const address=readNominationAddress(key=>readField(record,key));
    if(address)values.nominationAddress=address;
    if(!validNominationAddress(address))issues.push(nominationAddressError);
   }
   if(values.studentName.length<3)issues.push("Student name missing or too short");
   if(values.personalStatement.length<15)issues.push("Nomination reason must have at least 15 characters");
   if(values.grade&&!["9","10","11","12"].includes(values.grade))issues.push("Grade is invalid");
   if(values.graduationYear&&(!/^\d{4}$/.test(values.graduationYear)||Number(values.graduationYear)<2026||Number(values.graduationYear)>2040))issues.push("Graduation year is invalid");
   if(values.ageBand&&!["minor","adult"].includes(values.ageBand))issues.push("Under 18 value is invalid");
   if(values.gpa&&(!Number.isFinite(Number(values.gpa))||Number(values.gpa)<0||Number(values.gpa)>4))issues.push("GPA is invalid");
   for(const key of ["nominatorEmail","applicantEmail","guardianEmail"]){
    if(values[key]&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values[key]))issues.push(key+" is not a valid email");
   }
   const fp=[values.studentName,values.school,values.personalStatement,values.nominatorEmail,values.nominatorName]
    .map(s=>s.toLowerCase().replace(/\s+/g," ").trim()).join("|");
   if(!issues.length&&seen.has(fp))issues.push("Repeated identical nomination within this CSV");
   if(!issues.length)seen.add(fp);
   const incomplete=["school","grade","graduationYear"].filter(key=>!values[key]).length;
   return {values,issues,incomplete};
  });
 };
 const updatePreview=()=>{
  preview.replaceChildren();result.replaceChildren();
  if(!headers.length){send.disabled=true;return;}
  const rows=mappedRows(),valid=rows.filter(r=>!r.issues.length),invalid=rows.length-valid.length;
  message.textContent=filename+" · "+rows.length+" records · "+valid.length+" ready · "+invalid+" need correction or removal. "+
   "Rows without school, grade or graduation year may still be imported for later eligibility screening.";
  const tableWrap=el("div",undefined,"committee-import-table-wrap");
  const table=el("table",undefined,"committee-import-table");
  const head=el("thead"),headRow=el("tr");
  for(const heading of ["CSV row","Student","Nomination","School / grade","Readiness"])headRow.append(el("th",heading));
  head.append(headRow);table.append(head);
  const body=el("tbody");
  for(const row of rows.slice(0,15)){
   const tr=el("tr");
   tr.append(el("td",String(row.values.rowNumber)),el("td",row.values.studentName||"—"),
    el("td",row.values.personalStatement.slice(0,120)+(row.values.personalStatement.length>120?"…":"")),
    el("td",[row.values.school,row.values.grade].filter(Boolean).join(" · ")||"To verify"),
    el("td",row.issues.length?row.issues.join("; "):row.incomplete?"Ready · eligibility details pending":"Ready"));
   if(row.issues.length)tr.dataset.state="invalid";
   body.append(tr);
  }
  table.append(body);tableWrap.append(table);preview.append(tableWrap);
  if(rows.length>15)preview.append(el("p","Showing 15 of "+rows.length+" records. All records are validated before import.","help"));
  send.textContent="Import "+valid.length+" nomination"+(valid.length===1?"":"s");
  send.disabled=busy||valid.length===0;
 };
 const renderMapping=()=>{
  mappingGrid.replaceChildren();
  for(const [key,title] of csvFields){
   const field=el("label",title);
   const select=el("select"),none=el("option","Not included");none.value="-1";select.append(none);
   headers.forEach((h,i)=>{const option=el("option",h);option.value=String(i);select.append(option);});
   select.value=String(mapping[key]??-1);
   select.onchange=()=>{mapping[key]=Number(select.value);updatePreview();};
   field.append(select);mappingGrid.append(field);
  }
 };
 picker.onchange=async()=>{
  if(busy)return;
  headers=[];records=[];mapping={};filename="";mapDetails.hidden=true;
  preview.replaceChildren();result.replaceChildren();send.disabled=true;
  const file=picker.files?.[0];
  if(!file){message.textContent="Select a CSV to preview nominations.";return;}
  if(file.size>2*1024*1024){message.textContent="CSV is too large. Use a file under 2 MB and up to 300 records.";return;}
  try{
   const parsed=parseNominationCsv(await file.text());
   filename=file.name.slice(0,120);headers=parsed.headers;records=parsed.records;
   const keys=headers.map(csvKey),used=new Set();
   for(const [key,,aliases] of csvFields){
    const i=keys.findIndex((v,j)=>!used.has(j)&&aliases.some(alias=>csvKey(alias)===v));
    mapping[key]=i;
    if(i>=0)used.add(i);
   }
   mapDetails.hidden=false;renderMapping();updatePreview();
  }catch(e){message.textContent="CSV error: "+e.message;}
 };
 send.onclick=async()=>{
  if(busy)return;
  const rows=mappedRows(),ready=rows.filter(row=>!row.issues.length).map(row=>row.values);
  if(!ready.length)return;
  if(!confirm("Import "+ready.length+" nominations into the Class of 2027 selection queue? Each will be a separate unverified nomination record."))return;
  busy=true;send.disabled=true;picker.disabled=true;result.replaceChildren();
  const details=el("details",undefined,"committee-import-report");
  const detailBody=el("div",undefined,"committee-import-report-rows");
  const counts={created:0,duplicate:0,invalid:0};
  let processed=0,error=null;
  for(let offset=0;offset<ready.length;offset+=20){
   const chunk=ready.slice(offset,offset+20);
   message.textContent="Importing nominations "+(offset+1)+"–"+Math.min(offset+20,ready.length)+" of "+ready.length+"…";
   try{
    const response=await call("importNominations",{sourceFile:filename,rows:chunk});
    for(const item of response.results||[]){
     if(Object.hasOwn(counts,item.status))counts[item.status]++;
     const report=el("p","Row "+item.rowNumber+" · "+item.status+
      (item.entryId?" · "+item.entryId:"")+(item.message?" · "+item.message:""));
     if(item.status==="invalid")report.classList.add("danger-text");
     detailBody.append(report);
    }
    processed+=chunk.length;
   }catch(e){
    error=readable(e);
    break;
   }
  }
  result.append(el("h3","Import result"));
  result.append(el("p",counts.created+" created · "+counts.duplicate+" already imported · "+counts.invalid+" rejected"+
   (error?" · Import stopped after "+processed+" rows":"")+"."));
  if(error)result.append(el("p","Import stopped: "+error,"danger-text"));
  if(detailBody.childElementCount){
   details.append(el("summary","View row-by-row results"),detailBody);result.append(details);
  }
  if(counts.created) {
   const refresh=el("button","Refresh selection queue","btn btn-outline");
   refresh.type="button";refresh.onclick=()=>showCommittee(true);
   result.append(refresh);
  }
  message.textContent=filename+" · "+ready.length+" valid records prepared. "+
   (error?"Fix the error and retry; successfully imported records will be skipped automatically.":"Import complete. Uploading the same nominations again will not create duplicates.");
  busy=false;picker.disabled=false;updatePreview();
  // updatePreview clears result; retain the completed report.
  result.append(el("p",counts.created+" new nominations were created. "+counts.duplicate+" were duplicates and "+counts.invalid+" were rejected."));
  if(error)result.append(el("p",error,"danger-text"));
  if(counts.created){
   const link=el("button","Refresh selection queue","btn btn-outline");
   link.type="button";link.onclick=()=>showCommittee(true);
   result.append(link);
  }
  if(detailBody.childElementCount){const report=el("details",undefined,"committee-import-report");report.append(el("summary","Row-by-row results"),detailBody);result.append(report);}
 };
 return outer;
}

const needsNominationDelivery=route=>route==="ask_nominator"||route==="missing";
let queueStage="all",queueSearch="",queueType="all",queueWork="all",queuePages=1;
const reviewDrafts=new Map();
async function showCommittee(focusQueue=false){
 const box=$("committee-content"),detail=$("review-detail");
 const request=++reviewRequest;
 box.hidden=false;detail.hidden=true;detail.replaceChildren();box.textContent="Checking access…";
 if(!accountNeeded()){
  const gate=workspaceCard("Committee sign-in","Use your authorized reviewer or administrator account.");
  gate.append(workspaceLink("Sign in","#account/committee","btn-gold"));box.replaceChildren(gate);return;
 }
 const uid=currentUser.uid;
 const stillHere=()=>request===reviewRequest&&currentUser?.uid===uid&&location.hash==="#committee";
 try{
  const result=await call("listReviewQueue");
  if(!stillHere())return;
  box.replaceChildren();
  if(result.intake){
   const intake=el("details",undefined,"workspace-card committee-settings");
   intake.append(el("summary","Intake settings · "+(result.intake.intakeOpen?"Open":"Closed")),renderIntakeControls(result.intake));
   box.append(intake);
   box.append(renderNominationCsvImport(result.intake.nominationPostalDelivery===true));
  }
  const entries=[...(result.entries||[])];
  let cursor=result.nextCursor;
  let pages=1;
  async function nextPage(){
   const next=await call("listReviewQueue",{cursor});
   if(!stillHere())return;
   const seen=new Set(entries.map(item=>item.entryId));
   entries.push(...next.entries.filter(item=>!seen.has(item.entryId)));
   cursor=next.nextCursor;
   pages++;
  }
  while(cursor&&pages<queuePages&&stillHere())await nextPage();
  if(!stillHere())return;
  const queue=workspaceCard("Selection queue");
  const connectionHelp=el("div",undefined,"committee-account-banner");
  const connectionDescription=el("div");
  connectionDescription.append(el("strong","New and previous entries can be processed."),
   el("p","Connect nominees to existing student accounts or approve new requests. Older screening, review and final-decision records keep their original status and evaluations."));
  const connectionButton=el("button","Show entries needing account processing","btn btn-outline");
  connectionButton.type="button";
  connectionButton.onclick=()=>{queueWork="account_connection";work.value=queueWork;render();};
  connectionHelp.append(connectionDescription,connectionButton);
  queue.append(connectionHelp);
  const stageTabs=el("div",undefined,"committee-stages");
  stageTabs.setAttribute("role","group");
  stageTabs.setAttribute("aria-label","Selection stage");
  const stages=[["all","All entries"],...selectionStages(result.accountProcessing).map(stage=>[stage,statusText(stage)]),["closed","Closed files"]];
  const matchesStage=(item,stage)=>stage==="all"||item.status===stage||
   (stage==="processing"&&item.status==="submitted")||
   (stage==="closed"&&selectionFilesClosed(item.status)&&item.status!=="selected");
  const buttons=new Map();
  for(const [value,label] of stages){
   const button=el("button",undefined,"committee-stage");button.type="button";
   const count=el("strong");
   button.append(el("span",label),count);
   button.onclick=()=>{queueStage=value;render();};
   stageTabs.append(button);buttons.set(value,{button,count});
  }
  if(!result.personalReviewQueue||(!result.intake&&queueWork==="letter_contact"))queueWork="all";
  const filters=el("div",undefined,"field-grid queue-filters");
  const searchField=el("label","Find an entry");
  const search=el("input");search.type="search";search.placeholder="Student name, school or entry ID";search.value=queueSearch;
  searchField.append(search);filters.append(searchField);
  const typeField=el("label","Entry type");
  const type=el("select");
  const workField=el("label","Review and follow-up");
  const work=el("select");
  for(const [control,options] of [[type,[["all","All entry types"],["self","Applications"],["nomination","Nominations"]]],
   [work,[["all","All review activity"],["account_connection","Needs account processing (new and older)"],["needs_review","Needs my evaluation"],["reviewed","I’ve evaluated"],["follow_up","Requirements pending"],
    ...(result.intake?[["letter_contact","Needs letter delivery route"]]:[])]]]){
   for(const [value,label] of options){
    const option=el("option",label);option.value=value;control.append(option);
   }
  }
  type.value=queueType;typeField.append(type);filters.append(typeField);
  work.value=queueWork;workField.append(work);if(result.personalReviewQueue)filters.append(workField);
  const list=el("div",undefined,"selection-results");
  const count=el("p",undefined,"help");count.setAttribute("role","status");
  const load=el("button","Load more entries","btn btn-outline");load.type="button";
  const refresh=el("button","Refresh queue","btn btn-outline");refresh.type="button";
  refresh.onclick=()=>showCommittee();
  const render=()=>{
   const term=queueSearch.trim().toLowerCase();
   const matching=entries.filter(item=>(queueType==="all"||item.type===queueType)&&
    (queueWork==="all"||(queueWork==="needs_review"&&!selectionFilesClosed(item.status)&&!item.myReviewSaved)||
     (queueWork==="account_connection"&&item.accountConnectionNeeded)||
     (queueWork==="reviewed"&&item.myReviewSaved)||(queueWork==="follow_up"&&!selectionFilesClosed(item.status)&&item.requirementsPending>0)||
     (queueWork==="letter_contact"&&needsNominationDelivery(item.nominationDelivery)))&&
    [item.studentName,item.entryId,item.school||""].some(value=>value.toLowerCase().includes(term)));
   const filtered=matching.filter(item=>matchesStage(item,queueStage));
   for(const [value,{button,count:total}] of buttons){
    button.setAttribute("aria-pressed",String(queueStage===value));
    total.textContent=String(matching.filter(item=>matchesStage(item,value)).length);
   }
   count.textContent=filtered.length+" shown · "+entries.length+" loaded";
   list.replaceChildren();
   if(!filtered.length)list.append(el("p",cursor?"No matches in the loaded entries. Load more to continue.":"No entries match this view.","muted"));
   for(const item of filtered){
    const row=entryRow(item,"Open selection file",()=>openReview(item.entryId),item.school);
    if(result.personalReviewQueue){
     const notes=[item.myReviewSaved?"Evaluation saved":!selectionFilesClosed(item.status)?"Your evaluation pending":""];
     if(!selectionFilesClosed(item.status)&&item.requirementsPending)
      notes.push(item.requirementsPending+" program requirement"+(item.requirementsPending===1?"":"s")+" pending");
     if(item.accountConnectionNeeded)notes.push(item.accountLinked?"Account confirmation needed":"Student account not connected");
     if(needsNominationDelivery(item.nominationDelivery))notes.push("Needs letter delivery route");
     if(notes.some(Boolean))row.firstElementChild.append(el("p",notes.filter(Boolean).join(" · "),"committee-row-detail"));
    }
    list.append(row);
   }
   load.hidden=!cursor;
  };
  search.oninput=()=>{queueSearch=search.value;render();};
  type.onchange=()=>{queueType=type.value;render();};
  work.onchange=()=>{queueWork=work.value;render();};
  load.onclick=async()=>{
   load.disabled=true;
   try{await nextPage();if(stillHere()){queuePages=pages;render();}}
   catch(e){notify(readable(e));}
   finally{load.disabled=false;}
  };
  const actions=el("div",undefined,"workspace-actions");actions.append(load,refresh);
  queue.append(stageTabs,filters,count,list,actions);box.append(queue);render();
  if(focusQueue){const heading=qs("h2",queue);heading.tabIndex=-1;heading.focus({preventScroll:true});}
 }catch(e){
  if(stillHere())box.replaceChildren(workspaceCard("Committee access",readable(e)));
 }
}
function reviewField(label,placeholder,rows,maxLength,value=""){
 const field=el("label",label,"workspace-field");
 const input=el("textarea");input.rows=rows;input.maxLength=maxLength;input.placeholder=placeholder;input.value=value;
 field.append(input);
 return {field,input};
}
const requirementLabels={
 follow_up:"Student nomination follow-up",
 eligibility:"Verified eligibility",
 references:"Two verified references",
 consent:"Verified guardian consent"
};
function recommendationText(value){
 return {select:"Recommend selection",decline:"Do not recommend",discuss:"Discuss further"}[value]||"Pending";
}
function pendingRequirements(entry){
 if(Array.isArray(entry.requirements))return entry.requirements;
 return [
  entry.nominationFollowUpNeeded?"follow_up":null,
  entry.verifiedEligibility?null:"eligibility",
  entry.referenceCount>=2?null:"references",
  entry.ageBand==="adult"||entry.guardianStatus==="verified"?null:"consent"
 ].filter(Boolean);
}
function renderSelectionStages(entry){
 const panel=workspaceCard("Selection stages");
 panel.id="review-stages";
 const stages=selectionStages(!!entry.accountProcessing);
 const index=stages.indexOf(entry.accountProcessing?.processing?"processing":entry.status);
 const progress=el("ol",undefined,"stage-track");
 for(const [i,stage] of stages.entries()){
  const item=el("li",statusText(stage));
  if(i<index)item.dataset.state="complete";
  if(i===index){item.dataset.state="current";item.setAttribute("aria-current","step");}
  progress.append(item);
 }
 panel.append(progress);
 if(entry.status==="finalist")panel.append(el("p","This student has advanced to the final round. Review the file before recording a final decision.","help"));
 if(entry.status==="not_selected"&&entry.finalistAt)panel.append(el("p","This student reached the finalist round.","help"));
 if(!entry.canManage)return panel;
 const actions=el("div",undefined,"workspace-actions");
 const moveButton=(label,toStatus,style,reason=()=>"",confirmation="")=>{
  const button=el("button",label,"btn "+style);button.type="button";
  button.onclick=()=>{
   const explanation=reason();
   if((entry.status==="selected"||entry.status==="not_selected")&&explanation.trim().length<5){
    notify("Enter a reason for reopening the decision.");
    return;
   }
   if(confirmation&&!confirm(confirmation))return;
   action("moveSelectionStage",{entryId:entry.entryId,fromStatus:entry.status,toStatus,reason:explanation},entry.entryId);
  };
  actions.append(button);
 };
 if(entry.status==="selected"||entry.status==="not_selected"){
  const previous=entry.status==="selected"?"finalist":entry.decisionFromStatus||(entry.verifiedEligibility?"under_review":"screening");
  const {field,input}=reviewField("Reason for reopening","Explain why this decision needs another review",2,600);
  panel.append(el("p",entry.status==="selected"
   ?"Reopening returns this student to Finalist and removes the active Scholar ID and Passport access until a new decision is recorded."
   :"Reopening returns this student to "+statusText(previous)+". Their prior evaluations remain in the file.","help"),field);
  moveButton("Reopen decision",previous,"btn-outline",()=>input.value,"Reopen the recorded decision for "+entry.studentName+"?");
 }else if(index>=0){
  if(index>0)moveButton("Move back to "+statusText(stages[index-1]),stages[index-1],"btn-outline");
  if(entry.status==="submitted"&&!entry.accountProcessing)moveButton("Start eligibility screening","screening","btn-gold");
  if(entry.status==="screening")panel.append(el("p","Open Eligibility & decision to verify eligibility and advance to committee review.","help"));
  if(entry.status==="under_review"){
   const remaining=pendingRequirements(entry);
   if(remaining.length){
    panel.append(el("p","Complete the outstanding items in the readiness checklist before advancing to Finalist.","help"));
   }else moveButton("Advance to Finalist","finalist","btn-gold",undefined,
    "Advance "+entry.studentName+" to Finalist? The student can see this status in their dashboard.");
  }
 }
 if(actions.childElementCount)panel.append(actions);
 return panel;
}

function renderAccountProcessing(entry){
 const account=entry.accountProcessing;
 if(!account||["merged","withdrawn"].includes(entry.status)||account.confirmed&&!account.processing)return null;
 const panel=workspaceCard(account.legacy?"Account processing · existing record":"Account processing");
 panel.classList.add("committee-account-panel");
 const older=account.legacy;
 if(older)panel.append(el("p","This entry was created before the Processing stage. You can connect or confirm its student account now without changing its selection status, existing reviews, or final decision.","callout"));
 else panel.append(el("p","Confirm who owns this student account. The student can complete nomination follow-up only after their account is linked.","help"));
 const confirmed=account.linked&&account.confirmed;
 if(confirmed){
  if(entry.nominationFollowUpNeeded){
   panel.append(el("p","Account confirmed. Waiting for the student to complete outstanding nomination details in My Dashboard.","help"));
  }else if(account.processing){
   const advance=el("button","Finish Processing → Eligibility screening","btn btn-gold");
   advance.type="button";advance.onclick=()=>action("processStudentAccount",{entryId:entry.entryId,mode:"advance"},entry.entryId);
   panel.append(advance);
  }
  return panel;
 }
 const verify=el("div",undefined,"workspace-subsection account-identity-check");
 verify.append(el("h3","Independent identity check"),
  el("p","Do not approve a match using only the student's name, school or grade entered in the lookup. Confirm identity independently with an authorized school contact, guardian, or an existing verified record. Do not enter ID numbers or other sensitive documents here.","help"));
 const methodLabel=el("label","How was the student's identity confirmed?");
 const method=el("select");method.required=true;
 for(const [value,label] of [["","Choose a verification method"],["school","Independent school confirmation"],["guardian","Parent/guardian confirmation"],["existing_records","Existing verified Beacon record"],["other","Other independently verified evidence"]]){
  const option=el("option",label);option.value=value;method.append(option);
 }
 methodLabel.append(method);
 const notesLabel=el("label","Brief verification notes (at least 12 characters)");
 const notes=el("textarea");notes.rows=3;notes.maxLength=600;notes.minLength=12;notes.required=true;
 notes.placeholder="Record how and when identity was confirmed, without recording sensitive documents.";
 notesLabel.append(notes);verify.append(methodLabel,notesLabel);
 panel.append(verify);
 const button=(label,mode,detail={})=>{
  const control=el("button",label,"btn btn-gold");control.type="button";
  control.onclick=async()=>{
   if(!method.value||notes.value.trim().length<12){
    notify("Choose an independent verification method and add notes of at least 12 characters.");
    (!method.value?method:notes).focus();return;
   }
   if(!confirm("Confirm that you independently verified this student and that this account belongs to them?"))return;
   control.disabled=true;
   try{
    await action("processStudentAccount",{
     entryId:entry.entryId,mode,verificationMethod:method.value,verificationNotes:notes.value,...detail
    },entry.entryId);
   }finally{control.disabled=false;}
  };
  return control;
 };
 if(account.linked){
  panel.append(el("p","This application or nomination already has a student account attached, but its identity connection has not yet been confirmed.","help"),
   button("Confirm attached student account","confirm"));
  return panel;
 }
 const requests=account.candidates||[],existing=account.existingAccounts||[];
 if(requests.length){
  panel.append(el("h3","Student name-lookup requests"),
   el("p","These students signed up using their own email and password and requested a connection. Verify each identity independently before approving.","help"));
  for(const candidate of requests){
   const card=el("div",undefined,"workspace-subsection account-match-card");
   card.append(el("strong",candidate.studentName),workspaceFacts([
    ["School entered",candidate.school||"Not supplied"],
    ["Grade entered",candidate.grade||"Not supplied"]
   ]),button("Approve this account request","link",{requestId:candidate.requestId}));
   panel.append(card);
  }
 }
 if(existing.length){
  panel.append(el("h3","Existing Beacon student accounts"),
   el("p","These accounts are already attached to prior student entries with the same name. Compare the records carefully; identical names alone are not proof of identity.","help"));
  for(const candidate of existing){
   const card=el("div",undefined,"workspace-subsection account-match-card");
   card.append(el("strong","Account from "+(candidate.type==="self"?"student application":"linked nomination")),
    workspaceFacts([
     ["School on record",candidate.school||"Not supplied"],
     ["Grade on record",candidate.grade||"Not supplied"],
     ["Existing entry stage",statusText(candidate.status)]
    ]),button("Link this existing account","link_existing",{sourceEntryId:candidate.sourceEntryId}));
   panel.append(card);
  }
 }
 if(!requests.length&&!existing.length)panel.append(
  el("p","No matching account request or existing student application is on file yet. The student can visit Check for a nomination, search by name, and sign in or create their own account.","help"),
  workspaceLink("Open public name lookup","#find-nomination"));
 return panel;
}

let reviewRequest=0;
async function openReview(entryId,section="overview"){
 const container=$("review-detail"),queue=$("committee-content");
 const request=++reviewRequest,uid=currentUser?.uid;
 queue.hidden=true;container.hidden=false;
 const back=el("button","← Selection queue","link-button workspace-back");back.type="button";
 back.onclick=()=>{showCommittee(true);$("committee-view").scrollIntoView({block:"start"});};
 container.replaceChildren(back,el("p","Loading selection file…","muted"));
 try{
  const result=await call("getReviewEntry",{entryId}),d=result.entry;
  if(request!==reviewRequest||currentUser?.uid!==uid||location.hash!=="#committee")return;
  container.replaceChildren(back);
  const core=workspaceCard(d.studentName);
  const summary=el("div",undefined,"workspace-card-heading");
  summary.append(el("p",entryType(d)+(d.grade?" · Grade "+d.grade:""),"muted"),statusBadge(d.status));
  core.append(summary);
  const files=el("div",undefined,"committee-file");
  files.id="committee-file";
  files.dataset.entryId=entryId;
  const letters=committeeLetterActions(d);
  if(letters)core.append(letters);
  const reviewSummary=d.reviewCount+" recorded"+(Number.isInteger(d.approveVotes)?" · "+d.approveVotes+" recommend selection":"");
  core.append(workspaceFacts([
   ["School",d.school||"—"],["Reported GPA",d.gpa??"Not reported"],["Committee reviews",reviewSummary],["Entry ID",d.entryId]
  ]));
  if(d.decisionMethod)core.append(infoRow("Decision method",d.decisionMethod==="founder"?"Founder review":"Committee review"));
  const overview=el("div",undefined,"workspace-stack");
  overview.id="review-overview";
  const closed=selectionFilesClosed(d.status);
  const account=renderAccountProcessing(d);
  if(account)overview.append(account);
  const letterRoute=d.nominationLetter?.delivery;
  const address=d.nominationLetter?.mailingAddress;
  if(letterRoute||address){
   const delivery=workspaceCard("Nomination letter delivery");
   if(d.applicantEmail)delivery.append(infoRow("Student email",d.applicantEmail));
   if(d.guardianEmail)delivery.append(infoRow("Parent or guardian email",d.guardianEmail));
   if(letterRoute==="nominator_handoff"||letterRoute==="ask_nominator")
    delivery.append(infoRow("Nominator email",d.nominator.email));
   if(address){
    const postal=el("p");
    postal.append(el("strong","Mailing address"));
    for(const line of [address.recipient||d.studentName,address.line1,address.line2,address.city+", "+address.state+" "+address.zip].filter(Boolean))
     postal.append(el("br"),document.createTextNode(line));
    delivery.append(postal);
   }
   const guidance={
    student_email:"Confirm the email address before sending the student’s nomination letter.",
    guardian_email:"Confirm the address before sending the letter privately to the parent or guardian for the student.",
    postal_mail:"Use Print nomination letter, then mail it in a sealed envelope to the address above.",
    nominator_handoff:"The nominator can pass along the letter. Arrange a sealed handoff to the student or guardian and honor the nominator’s privacy preference.",
    ask_nominator:"Ask the nominator for an email or mailing address they can share, or confirm a private handoff in Student details.",
    missing:"No delivery route is on file. Add a confirmed email or mailing address in Student details."
   };
   if(guidance[letterRoute])delivery.append(el("p",guidance[letterRoute],needsNominationDelivery(letterRoute)?"callout":"help"));
   overview.append(delivery);
  }
  if(d.selectionStages)overview.append(renderSelectionStages(d));
  if(!closed){
   const readiness=workspaceCard("Readiness checklist");
   const list=el("ul",undefined,"committee-checklist");
   const missing=pendingRequirements(d);
   for(const [code,label] of Object.entries(requirementLabels)){
    if(code==="follow_up"&&!missing.includes(code)&&!d.nominationLetter?.followUpRequested)continue;
    const item=el("li");
    const incomplete=missing.includes(code);
    item.append(el("strong",label),el("span",incomplete?"Pending":code==="consent"&&d.ageBand==="adult"?"Not required":"Complete",
     incomplete?"check-pending":"check-complete"));
    list.append(item);
   }
   readiness.append(list);
   overview.append(readiness);
  }
  const storyCard=workspaceCard("Student story");
  storyCard.id="review-story";
  const story=el("div",undefined,"review-story");
  for(const [key,label] of [["personalStatement","Essay or nomination"],["academicInterests","Academic interests"],["futureGoals","Future goals"],["service","Community service"],["activities","Leadership and activities"],["responsibilities","Responsibilities and personal growth"],["additionalInfo","Additional context"]]){
   if(d[key])story.append(el("h3",label),el("p",d[key]));
  }
  if(d.canManage&&d.nominationLetter?.followUpRequested)
   core.append(el("p",d.nominationLetter.formsQueued
    ?"Student follow-up received. Outstanding form emails were queued."
    :"Student follow-up received. Use References and consent to issue any outstanding forms.","callout"));
  if(story.childElementCount)storyCard.append(story);
  else storyCard.append(el("p","No statement is on file.","help"));
  if(d.duplicateCount>1){core.append(el("p","Potential duplicate entries: "+d.duplicateCount+" records share the same student name, school and graduation year. Review without assuming they are duplicates.","callout"));}
  if((d.endorsements||[]).length){
   storyCard.append(el("h3","Supporting nominations ("+d.endorsements.length+")"));
   for(const endorsement of d.endorsements){
    storyCard.append(el("p",endorsement.statement));
    if(endorsement.nominator?.name)storyCard.append(el("p","Confidential nominator (admin): "+endorsement.nominator.name,"help"));
   }
  }
  if(d.nominator){core.append(el("h3","Confidential nominator identity — ADMIN ONLY"));core.append(infoRow("Name",d.nominator.name));core.append(infoRow("Email",d.nominator.email));}
  container.append(core,files);
  const refs=workspaceCard("References and consent");
  refs.id="review-references";
  refs.append(infoRow("Guardian consent",statusText(d.guardianStatus)));
  const referenceLabels=["Academic reference","Character reference"];
  for(const [slot,label] of referenceLabels.entries()){
   const response=(d.references||[]).find(item=>Number(item.slot??item.id)===slot);
   const contact=d.referenceSuggestions?.[slot];
   const card=el("details",undefined,"workspace-subsection committee-reference");
   const state=response?.verified?"Verified":response?"Response received":"Awaiting response";
   card.append(el("summary",label+" · "+state));
   if(contact?.name||contact?.email)card.append(infoRow("Contact",[contact.name,contact.email].filter(Boolean).join(" · ")));
   if(response?.fullName)card.append(infoRow("Responded as",response.fullName));
   for(const [i,answer] of (response?.answers||[]).entries())card.append(el("p",prompts[i],"help"),el("p",answer));
   if(!response)card.append(el("p","No response is on file.","help"));
   if(d.canManage&&!closed){
    if(response?.verified){
     const {field,input:reason}=reviewField("Reason for invalidation","Explain why this reference is being invalidated",2,600);
     const revoke=el("button","Invalidate "+label.toLowerCase(),"btn btn-outline");
     revoke.type="button";
     revoke.onclick=()=>action("invalidateReference",{entryId,slot,reason:reason.value},entryId);
     card.append(field,revoke);
    }else{
     const actions=el("div",undefined,"workspace-actions");
     if(response){
      const verify=el("button","Confirm reference identity and verify","btn btn-gold");
      verify.type="button";
      verify.onclick=()=>action("verifyRequirement",{entryId,kind:"reference",slot},entryId);
      actions.append(verify);
     }
     if(contact?.email){
      const invite=el("button",response?"Request a new response":"Invite "+label.toLowerCase(),"btn btn-outline");
      invite.type="button";invite.onclick=()=>invitation(entryId,"reference",slot);actions.append(invite);
     }else card.append(el("p","Add a reference email in Student details to send an invitation.","help"));
     if(actions.childElementCount)card.append(actions);
    }
   }
   refs.append(card);
  }
  files.append(refs);
  if(d.canManage&&!closed){
   const tools=el("div",undefined,"review-actions");
   if(d.ageBand!=="adult"&&d.guardianStatus!=="verified"&&d.guardianEmail){
    const guardian=el("button","Create guardian consent invitation","btn btn-outline");
    guardian.type="button";guardian.onclick=()=>invitation(entryId,"guardian",null);tools.append(guardian);
   }
   if(d.guardianStatus==="signed_pending_verification"){const verify=el("button","Verify guardian authorization","btn btn-outline");verify.type="button";verify.onclick=()=>action("verifyRequirement",{entryId,kind:"guardian"},entryId);tools.append(verify);}
   if(d.guardianStatus==="verified"||d.guardianStatus==="signed_pending_verification"){
    const {field,input:reason}=reviewField("Reason for consent withdrawal","Describe the guardian’s request",2,600);
    refs.append(field);
    const revoke=el("button","Record guardian consent withdrawal","btn btn-outline");revoke.type="button";
    revoke.onclick=()=>action("revokeGuardianConsent",{entryId,reason:reason.value},entryId);tools.append(revoke);
   }
   if(tools.childElementCount)refs.append(tools);
   const manage=workspaceCard("Student details and invitations");
   manage.id="review-student-details";
   manage.append(el("p","Use only confirmed information. Nominations can be submitted before the student's references or guardian contact information are available.","help"));
   if(d.importedUnverified)manage.append(el("p","This nomination was imported from emailed records. The submitter identity, eligibility, references and guardian authorization have not been verified. Complete the fields below before advancing to Finalist."+
    (d.importSource?" Source: "+d.importSource+".":"")+
    (d.sourceReceivedAt?" Original received: "+d.sourceReceivedAt+".":""),"callout"));
   const dataForm=el("form",undefined,"entry-form");
   dataForm.innerHTML='<div class="field-grid"><label>Student name <input name="studentName" maxlength="120" required></label><label>School <input name="school" maxlength="160"></label><label>Grade <select name="grade"><option value="">Unknown</option><option value="9">9</option><option value="10">10</option><option value="11">11</option><option value="12">12</option></select></label><label>Graduation year <input type="number" name="graduationYear" min="2026" max="2040" step="1"></label><label>Nominee contact email <input type="email" name="applicantEmail"></label><label>Guardian email <input type="email" name="guardianEmail"></label><label>Guardian name <input name="guardianName"></label><label>Student age band <select name="ageBand"><option value="">Unknown</option><option value="minor">Under 18</option><option value="adult">18 or older</option></select></label><label>Verified unweighted GPA <input type="number" min="0" max="4" step=".01" name="gpa"></label></div><p>Qualified references</p><div class="field-grid"><label>Academic reference name <input name="ref1Name"></label><label>Academic reference email <input type="email" name="ref1Email"></label><label>Character reference name <input name="ref2Name"></label><label>Character reference email <input type="email" name="ref2Email"></label></div><button class="btn btn-outline" type="submit">Save verified contact details</button>';
   for(const key of ["studentName","school","grade","graduationYear","applicantEmail","guardianEmail","guardianName","ageBand","gpa"])if(d[key]!==null&&d[key]!==undefined&&dataForm.elements[key])dataForm.elements[key].value=String(d[key]);
   const canConfirmHandoff=d.type==="nomination"&&!!d.nominator?.email;
   if(canConfirmHandoff){
    const field=el("label",undefined,"check-label");
    const input=el("input");input.type="checkbox";input.name="nominationHandoff";
    input.checked=d.nominationLetter?.nominatorHandoff===true;
    field.append(input,document.createTextNode(" The nominator confirmed they can deliver the nomination letter privately."));
    dataForm.firstElementChild.after(field);
   }
   const editPostal=Object.hasOwn(d.nominationLetter||{},"mailingAddress");
   const postalDetails=el("details",undefined,"intake-details");
   if(editPostal){
    postalDetails.open=!!address;
    postalDetails.append(el("summary","Nomination mailing address"),
     el("p","Use a confirmed U.S. address for the nomination letter. Clear all address fields to remove it.","help"),
     $("nomination-postal-fields").content.cloneNode(true));
    dataForm.firstElementChild.after(postalDetails);
    for(const part of postalParts)dataForm.elements[postalField(part)].value=address?.[part]||"";
   }
   (d.referenceSuggestions||[]).forEach((v,i)=>{const j=i+1;dataForm.elements["ref"+j+"Name"].value=v.name||"";dataForm.elements["ref"+j+"Email"].value=v.email||"";});
   dataForm.addEventListener("submit",async e=>{
    e.preventDefault();const f=new FormData(dataForm);
    const updatedAddress=editPostal?readNominationAddress(key=>f.get(key)):null;
    if(!validNominationAddress(updatedAddress)){
     postalDetails.open=true;
     notify(nominationAddressError);
     dataForm.elements[postalField("line1")].focus();
     return;
    }
    await action("updateEntryContacts",{entryId,fields:{
     studentName:f.get("studentName"),school:f.get("school"),grade:f.get("grade"),graduationYear:f.get("graduationYear"),
     applicantEmail:f.get("applicantEmail"),guardianEmail:f.get("guardianEmail"),guardianName:f.get("guardianName"),
     ageBand:f.get("ageBand"),gpa:f.get("gpa"),
     ...(canConfirmHandoff?{nominationHandoff:f.get("nominationHandoff")==="on"}:{}),
     ...(editPostal?{nominationAddress:updatedAddress}:{}),
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
   if(!d.accountProcessing){
    const claimBtn=el("button","Generate student account-claim invitation","btn btn-outline");
    claimBtn.type="button";claimBtn.onclick=()=>invitation(entryId,"scholar",null);invitations.append(claimBtn);
   }
   if(d.type==="nomination"&&d.nominator?.email){
    referenceLabels.forEach((label,slot)=>{
     const btn=el("button","Verify nominator as "+label.toLowerCase(),"btn btn-outline");btn.type="button";
     btn.onclick=()=>{if(confirm("I independently verified this nominator's identity and eligibility to serve as this reference."))action("useVerifiedNominatorReference",{entryId,slot,identityVerified:true},entryId);};
     invitations.append(btn);
    });
   }
   if(invitations.childElementCount)manage.append(invitations);
   files.append(manage);
  }
  const founderReview=(d.decisionReadiness?.method||(d.reviewCount<3?"founder":"committee"))==="founder";
  const control=workspaceCard("Independent evaluation",d.canManage&&founderReview
   ?"Score each criterion and save your recommendation. You can then use Founder review to finalize the same decision."
   :"Score each criterion and record your recommendation.");
  control.id="review-evaluation";
  const reviewForm=el("form",undefined,"entry-form");reviewForm.innerHTML=
  '<div class="rubric-grid">'+[
   ["character","Character & integrity",30],["perseverance","Perseverance & growth",25],["service","Service & compassion",20],["leadership","Leadership & initiative",15],["potential","Purpose & potential",10]
  ].map(([key,label,max])=>'<label>'+label+' / '+max+'<input type="number" name="'+key+'" min="0" max="'+max+'" required value="'+(Number.isInteger(d.myReview?.scores?.[key])?d.myReview.scores[key]:"")+'"></label>').join("")+
  '</div><label>Committee recommendation <select name="recommend"><option value="discuss">Discuss further</option><option value="select">Recommend selection</option><option value="decline">Do not recommend</option></select></label><label>Independent reviewer notes <textarea name="notes" rows="5" maxlength="2400"></textarea></label><button type="submit" class="btn btn-gold">Save evaluation</button>';
  reviewForm.elements.recommend.value=d.myReview?.recommend||"discuss";
  reviewForm.elements.notes.value=d.myReview?.notes||"";
  const draft=reviewDrafts.get(entryId);
  if(draft)for(const [name,value] of draft)reviewForm.elements[name].value=value;
  const scoreInputs=qsa('input[type="number"]',reviewForm);
  const savedLabel=d.myReview?.submittedAt?"Saved "+timestamp(d.myReview.submittedAt):"Evaluation saved";
  const evaluationStatus=el("p",draft?"Unsaved changes":d.myReview
   ?savedLabel+" · "+recommendationText(d.myReview.recommend):"No evaluation saved yet.","help");
  const total=el("output",undefined,"evaluation-total");
  function updateTotal(){
   total.textContent=scoreInputs.every(input=>input.value!==""&&input.validity.valid)
    ?"Total "+scoreInputs.reduce((sum,input)=>sum+input.valueAsNumber,0)+" / 100"
    :"Enter a score for each criterion to calculate the total.";
  }
  updateTotal();
  reviewForm.prepend(evaluationStatus,total);
  reviewForm.addEventListener("input",()=>{
   reviewDrafts.set(entryId,[...new FormData(reviewForm)]);
   updateTotal();evaluationStatus.textContent="Unsaved changes";
  });
  reviewForm.addEventListener("submit",async e=>{
   e.preventDefault();const f=new FormData(e.currentTarget),scores={};
   for(const key of ["character","perseverance","service","leadership","potential"])scores[key]=Number(f.get(key));
   await action("recordReview",{entryId,scores,recommend:f.get("recommend"),notes:f.get("notes")},entryId);
  });
  if(d.accountProcessing?.processing)control.append(el("p","Evaluations open after Processing is complete.","help"));
  else control.append(reviewForm);
  const recusal=el("details",undefined,"workspace-subsection");
  const {field:conflictField,input:conflict}=reviewField("Reason for recusal","Describe the conflict of interest",2,400);
  const recuse=el("button","Recuse myself from this entry","btn btn-outline");
  recuse.type="button";recuse.onclick=()=>{
   if(conflict.value.trim().length<5){notify("Provide a brief reason for recusal.");return;}
   if(confirm("Recuse yourself from this entry? It will leave your queue and your saved evaluation will be removed."))
    action("recuse",{entryId,reason:conflict.value},entryId);
  };
  recusal.append(el("summary","Conflict of interest"),conflictField,recuse);
  control.append(recusal);
  if(!closed)files.append(control);
  else if(d.myReview){
   const prior=workspaceCard("Your recorded evaluation");
   prior.id="review-evaluation";
   prior.append(workspaceFacts([["Score",d.myReview.total+" / 100"],["Recommendation",recommendationText(d.myReview.recommend)]]));
   if(d.myReview.notes)prior.append(el("p",d.myReview.notes));
   files.append(prior);
  }
  if(d.canManage&&!closed&&!d.accountProcessing?.processing){
   const adminTools=el("div",undefined,"workspace-columns");
   adminTools.id="review-admin-actions";
   const eligibility=workspaceCard("Eligibility");
   const {field:noteField,input:note}=reviewField("Verification notes","Record how eligibility was verified",3,1000,d.eligibilityNote||"");
   const eligibilityActions=el("div",undefined,"workspace-actions");
   const eligibilityChoices=d.selectionStages
    ?d.status==="screening"?[["Verify and advance to committee review",true]]:d.status==="submitted"?[]:[["Confirm eligibility",true]]
    :[["Mark eligible",true],["Return to screening",false]];
   if(!eligibilityChoices.length)eligibility.append(el("p","Start eligibility screening to verify this file.","help"));
   for(const [label,eligible] of eligibilityChoices){
    const btn=el("button",label,"btn btn-outline");btn.type="button";
    btn.onclick=()=>action("setEligibility",{entryId,fromStatus:d.status,eligible,notes:note.value},entryId);
    eligibilityActions.append(btn);
   }
   eligibility.append(noteField,eligibilityActions);
   const decisionCard=workspaceCard("Final decision",founderReview
    ?"Founder review is available while fewer than three evaluations are on file. Your saved recommendation must match the decision."
    :"Committee review requires three to five evaluations and two favorable recommendations for selection.");
   const {field:founderField,input:founder}=reviewField("Founder’s note (optional)","Write a message for the recognition letter",3,3400,d.founderNote||"");
   decisionCard.append(founderField);
   for(const [label,decision] of [["Approve Beacon Scholar","select"],["Finalize as not selected","decline"]]){
    const outcome=el("div",undefined,"committee-outcome");
    const reasons=d.decisionReadiness?.[decision]||[
     !d.verifiedEligibility?"Verify eligibility first.":null,
     decision==="select"&&d.selectionStages&&d.status!=="finalist"?"Advance this student to Finalist.":null,
     founderReview&&d.myReview?.recommend!==decision?"Save an evaluation with a matching recommendation.":null
    ].filter(Boolean);
    if(reasons.length){
     const list=el("ul",undefined,"help");
     for(const reason of reasons)list.append(el("li",reason));
     outcome.append(el("h3",decision==="select"?"Before selecting a Scholar":"Before closing as not selected"),list);
    }
    const button=el("button",label,decision==="select"?"btn btn-gold":"btn btn-outline");
    button.type="button";button.disabled=reasons.length>0;
    button.onclick=async()=>{
     const method=founderReview?"Founder review":"Committee review";
     if(confirm("Finalize this decision for "+d.studentName+" through "+method+"? This records the decision in the student’s dashboard."))
      await action("finalizeDecision",{entryId,fromStatus:d.status,decision,founderNote:founder.value,reviewMethod:founderReview?"founder":"committee"},entryId);
    };
    outcome.append(button);decisionCard.append(outcome);
   }
   adminTools.append(eligibility,decisionCard);
   files.append(adminTools);
  }
  files.prepend(overview,storyCard);
  const tabs=el("div",undefined,"review-shortcuts committee-file-tabs");
  tabs.setAttribute("aria-label","Selection file sections");tabs.setAttribute("role","group");
  const sections=[["overview","Overview",overview],["story","Student story",storyCard],["references","References & consent",refs],
   ["details","Student details",$("review-student-details")],["evaluation","Evaluation",$("review-evaluation")],
   ["decision","Eligibility & decision",$("review-admin-actions")]].filter(([, ,panel])=>panel);
  section=sections.some(([key])=>key===section)?section:"overview";
  const tabButtons=[];
  function selectSection(active){
   files.dataset.section=active;
   for(const {key,button,panel} of tabButtons){
    const selected=key===active;
    button.setAttribute("aria-pressed",String(selected));panel.hidden=!selected;
   }
  }
  for(const [key,label,panel] of sections){
   const button=el("button",label,"committee-file-tab");button.type="button";
   button.setAttribute("aria-controls",panel.id);
   button.onclick=()=>selectSection(key);
   tabs.append(button);tabButtons.push({key,button,panel});
  }
  files.prepend(tabs);
  selectSection(section);
  tabButtons.find(tab=>tab.key===section)?.button.focus({preventScroll:true});
  container.scrollIntoView({behavior:"instant",block:"start"});
 }catch(e){
  if(request===reviewRequest&&currentUser?.uid===uid)container.replaceChildren(back,workspaceCard("Selection file",readable(e)));
 }

}
async function action(name,payload,entryId){
 const request=reviewRequest;
 const section=$("committee-file")?.dataset.section;
 const button=document.activeElement;
 if(button instanceof HTMLButtonElement)button.disabled=true;
 try{
  const result=await call(name,payload);
  if(request!==reviewRequest||location.hash!=="#committee")return;
  if(name==="recordReview"||name==="recuse")reviewDrafts.delete(entryId);
  notify(result.publicId?"Scholar recognition created: "+result.publicId:
   result.status?"Moved to "+statusText(result.status)+".":"Changes saved.");
  if(name==="recuse"){notify("Recusal recorded. The file was removed from your queue.");await showCommittee();return;}
  const nextSection=name==="setEligibility"&&payload.fromStatus==="screening"?"overview":section;
  await openReview(entryId,nextSection);
 }catch(e){if(request===reviewRequest)notify(readable(e));}
 finally{if(button instanceof HTMLButtonElement)button.disabled=false;}
}
async function invitation(entryId,kind,slot){
 const request=reviewRequest;
 const button=document.activeElement;
 if(button instanceof HTMLButtonElement)button.disabled=true;
 try{
  const result=await call("createInvitation",{entryId,kind,slot});
  if(request!==reviewRequest||location.hash!=="#committee")return;
  let panel=$("private-invite-link");if(panel)panel.remove();
  panel=el("div",undefined,"review-card");panel.id="private-invite-link";
  panel.append(el("h3","Private invitation for "+result.recipientEmail));
  panel.append(el("p",result.queued?"An invitation email was queued. You can also copy the private link below.":"Copy this one-time link and deliver it privately to the intended email recipient. Automatic email is not enabled. Verify the recipient before approving.","help"));
  const input=el("input");input.readOnly=true;input.value=result.url;input.setAttribute("aria-label","Private invitation URL");input.style.width="100%";
  panel.append(input);
  const button=el("button","Copy invitation URL","btn btn-outline");button.type="button";
  button.onclick=async()=>{try{await navigator.clipboard.writeText(result.url);notify("Private link copied.");}catch{input.select();notify("Select and copy the link above.");}};
  panel.append(button);$("review-detail").prepend(panel);
  panel.scrollIntoView({behavior:"smooth",block:"start"});
 }catch(e){if(request===reviewRequest)notify(readable(e));}
 finally{if(button instanceof HTMLButtonElement)button.disabled=false;}
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
