// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyC51vmWifJn1zfWKABWnpEBL3PHyivr6eA",
  authDomain: "chat-sphere-eed46.firebaseapp.com",
  databaseURL: "https://chat-sphere-eed46-default-rtdb.firebaseio.com",
  projectId: "chat-sphere-eed46",
  storageBucket: "chat-sphere-eed46.appspot.com",
  messagingSenderId: "1049211867657",
  appId: "1:1049211867657:web:c5064ef348447cb0f49ed8",
  measurementId: "G-G7Z5P4D5DK"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth(app);
const database = getDatabase(app);

export { app, analytics, auth, database };
