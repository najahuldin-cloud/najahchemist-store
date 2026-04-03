// One-time script: add Hydra Glow Bundle to Firestore products collection
// Run: FIREBASE_PASSWORD=<your-password> node add-hydra-glow.mjs
// Then delete this file.

import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc } from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDYdt_0wJNcfGl2WbIKPiESdVcmc-cqZgM",
  authDomain: "najahchemistja.com",
  projectId: "najah-chemist",
  storageBucket: "najah-chemist.firebasestorage.app",
  messagingSenderId: "89819999556",
  appId: "1:89819999556:web:4e6eb5c0c881da5e763b11"
};

const product = {
  id: 'hgb1',
  name: 'Hydra Glow Bundle',
  tagline: 'Complete hydration starter kit',
  cat: 'bundle',
  emoji: '💧',
  tag: 'Bundle',
  pricing: { kit: { price: 25500, moq: 1 } },
  ingredients: 'Includes: Hyaluronic Acid Serum, Hydrating Moisturiser, Soothing Rose Toner',
  benefits: ['Deep hydration', 'Brightening', 'Suitable for all skin types'],
  usage: 'Apply products in your preferred skincare routine order',
  img: ''
};

const password = process.env.FIREBASE_PASSWORD;
if (!password) { console.error("Set FIREBASE_PASSWORD env var"); process.exit(1); }

const app   = initializeApp(firebaseConfig);
const db    = getFirestore(app);
const auth  = getAuth(app);

console.log("Signing in...");
await signInWithEmailAndPassword(auth, "start@najahchemist.com", password);
console.log("Signed in.");

await setDoc(doc(db, 'products', product.id), product);
console.log(`✓ Added: ${product.name} (id: ${product.id})`);
process.exit(0);
