// ─────────────────────────────────────────────────────────────
// config.js — Firebase configuration & APP namespace bootstrap
// Edit THIS FILE when Firebase keys change.
// ─────────────────────────────────────────────────────────────
window.APP = window.APP || {};

var FIREBASE_CONFIG = {
    apiKey:            "AIzaSyAZCLVytR-q7bhoeQAbwu5YLVJiTf7m0gE",
    authDomain:        "cspooler-admin-console.firebaseapp.com",
    projectId:         "cspooler-admin-console",
    storageBucket:     "cspooler-admin-console.firebasestorage.app",
    messagingSenderId: "1095696213638",
    appId:             "1:1095696213638:web:4492f1fd48939369ee9307",
    measurementId:     "G-TRZP96569E"
};

// Super-admin email — set via Firestore, not hardcoded
var SUPER_ADMIN = "";

try {
    firebase.initializeApp(FIREBASE_CONFIG);
    APP.db             = firebase.firestore();
    APP.auth           = firebase.auth();
    APP.storage        = firebase.storage();
    APP.FIREBASE_CONFIG = FIREBASE_CONFIG; // exposed for secondary-app creation in admin-settings.js
} catch (e) {
    console.error('[CONFIG] Firebase init failed:', e);
}
