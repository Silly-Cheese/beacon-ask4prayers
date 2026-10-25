import {auth,callable} from "./firebase.js";
import {
  onAuthStateChanged,signInWithEmailAndPassword,createUserWithEmailAndPassword,
  signInAnonymously,signOut,sendEmailVerification,sendPasswordResetEmail,reload
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
const $=id=>document.getElementById(id),qs=(s,root=document)=>root.querySelector(s),qsa=(s,root=document)=>[...root.querySelectorAll(s)];
const call=async(name,data={})=>(await callable(name)(data)).data;
const PAGE={home:"public-view",mission:"public-view",selection:"public-view",opportunities:"public-view",faq:"public-view",apply:"apply-view",nominate:"nominate-view",account:"account-view",dashboard:"dashboard-view",scholar:"scholar-view",committee:"committee-view",policy:"policy-view",reference:"reference-view",consent:"consent-view",claim:"claim-view",verify:"verify-view"};
let currentUser=null,settings={cycle:"2027",intakeOpen:false},step=0,draftLoadedFor=null,saveTimer=null,savingPromise=null,inviteToken=null,activeScholarId=null;
const stepNames=["Your identity","Academic journey","Service and leadership","Personal essay","Two references","Guardian information","Review and submit"];
const numericKeys=new Set(["graduationYear","gpa"]);
const timestamp=s=>s?new Date(s).toLocaleDateString():"";
const escaped=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let toastTimeout;
function notify(msg){
  const el=$("notice");el.hidden=false;el.textContent=msg;
  clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>el.hidden=true,9000);
}
function readable(e){
  const c=String(e?.code||"");
  if(c.includes("app-check"))return "App Check is not yet configured in the website. Add the reCAPTCHA Enterprise site key to firebase.js.";
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
  if(!settings.intakeOpen)throw Error("Application intake is closed while safeguards and program policies are finalized.");
}
function accountNeeded(){return !!currentUser&&!currentUser.isAnonymous;}
function route(){
 const raw=decodeURIComponent(location.hash.slice(1)||"home");
 const [key,...parts]=raw.split("/");
 const page=PAGE[key]?key:"home";
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
 if(page==="claim")loadClaim();
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
 $("student-auth-gate").hidden=signed;
 $("student-wizard").hidden=!signed;
 $("student-intake-gate").hidden=settings.intakeOpen;
 $("nomination-intake-gate").hidden=settings.intakeOpen;
 $("account-email").textContent=signed?currentUser.email:"";
 $("account-verification").textContent=signed?(currentUser.emailVerified?"Email verified":"Check your email and verify it before submitting your final application."):"";
 $("verify-email").hidden=!signed||currentUser.emailVerified;
 $("nom-submit").disabled=!settings.intakeOpen;
 qsa("#student-form input,#student-form select,#student-form textarea,#student-form button").forEach(n=>n.disabled=!settings.intakeOpen);
 // Nominations remain previewable, but cannot be submitted while intake is closed.
 const signedEmail=currentUser?.email||"";
 const nomEmail=qs('[name="nominatorEmail"]',$("nomination-form"));
 if(nomEmail&&!nomEmail.value&&signedEmail)nomEmail.value=signedEmail;
}
onAuthStateChanged(auth,async u=>{
 currentUser=u;
 refreshGates();
 if(location.hash==="#apply")await prepareApplication();
 if(location.hash==="#dashboard")showDashboard();
 if(location.hash==="#committee")showCommittee();
 if(location.hash==="#scholar")showScholar();
});
async function init(){
 try{settings=await call("getProgramSettings");}
 catch(e){notify("Program status unavailable: "+readable(e));}
 refreshGates();updateStep();route();
}
$("auth-form").addEventListener("submit",async e=>{
 e.preventDefault();const d=new FormData(e.currentTarget);
 try{await signInWithEmailAndPassword(auth,String(d.get("email")).trim(),String(d.get("password")));notify("Welcome back. Your application is linked to your account.");location.hash="#dashboard";}
 catch(err){notify(readable(err));}
});
$("create-account").addEventListener("click",async()=>{
 const form=$("auth-form");if(!form.reportValidity())return;
 const d=new FormData(form);
 try{
  const cred=await createUserWithEmailAndPassword(auth,String(d.get("email")).trim(),String(d.get("password")));
  await sendEmailVerification(cred.user);
  notify("Account created. Verify your email; you can then start your saved application.");
  location.hash="#apply";
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
 countEssay();toggleGuardian();
}
async function prepareApplication(){
 refreshGates();
 if(!accountNeeded())return;
 if(!settings.intakeOpen){updateStep();return;}
 if(draftLoadedFor===currentUser.uid)return;
 try{
  const result=await call("getDraft");
  if(draftLoadedFor&&draftLoadedFor!==currentUser.uid)student.reset();
  fillStudent(result.draft);draftLoadedFor=currentUser.uid;updateStep();
  $("draft-status").textContent=result.updatedAt?"Saved "+timestamp(result.updatedAt):"No draft saved yet";
 }catch(e){notify("Unable to load your saved application: "+readable(e));}
}
function updateStep(){
 qsa(".wizard-step",student).forEach((panel,i)=>panel.hidden=i!==step);
 $("student-step-counter").textContent="STEP "+String(step+1).padStart(2,"0")+" / 07 — "+stepNames[step].toUpperCase();
 $("student-step-progress").replaceChildren(...stepNames.map((_,i)=>{const b=el("span");b.className=i<=step?"done":"";return b;}));
 $("student-prev").hidden=step===0;
 $("student-next").hidden=step===6;
 $("student-submit").hidden=step!==6;
 if(step===6){
  const d=studentFields();
  $("student-review-summary").textContent=[
   "Student: "+(d.studentName||"Not provided"),
   "School: "+(d.school||"Not provided"),"Grade: "+(d.grade||"—"),
   "References: "+(d.references||[]).filter(x=>x.email&&x.name).length+" of 2 provided.",
   "Guardian: "+(d.ageBand==="minor"?(d.guardianEmail||"Email needed"):"Not required")
  ].join(" • ");
 }
}
function validateStep(){
 const current=qs('.wizard-step[data-step="'+step+'"]',student);
 for(const control of qsa("input,select,textarea",current)){
  if(!control.checkValidity()){control.reportValidity();return false;}
 }
 if(step===3&&studentFields().personalStatement.trim().length<180){notify("Your essay needs a little more detail before continuing.");return false;}
 if(step===4){const r=studentFields().references;if(r[0].email.trim().toLowerCase()===r[1].email.trim().toLowerCase()){notify("Provide two different references.");return false;}}
 if(step===5&&studentFields().ageBand==="minor"&&!studentFields().guardianEmail){notify("A guardian email is required for applicants under 18.");return false;}
 return true;
}
$("student-next").addEventListener("click",async()=>{
 if(!validateStep())return;
 if(settings.intakeOpen&&accountNeeded()){try{await saveDraft(false);}catch(e){notify("Save failed: "+readable(e));return;}}
 step=Math.min(6,step+1);updateStep();window.scrollTo({top:130,behavior:"smooth"});
});
$("student-prev").addEventListener("click",()=>{step=Math.max(0,step-1);updateStep();window.scrollTo({top:130,behavior:"smooth"});});
async function saveDraft(silent=true){
 if(!accountNeeded()||!settings.intakeOpen)return;
 if(savingPromise)await savingPromise;
 $("draft-status").textContent="Saving…";
 savingPromise=call("saveDraft",{fields:studentFields()});
 try{await savingPromise;$("draft-status").textContent="Saved securely";if(!silent)notify("Draft saved to your account.");}
 catch(e){$("draft-status").textContent="Save failed";throw e;}
 finally{savingPromise=null;}
}
student.addEventListener("input",()=>{
 countEssay();
 if(settings.intakeOpen&&accountNeeded()){clearTimeout(saveTimer);$("draft-status").textContent="Unsaved changes";saveTimer=setTimeout(()=>saveDraft(true),1100);}
});
student.addEventListener("change",()=>{toggleGuardian();if(settings.intakeOpen&&accountNeeded()){clearTimeout(saveTimer);saveTimer=setTimeout(()=>saveDraft(true),600);}});
function toggleGuardian(){
 const isAdult=qs('[name="ageBand"]',student).value==="adult";
 $("student-guardian-fields").hidden=isAdult;
}
function countEssay(){const t=qs('[name="personalStatement"]',student).value.trim();$("essay-word-count").textContent=(t?t.split(/\s+/).length:0)+" words";}
student.addEventListener("submit",async e=>{
 e.preventDefault();
 try{
  whenOpen();if(!accountNeeded())throw Error("Create and sign in to an account first.");
  await reload(auth.currentUser);
  if(!auth.currentUser.emailVerified)throw Error("Verify your email before submitting.");
  if(!validateStep())return;
  await saveDraft(true);
  if(!$("student-truth").checked||!$("student-ack").checked)throw Error("Please acknowledge both declarations.");
  const result=await call("submitEntry",{type:"self",declarations:{truthful:true,requirements:true}});
  notify("Official application submitted: "+result.entryId);
  location.hash="#dashboard";
 }catch(e){notify(readable(e));}
});

const nomForm=$("nomination-form");
function nominationPrivacy(){
 const privacy=qs('input[name="privacy"]:checked',nomForm)?.value;
 $("nominator-identity").hidden=privacy==="anonymous";
 qsa('#nominator-identity input[name="nominatorName"],#nominator-identity input[name="nominatorEmail"]')
   .forEach(input=>input.required=privacy!=="anonymous");
}
qsa('input[name="privacy"]',nomForm).forEach(x=>x.addEventListener("change",nominationPrivacy));
nominationPrivacy();
nomForm.addEventListener("submit",async e=>{
 e.preventDefault();
 try{
  whenOpen();
  if(!nomForm.reportValidity())return;
  const d=new FormData(nomForm),get=x=>String(d.get(x)||"").trim();
  const privacy=get("privacy");
  if(privacy!=="anonymous"){
   if(!accountNeeded())throw Error("Sign in to a verified account to submit a named or confidential nomination.");
   await reload(auth.currentUser);
   if(!auth.currentUser.emailVerified||get("nominatorEmail").toLowerCase()!==auth.currentUser.email?.toLowerCase())throw Error("Verify the account email matching your nomination.");
  } else if(!auth.currentUser){await signInAnonymously(auth);}
  const fields={
   studentName:get("studentName"),school:get("school"),grade:get("grade"),
   graduationYear:get("graduationYear"),state:get("state"),guardianEmail:get("guardianEmail"),
   personalStatement:get("personalStatement"),
   references:[{name:get("ref1Name"),email:get("ref1Email")},{name:get("ref2Name"),email:get("ref2Email")}]
  };
  const out=await call("submitEntry",{
   type:"nomination",privacy,fields,declaration:get("declaration")==="on",nominatorName:get("nominatorName"),
   nominatorEmail:get("nominatorEmail"),relationship:get("relationship"),message:get("message")
  });
  notify("Official nomination recorded. Entry ID: "+out.entryId);
  nomForm.reset();nominationPrivacy();
  if(auth.currentUser?.isAnonymous)await signOut(auth);
  location.hash="#home";
 }catch(err){notify(readable(err));}
});

async function showDashboard(){
 const root=$("dashboard-content");root.replaceChildren();
 if(!accountNeeded()){root.innerHTML='<h2>Sign in to continue</h2><p>Student accounts keep drafts and submitted applications private.</p><a href="#account" class="btn btn-gold">Sign in or create an account</a>';return;}
 root.textContent="Loading your Beacon record…";
 try{
  const [draft,submitted]=await Promise.all([call("getDraft"),call("getMyEntries")]);
  root.replaceChildren();
  const welcome=el("h2","Your Beacon Journey");root.append(welcome);
  const p=el("p","Recognition is more than a certificate. Continue a saved draft or check your official entries.","muted");root.append(p);
  const actions=el("div",undefined,"portal-actions");
  const link=el("a",draft.draft?"Continue saved application →":"Start student application →","btn btn-gold");link.href="#apply";actions.append(link);root.append(actions);
  if(draft.draft)root.append(el("p","Draft saved "+timestamp(draft.updatedAt)+". Applications can be edited until final submission.","help"));
  const entries=submitted.entries||[];
  if(!entries.length)root.append(el("p","You have no submitted student applications yet.","muted"));
  for(const e of entries){
   const div=el("article",undefined,"entry-row");
   div.append(el("strong",e.studentName+" — "+e.cycle));
   div.append(el("span","Application "+e.entryId+" • "+e.status.replace(/_/g," ")));
   div.append(el("span","References: "+e.referenceStatus+" · Guardian: "+e.guardianStatus));
   const btn=el("button","View details","btn btn-outline");btn.type="button";
   btn.addEventListener("click",async()=>{try{const item=await call("getMyEntry",{entryId:e.entryId});showEntryDetails(root,item.entry);}catch(err){notify(readable(err));}});
   div.append(btn);
   if(e.status==="selected"){const a=el("a","Open Scholar Passport →","text-link");a.href="#scholar";div.append(a);}
   root.append(div);
  }
 }catch(e){root.textContent=readable(e);}
}
function showEntryDetails(root,d){
 let panel=$("application-detail");if(panel)panel.remove();
 panel=el("div",undefined,"review-card");panel.id="application-detail";
 panel.append(el("h2","Application "+d.entryId));
 panel.append(el("p","Current status: "+d.status.replace(/_/g," ")));
 panel.append(el("p","References: "+d.referenceStatus+" • Guardian: "+d.guardianStatus));
 panel.append(el("p","Your committee reviews and confidential reference statements are not public.","help"));
 if(d.status==="selected"){const a=el("a","View your Scholar Passport and recognition documents →","btn btn-gold");a.href="#scholar";panel.append(a);}
 root.append(panel);panel.scrollIntoView({behavior:"smooth",block:"nearest"});
}

function infoRow(label,value){const p=el("p");const b=el("strong",label+": ");p.append(b,document.createTextNode(String(value||"—")));return p;}
function showScholarDocument(target){
 const root=$("scholar-content");
 qsa(".paper-document",root).forEach(n=>n.classList.remove("print-target"));
 const node=qs("#"+target,root);node?.classList.add("print-target");
 window.print();
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
  root.append(el("h2","Beacon Scholar • "+record.cycle));
  root.append(infoRow("Scholar ID",record.publicId));
  root.append(el("p","Your selection is an honorary distinction. Documents are available digitally; no cash award or future funding is promised.","muted"));
  const form=el("form",undefined,"entry-form");form.id="scholar-settings";
  form.innerHTML='<div class="field-grid"><label>Recognition name <input name="recognitionName" maxlength="120" required></label><label>Delivery preference <select name="deliveryPreference"><option value="digital">Digital</option><option value="mail">Mail physical copies</option></select></label></div><div id="scholar-address" class="field-grid" hidden><label>Address or P.O. Box <input name="line1"></label><label>Apt / Unit <input name="line2"></label><label>City <input name="city"></label><label>State <input name="state"></label><label>ZIP <input name="zip"></label></div><label class="check-label"><input type="checkbox" name="publicityConsent"> Allow optional public recognition where all required guardian permissions are on file.</label><button class="btn btn-outline" type="submit">Save delivery preferences</button>';
  form.elements.recognitionName.value=record.recognitionName||record.studentName;
  form.elements.deliveryPreference.value=record.deliveryPreference||"digital";
  if(record.address){
   for(const field of ["line1","line2","city","state","zip"])form.elements[field].value=record.address[field]||"";
   $("scholar-address").hidden=form.elements.deliveryPreference.value!=="mail";
  }
  form.elements.deliveryPreference.addEventListener("change",()=>{$("scholar-address").hidden=form.elements.deliveryPreference.value!=="mail";});
  form.addEventListener("submit",async e=>{
   e.preventDefault();const d=new FormData(form);
   try{await call("saveScholarPreferences",{entryId:activeScholarId,recognitionName:d.get("recognitionName"),deliveryPreference:d.get("deliveryPreference"),address:{line1:d.get("line1"),line2:d.get("line2"),city:d.get("city"),state:d.get("state"),zip:d.get("zip")},publicityConsent:d.has("publicityConsent")});notify("Scholar preferences saved securely.");await showScholar();}catch(err){notify(readable(err));}
  });
  root.append(form);
  root.append(el("h3","Milestones & achievements"));
  root.append(el("p","Record meaningful service, academic accomplishments, leadership experiences or personal growth. These milestones remain private until explicitly reviewed and approved.","muted"));
  const milestones=el("div",undefined,"portal-grid");
  for(const item of record.milestones||[]){
   const card=el("article",undefined,"portal-tile");
   card.append(el("h3",item.title));card.append(el("p",item.details));
   card.append(el("span",item.date+" • "+(item.verified?"Verified milestone":"Personal milestone"),"help"));
   milestones.append(card);
  }
  if(!(record.milestones||[]).length)milestones.append(el("p","No milestones recorded yet.","muted"));
  root.append(milestones);
  const milestoneForm=el("form",undefined,"entry-form");
  milestoneForm.innerHTML='<h3>Add a private milestone</h3><label>Milestone title <input name="title" minlength="5" maxlength="140" required></label><label>Date <input type="date" name="date" required></label><label>What happened and why does it matter? <textarea name="details" rows="4" minlength="10" maxlength="800" required></textarea></label><button class="btn btn-outline" type="submit">Save milestone</button>';
  milestoneForm.addEventListener("submit",async e=>{
   e.preventDefault();const d=new FormData(milestoneForm);
   try{await call("addMilestone",{entryId:activeScholarId,title:d.get("title"),date:d.get("date"),details:d.get("details")});notify("Milestone saved.");showScholar();}
   catch(err){notify(readable(err));}
  });
  root.append(milestoneForm);
  const verifyLink=el("a","Verify this Scholar ID →","text-link");verifyLink.href="#verify/"+encodeURIComponent(record.publicId);root.append(verifyLink);
  const toolbar=el("div",undefined,"portal-actions");
  const printLetter=el("button","Print official letter","btn btn-gold"),printCert=el("button","Print certificate","btn btn-outline");
  printLetter.onclick=()=>showScholarDocument("official-letter");printCert.onclick=()=>showScholarDocument("official-certificate");
  toolbar.append(printLetter,printCert);root.append(toolbar);
  const name=escaped(record.recognitionName||record.studentName);
  const id=escaped(record.publicId);
  const letter=el("section",undefined,"paper-document");letter.id="official-letter";
  letter.innerHTML='<div class="paper-kicker">THE PRAYER PROJECT • BEACON SCHOLARS</div><div class="paper-divider"></div><h2>Official Letter of Recognition</h2><p>Dear '+name+',</p><p>It is my distinct pleasure to recognize you as a <strong>Beacon Scholar</strong>. You were selected because your character, perseverance, care for others and promise deserve to be seen.</p><p>Not every meaningful contribution receives an award. The way you treat people, the responsibility you carry, and the courage to grow matter deeply. You do not need to have every answer today. Continue to learn, serve, begin again when necessary, and pursue the difference you hope to make.</p><p>Your recognition is a reminder that your story has value and your future holds possibility. I hope you will carry that encouragement with you in the years ahead.</p>'+ (record.founderNote?'<p><strong>A personal note:</strong> '+escaped(record.founderNote)+'</p>':'')+'<p>With sincere congratulations,</p><div class="signature">Christopher Shelley</div><p><strong>Christopher Shelley</strong><br>Founder, The Prayer Project</p><div class="paper-divider"></div><small>Official Beacon Scholar Recognition · '+id+' · beacon.ask4prayers.com</small>';
  const certificate=el("section",undefined,"paper-document cert");certificate.id="official-certificate";
  certificate.innerHTML='<div class="paper-kicker">THE PRAYER PROJECT</div><div class="paper-seal">✦</div><h2>BEACON SCHOLARS</h2><h3>CERTIFICATE OF RECOGNITION</h3><p>Presented with distinction to</p><h2 class="recipient-name">'+name+'</h2><p>In recognition of exceptional character, promise, perseverance, and the potential to make a meaningful difference.</p><h3>Beacon Scholar • Class of '+escaped(record.cycle)+'</h3><div class="paper-divider"></div><div class="signature">Christopher Shelley</div><p>Founder, The Prayer Project</p><small>Recognition ID: '+id+' · beacon.ask4prayers.com</small>';
  root.append(letter,certificate);
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
 if(!accountNeeded()){notify("Sign in or create your Beacon account, then return to the private claim link.");return;}
 try{
  await reload(auth.currentUser);
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

async function showCommittee(){
 const box=$("committee-content"),detail=$("review-detail");
 box.textContent="Checking access…";detail.replaceChildren();
 if(!accountNeeded()){box.innerHTML='<p>Sign in with an authorized committee account.</p><a href="#account" class="btn btn-gold">Sign in</a>';return;}
 try{
  const result=await call("listReviewQueue");
  box.replaceChildren(el("h2","Selection Registry — "+settings.cycle));
  box.append(el("p","Private review queue. No student information should be exported or publicly shared.","help"));
  if(!result.entries?.length)box.append(el("p","No entries have been submitted."));
  for(const item of result.entries||[]){
   const line=el("article",undefined,"entry-row");
   line.append(el("strong",item.studentName+" • Grade "+item.grade));
   line.append(el("span",item.type+" / "+item.status+" / "+item.entryId));
   const btn=el("button","Open Selection File","btn btn-outline");btn.type="button";
   btn.onclick=()=>openReview(item.entryId);line.append(btn);box.append(line);
  }
 }catch(e){box.textContent=readable(e);}
}
async function openReview(entryId){
 const container=$("review-detail");container.textContent="Loading selection file…";
 try{
  const result=await call("getReviewEntry",{entryId}),d=result.entry;
  container.replaceChildren();
  const core=el("section",undefined,"review-card");
  core.append(el("h2",d.studentName+" — Grade "+d.grade));
  core.append(infoRow("Application ID",d.entryId));
  core.append(infoRow("Entry pathway",d.type));
  core.append(infoRow("Current status",d.status));
  core.append(infoRow("School",d.school));
  core.append(infoRow("Reported GPA",d.gpa===null?"Not reported":d.gpa));
  core.append(infoRow("Eligibility confirmed",d.verifiedEligibility?"Yes":"No"));
  core.append(infoRow("References",d.referenceCount+" verified / 2 required"));
  core.append(infoRow("Guardian consent",d.guardianStatus));
  core.append(infoRow("Committee reviews",d.reviewCount+" recorded • "+d.approveVotes+" recommending selection"));
  for(const [key,label] of [["personalStatement","Essay or nomination"],["academicInterests","Academic interests"],["futureGoals","Future goals"],["service","Community service"],["activities","Leadership and activities"],["responsibilities","Responsibilities and personal growth"],["additionalInfo","Additional context"]]){
   if(d[key]){core.append(el("h3",label));core.append(el("p",d[key]));}
  }
  if(d.duplicateCount>1){core.append(el("p","Potential duplicate entries: "+d.duplicateCount+" records share the same student name, school and graduation year. Review without assuming they are duplicates.","callout"));}
  if(d.nominator){core.append(el("h3","Confidential nominator identity — ADMIN ONLY"));core.append(infoRow("Name",d.nominator.name));core.append(infoRow("Email",d.nominator.email));}
  container.append(core);
  const refs=el("section",undefined,"review-card");refs.append(el("h2","References & consent"));
  (d.referenceSuggestions||[]).forEach((r,i)=>refs.append(infoRow("Reference "+(i+1)+" invited contact",r.name+" • "+r.email)));
  for(const r of d.references||[]){
   refs.append(el("h3","Reference "+(Number(r.slot)+1)+" — "+(r.verified?"Verified":"Awaiting verification")));
   refs.append(infoRow("Full name",r.fullName));
   for(let i=0;i<(r.answers||[]).length;i++){refs.append(el("p",prompts[i],"help"));refs.append(el("p",r.answers[i]));}
   if(!r.verified){const button=el("button","Confirm reference identity and verify","btn btn-outline");button.type="button";button.onclick=()=>action("verifyRequirement",{entryId,kind:"reference",slot:Number(r.slot)},entryId);refs.append(button);}
  }
  const tools=el("div",undefined,"review-actions");
  for(let j=0;j<2;j++){const btn=el("button","Create reference "+(j+1)+" invitation","btn btn-outline");btn.type="button";btn.onclick=()=>invitation(entryId,"reference",j);tools.append(btn);}
  const guardian=el("button","Create guardian consent invitation","btn btn-outline");guardian.type="button";guardian.onclick=()=>invitation(entryId,"guardian",null);tools.append(guardian);
  if(d.guardianStatus==="signed_pending_verification"){const verify=el("button","Verify guardian authorization","btn btn-outline");verify.type="button";verify.onclick=()=>action("verifyRequirement",{entryId,kind:"guardian"},entryId);tools.append(verify);}
  refs.append(tools);container.append(refs);
  const manage=el("section",undefined,"review-card");
  manage.append(el("h2","Administrator: student details and invitations"));
  manage.append(el("p","Use only confirmed information. Nominations can be submitted before the student's references or guardian contact information are available.","help"));
  const dataForm=el("form",undefined,"entry-form");
  dataForm.innerHTML='<div class="field-grid"><label>Nominee contact email <input type="email" name="applicantEmail"></label><label>Guardian email <input type="email" name="guardianEmail"></label><label>Guardian name <input name="guardianName"></label><label>Student age band <select name="ageBand"><option value="">Unknown</option><option value="minor">Under 18</option><option value="adult">18 or older</option></select></label><label>Verified unweighted GPA <input type="number" min="0" max="4" step=".01" name="gpa"></label></div><p>Qualified references</p><div class="field-grid"><label>Reference 1 name <input name="ref1Name"></label><label>Reference 1 email <input type="email" name="ref1Email"></label><label>Reference 2 name <input name="ref2Name"></label><label>Reference 2 email <input type="email" name="ref2Email"></label></div><button class="btn btn-outline" type="submit">Save verified contact details</button>';
  for(const key of ["applicantEmail","guardianEmail","guardianName","ageBand","gpa"])if(d[key]!==null&&d[key]!==undefined&&dataForm.elements[key])dataForm.elements[key].value=String(d[key]);
  (d.referenceSuggestions||[]).forEach((v,i)=>{const j=i+1;dataForm.elements["ref"+j+"Name"].value=v.name||"";dataForm.elements["ref"+j+"Email"].value=v.email||"";});
  dataForm.addEventListener("submit",async e=>{
   e.preventDefault();const f=new FormData(dataForm);
   await action("updateEntryContacts",{entryId,fields:{
    applicantEmail:f.get("applicantEmail"),guardianEmail:f.get("guardianEmail"),guardianName:f.get("guardianName"),
    ageBand:f.get("ageBand")||"minor",gpa:f.get("gpa"),
    references:[{name:f.get("ref1Name"),email:f.get("ref1Email")},{name:f.get("ref2Name"),email:f.get("ref2Email")}]
   }},entryId);
  });
  manage.append(dataForm);
  const claimBtn=el("button","Generate student account-claim invitation","btn btn-outline");
  claimBtn.type="button";claimBtn.onclick=()=>invitation(entryId,"scholar",null);manage.append(claimBtn);
  if(d.type==="nomination"&&d.nominator?.email){
   const btn=el("button","Verify qualified nominator as reference 1","btn btn-outline");btn.type="button";
   btn.onclick=()=>{if(confirm("I independently verified this nominator's identity and eligibility to serve as a reference."))action("useVerifiedNominatorReference",{entryId,slot:0,identityVerified:true},entryId);};
   manage.append(btn);
  }
  container.append(manage);
  const control=el("section",undefined,"review-card");control.append(el("h2","Committee governance"));
  control.innerHTML+= '<p class="help">Scoring: Character 30 • Perseverance 25 • Service 20 • Leadership 15 • Potential 10. Three to five distinct reviews are required to finalize a selection.</p>';
  const reviewForm=el("form",undefined,"entry-form");reviewForm.innerHTML=
  '<div class="field-grid">'+[
   ["character","Character & integrity",30],["perseverance","Perseverance & growth",25],["service","Service & compassion",20],["leadership","Leadership & initiative",15],["potential","Purpose & potential",10]
  ].map(([key,label,max])=>'<label>'+label+' / '+max+'<input type="number" name="'+key+'" min="0" max="'+max+'" required value="'+(d.myReview?.scores?.[key]??0)+'"></label>').join("")+
  '</div><label>Committee recommendation <select name="recommend"><option value="discuss">Discuss further</option><option value="select">Recommend selection</option><option value="decline">Do not recommend</option></select></label><label>Independent reviewer notes <textarea name="notes" rows="5" maxlength="2400"></textarea></label><button type="submit" class="btn btn-gold">Record Independent Evaluation</button>';
  reviewForm.elements.recommend.value=d.myReview?.recommend||"discuss";
  reviewForm.elements.notes.value=d.myReview?.notes||"";
  reviewForm.addEventListener("submit",async e=>{
   e.preventDefault();const f=new FormData(e.currentTarget),scores={};
   for(const key of ["character","perseverance","service","leadership","potential"])scores[key]=Number(f.get(key));
   await action("recordReview",{entryId,scores,recommend:f.get("recommend"),notes:f.get("notes")},entryId);
  });
  control.append(reviewForm);
  const conflict=el("textarea");conflict.placeholder="Reason for recusal (conflict of interest)";conflict.rows=2;conflict.maxLength=400;
  control.append(conflict);
  const recuse=el("button","Recuse myself from this entry","btn btn-outline");recuse.type="button";recuse.onclick=()=>action("recuse",{entryId,reason:conflict.value},entryId);control.append(recuse);
  const elig=el("div",undefined,"review-actions");
  const note=el("textarea");note.placeholder="Eligibility verification notes";note.rows=2;note.maxLength=1000;control.append(note);
  for(const [label,eligible] of [["Mark eligible",true],["Return to eligibility screening",false]]){
   const btn=el("button",label,"btn btn-outline");btn.type="button";btn.onclick=()=>action("setEligibility",{entryId,eligible,notes:note.value},entryId);elig.append(btn);
  }
  control.append(elig);
  const founder=el("textarea");founder.placeholder="Founder's optional personal message for selected Scholar (will appear in recognition letter)";founder.maxLength=3400;founder.rows=6;founder.value=d.founderNote||"";
  control.append(el("h3","Founder's recognition note"));control.append(founder);
  const decisions=el("div",undefined,"review-actions");
  for(const [label,decision] of [["Approve Beacon Scholar","select"],["Finalize not selected","decline"]]){
   const b=el("button",label,decision==="select"?"btn btn-gold":"btn btn-outline");b.type="button";
   b.onclick=async()=>{if(!confirm("Finalize "+decision+" for "+d.studentName+"? This decision will be locked."))return;await action("finalizeDecision",{entryId,decision,founderNote:founder.value},entryId);};
   decisions.append(b);
  }
  control.append(decisions);container.append(control);
  container.scrollIntoView({behavior:"smooth",block:"start"});
 }catch(e){container.textContent=readable(e);}
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
