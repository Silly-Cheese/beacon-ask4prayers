"use strict";
// Run ONLY from a trusted developer/administrator environment.
// Authenticate Google Cloud Application Default Credentials first.
const {initializeApp,applicationDefault}=require("firebase-admin/app");
const {getAuth}=require("firebase-admin/auth");
const [email,role]=process.argv.slice(2);
if(!email||!["admin","reviewer","revoke"].includes(role)){
 console.error("Usage: node scripts/grant-role.cjs user@example.com admin|reviewer|revoke");
 process.exit(1);
}
initializeApp({credential:applicationDefault(),projectId:"beacon-ask4prayers"});
(async()=>{
 const auth=getAuth(),user=await auth.getUserByEmail(email);
 const claims={...(user.customClaims||{})};
 delete claims.admin;delete claims.reviewer;
 if(role!=="revoke")claims[role]=true;
 await auth.setCustomUserClaims(user.uid,claims);
 console.log("Updated "+email+" to "+role+". User must sign out and back in.");
})().catch(e=>{console.error(e.message);process.exit(1);});
