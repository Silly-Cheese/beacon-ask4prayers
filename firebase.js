// Public Firebase web configuration; not an administrative credential.
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-functions.js";
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
