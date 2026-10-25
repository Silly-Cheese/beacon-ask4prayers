// Public Firebase web configuration; not an administrative credential.
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-functions.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app-check.js";
const config = {
  apiKey: "AIzaSyDnqlkHQY85PNzlzV00ImO_Qf54nNRGukI",
  authDomain: "beacon-ask4prayers.firebaseapp.com",
  projectId: "beacon-ask4prayers",
  storageBucket: "beacon-ask4prayers.firebasestorage.app",
  messagingSenderId: "163736763616",
  appId: "1:163736763616:web:a133892b9215798c156485"
};
export const app = initializeApp(config);
export const auth = getAuth(app);
export const functions = getFunctions(app, "us-central1");
export const callable = (name) => httpsCallable(functions, name);
// Add the public reCAPTCHA Enterprise site key after registering this app
// in Firebase App Check. Production intake requires a valid App Check token.
// A site key is public and can safely live in this static file.
export const APP_CHECK_SITE_KEY = "6LfhYv8tAAAAADEfyAT2WeF6Yy4V1dcPJZ3czBC-";
if (APP_CHECK_SITE_KEY) initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY),
  isTokenAutoRefreshEnabled: true
});
