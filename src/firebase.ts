// Import the functions you need from the SDKs you need
import { initializeApp } from 'firebase/app';
import { getAnalytics } from 'firebase/analytics';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: 'AIzaSyCLisSDsVPEFevXCWBUc9NfXlh-qBlQOOU',
  authDomain: 'aibt-99bc6.firebaseapp.com',
  projectId: 'aibt-99bc6',
  storageBucket: 'aibt-99bc6.firebasestorage.app',
  messagingSenderId: '718449031673',
  appId: '1:718449031673:web:f883bdb931016117b8e528',
  measurementId: 'G-PWRQ3B3W33',
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

// Export Auth and Firestore instances
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export default app;
