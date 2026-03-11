import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey:            "AIzaSyCVXWZc3mT8EtPHa27adswSJ6h58fDlW_4",
  authDomain:        "firestore-database-e7511.firebaseapp.com",
  projectId:         "firestore-database-e7511",
  storageBucket:     "firestore-database-e7511.firebasestorage.app",
  messagingSenderId: "1038831129421",
  appId:             "1:1038831129421:web:05e81b2942a089793b9d04",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
