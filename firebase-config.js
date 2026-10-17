// Firebase web config for publishing (see docs/firebase-plan.md).
// null turns publishing off: the page then works as before, with no Firebase
// requests. This is the foos-tourney project's web app config (Project
// settings > Your apps). It is meant to be public: the security rules in
// firestore.rules are what protect the data. firebase-remote.js loads the SDK
// and initializes the app, so nothing else belongs here.
globalThis.FOOS_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyB9nOUMBKikmg_53jRlJueivC74q3sHegg',
  authDomain: 'foos-tourney.firebaseapp.com',
  projectId: 'foos-tourney',
  storageBucket: 'foos-tourney.firebasestorage.app',
  messagingSenderId: '912181542134',
  appId: '1:912181542134:web:65b847a1021c3c4c3ec0d7'
};
