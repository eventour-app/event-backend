
import { initializeApp } from 'firebase/app';
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || 'AIzaSyAczDSdyQK50TvfrA9-I2i7vPSQ6Qtqje4',
  authDomain: 'planora-c2574.firebaseapp.com',
  projectId: 'planora-c2574',
  storageBucket: 'planora-c2574.firebasestorage.app',
  messagingSenderId: '517690207789',
  appId: '1:517690207789:web:89197107edd32e4cf012a4',
  measurementId: 'G-EJ3MSK4N28'
};

export const firebaseApp = initializeApp(firebaseConfig);
