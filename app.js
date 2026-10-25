import { auth, callable } from "./firebase.js";
import { onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInAnonymously, signOut, sendEmailVerification, sendPasswordResetEmail, reload } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
const $ = (id) => document.getElementById(id);
const views = {home:"public-view",mission:"public-view",selection:"public-view",opportunities:"public-view",faq:"public-view",apply:"apply-view",nominate:"nominate-view",account:"account-view",committee:"committee-view",policy:"policy-view"};
let activeUser = null;
// Only change this after the backend, reference and guardian flows are operational.
const PUBLIC_INTAKE_OPEN = false;
let noticeTimer;
function toast(message) {
  $("notice").textContent = message;
  $("notice").hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => $("notice").hidden = true, 9000);
}
function route() {
  const page = location.hash.replace(/^#/, "") || "home";
  const validPage = views[page] ? page : "home";
  for (const id of Object.values(views)) $(id).hidden = true;
  $(views[validPage]).hidden = false;
  document.querySelectorAll("#main-nav a").forEach((a) => a.removeAttribute("aria-current"));
  document.querySelectorAll('#main-nav a[href="#' + validPage + '"]').forEach((a) => a.setAttribute("aria-current","page"));
  $("main-nav").classList.remove("open");
  $("menu-toggle").setAttribute("aria-expanded","false");
  if (validPage === "mission" || validPage === "selection" || validPage === "opportunities" || validPage === "faq") {
    requestAnimationFrame(() => $(validPage).scrollIntoView({behavior:"smooth",block:"start"}));
  } else window.scrollTo(0,0);
  if (validPage === "account") loadMyEntries();
  if (validPage === "committee") loadCommittee();
}
window.addEventListener("hashchange",route);
$("menu-toggle").addEventListener("click",() => {
  const open = $("main-nav").classList.toggle("open");
  $("menu-toggle").setAttribute("aria-expanded",String(open));
});
$("year").textContent=String(new Date().getFullYear());
function values(form) {
  const f = new FormData(form);
  const get = (k) => String(f.get(k) || "").trim();
  return {studentName:get("studentName"), school:get("school"), grade:get("grade"),
    graduationYear:Number(get("graduationYear")),statement:get("statement"),message:get("message"),
    privacy:get("privacy"),nominatorName:get("nominatorName"),nominatorEmail:get("nominatorEmail"),
    relationship:get("relationship"),studentContact:get("studentContact"),guardianEmail:get("guardianEmail"),
    minor:f.get("minor")==="on",
    references:[{name:get("ref1Name"),email:get("ref1Email")},{name:get("ref2Name"),email:get("ref2Email")}]};
}
function messageError(err) {
  const code=String(err.code||"");
  if (code.includes("failed-precondition")) return "Beacon is not accepting live entries yet, or a security prerequisite is incomplete. Please check back after the official opening.";
  if (code.includes("unauthenticated")) return "Please sign in and verify your email for a student application.";
  if (code.includes("permission-denied")) return "This action is not authorized for your account.";
  if (code.includes("resource-exhausted")) return "Submission limit reached. Please contact the program if you need assistance.";
  if (code.includes("invalid-argument")) return err.message || "Please check the form for missing or invalid information.";
  return err.message || "Something went wrong. Please try again.";
}
async function submit(form,type,button) {
  if (!form.reportValidity()) return;
  const payload=values(form);
  let guest=false;
  button.disabled=true;button.textContent="Submitting...";
  try {
    if (type==="self") {
      if (!auth.currentUser || auth.currentUser.isAnonymous) throw new Error("Please sign in to a student account first using Account in the navigation.");
      await reload(auth.currentUser);
      if (!auth.currentUser.emailVerified) throw new Error("Verify your email before submitting. Open Account to resend verification.");
    } else if (!auth.currentUser) {
      await signInAnonymously(auth);
      guest=true;
    }
    const reply=await callable("submitEntry")({type,...payload});
    form.reset();
    toast("Entry received. Reference number: " + reply.data.entryId + ". Keep this number for your records.");
    if (guest) await signOut(auth);
    location.hash="#home";
  } catch (err) {
    if (guest) { try {await signOut(auth);}catch(_unused){} }
    toast(messageError(err));
  } finally {button.disabled=false;button.textContent=type==="self"?"Submit Official Application ↗":"Submit Official Nomination ↗";}
}
$("application-form").addEventListener("submit",(e)=>{e.preventDefault();submit(e.currentTarget,"self",$("apply-submit"));});
$("nomination-form").addEventListener("submit",(e)=>{e.preventDefault();submit(e.currentTarget,"nomination",$("nom-submit"));});
function changePrivacy(){
  const anonymous=document.querySelector('input[name="privacy"]:checked').value==="anonymous";
  $("nominator-fields").hidden=anonymous;
  $("nominator-fields").querySelectorAll("input").forEach((i)=>{i.required=!anonymous;if(anonymous)i.value="";});
}
document.querySelectorAll('input[name="privacy"]').forEach((el)=>el.addEventListener("change",changePrivacy));changePrivacy();
onAuthStateChanged(auth,async user=>{
  activeUser=user;
  const signedIn=!!user&&!user.isAnonymous;
  $("account-guest").hidden=signedIn;
  $("account-signed-in").hidden=!signedIn;
  $("account-link").textContent=signedIn?"My account":"Sign in";
  if (signedIn) {
    $("account-email").textContent=user.email||"Signed in";
    $("verify-email").hidden=user.emailVerified;
  }
  if (location.hash==="#account") loadMyEntries();
});
$("auth-form").addEventListener("submit",async(e)=>{
  e.preventDefault();const f=new FormData(e.currentTarget);
  try {await signInWithEmailAndPassword(auth,String(f.get("email")).trim(),String(f.get("password")));toast("Signed in.");}
  catch(err){toast(messageError(err));}
});
$("create-account").addEventListener("click",async()=>{
  const f=new FormData($("auth-form")),email=String(f.get("email")||"").trim(),password=String(f.get("password")||"");
  if (!email||password.length<8){toast("Enter your email and a password with at least eight characters.");return;}
  try{const cred=await createUserWithEmailAndPassword(auth,email,password);await sendEmailVerification(cred.user);toast("Account created. Check your email for a verification link.");}
  catch(err){toast(messageError(err));}
});
$("verify-email").addEventListener("click",async()=>{try{if(auth.currentUser){await sendEmailVerification(auth.currentUser);toast("Verification email sent.");}}catch(err){toast(messageError(err));}});
$("sign-out").addEventListener("click",async()=>{await signOut(auth);toast("Signed out.");});
$("reset-password").addEventListener("click",async()=>{
  const email=String(new FormData($("auth-form")).get("email")||"").trim();
  if(!email){toast("Enter your email first.");return;}
  try{await sendPasswordResetEmail(auth,email);toast("If the email is registered, a password reset email will arrive.");}
  catch(err){toast(messageError(err));}
});
async function loadMyEntries(){
  const root=$("my-entries");if(!root)return;
  if (!activeUser || activeUser.isAnonymous){root.replaceChildren();return;}
  root.textContent="Loading your applications...";
  try {
    const response=await callable("getMyEntries")({});
    const entries=response.data.entries||[];
    root.replaceChildren();
    if(!entries.length){root.textContent="You have no student applications on file.";return;}
    entries.forEach(entry=>{
      const div=document.createElement("div");div.className="entry-row";
      const label=document.createElement("strong");label.textContent=entry.studentName+" · "+entry.cycle;
      const status=document.createElement("span");status.textContent="Application "+entry.entryId+" • "+entry.status.replace(/_/g," ");
      div.append(label,status);root.append(div);
    });
  }catch(err){root.textContent=messageError(err);}
}
async function loadCommittee(){
  const root=$("committee-list");root.textContent="Checking reviewer access...";
  try{
    if(!auth.currentUser || auth.currentUser.isAnonymous){root.textContent="Authorized staff must sign in first.";return;}
    const response=await callable("listReviewQueue")({});
    const entries=response.data.entries||[];root.replaceChildren();
    if(!entries.length){root.textContent="No entries to review.";return;}
    entries.forEach(entry=>{
      const div=document.createElement("div");div.className="entry-row";
      const name=document.createElement("strong");name.textContent=entry.studentName;
      const details=document.createElement("span");details.textContent=entry.entryId+" • "+entry.type+" • "+entry.status+" • Grade "+entry.grade;
      div.append(name,details);root.append(div);
    });
  }catch(err){root.textContent=messageError(err);}
}
for (const id of ["application-form", "nomination-form"]) {
  const form = $(id);
  if (!PUBLIC_INTAKE_OPEN) {
    const banner = document.createElement("div");
    banner.className = "callout";
    banner.setAttribute("role", "status");
    banner.textContent = "Applications and nominations are not open yet. This form is available for preview only; no information will be submitted.";
    form.prepend(banner);
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = "Submissions opening soon";
  }
}
route();