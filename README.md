# Event Vendor Backend

Express + MongoDB backend that powers auth and business endpoints for the Event Vendor app (Expo/React Native).

## Quick start

1. Create your env file

   cp .env.example .env

   Edit `.env` with your own values.

2. Install deps

   npm install

3. Run the backend

   npm run server

   Server runs on http://localhost:4000 by default. Note: macOS can hijack port 5000 for AirPlay Receiver; use 4000 to avoid conflicts.

4. Test

   - Health: GET http://localhost:4000/
   - Login: POST http://localhost:4000/api/auth/login with JSON body { "email": "test@example.com", "password": "secret" }

## Common issue: receiving HTML instead of JSON on login

If your frontend prints an HTML document for the login response, you are likely hitting the Expo dev server (the web bundle) instead of the Express API.

Checklist:
- Ensure the frontend base URL points to the Node server (http://localhost:4000) and not the Expo web host.
- Use the full path: http://localhost:4000/api/auth/login
- Verify the backend is running and the route is mounted under `/api/auth`.
- Confirm `Content-Type: application/json` and use `await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })`.
- Handle non-2xx status codes by checking `response.ok` before parsing.

Device-specific base URLs:
- Web (browser): http://localhost:4000
- iOS Simulator: http://localhost:4000
- Android Emulator: http://10.0.2.2:4000
- Physical devices: http://<YOUR_COMPUTER_LAN_IP>:4000

Recommended Expo config:
- Put `EXPO_PUBLIC_API_URL` in `app.json` → `expo.extra.apiUrl` or `EXPO_PUBLIC_API_URL`
- In code, use: `const BASE = process.env.EXPO_PUBLIC_API_URL;`

## Routes

- POST /api/auth/register → { token, user }
- POST /api/auth/login → { token, user }
- GET  /api/auth/me (Authorization: Bearer <token>) → { user }

Customer specific:
- POST /api/customer/auth/login → { token }

Business:
- PUT /api/business/update/:id → multipart form-data for docs

## CORS

CORS is open for development in `server.js`. In production, restrict `origin` to your app domain.

## Notes
- JWT secret must be defined in `.env`
- MongoDB must be running and `MONGO_URI` reachable

---

## Onboarding API (single endpoint)

Base URL: `http://localhost:4000`

### 1) Create/Update in ONE call

POST `/api/business/onboard`

- Creates a new business if `businessId` is omitted
- Updates an existing business if `businessId` is present
- Accepts images as Data URLs (preferred) or base64 strings

Request body

```
{
   "businessId": "optional",
   "userId": "required",
   "serviceType": "required",

   "businessInfo": {
      "ownerName": "string",
      "businessName": "string",
      "email": "string",
      "phone": "string",
      "whatsapp": "string",
      "location": {
         "address": "string",
         "street": "string",
         "houseNo": "string",
         "plotNo": "string",
         "area": "string",
         "landmark": "string",
         "pincode": "string",
         "state": "string",
         "gps": "lat,long"
      },
      "workingDays": ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],
      "openingTime": "09:00 AM",
      "closingTime": "09:00 PM",
      "gstNumber": "string",
      "cinNumber": "string",
      "panNumber": "string",
      "aadhaarNumber": "string",
      "bankAccount": "string",
      "ifscCode": "string",
      "isRegisteredBusiness": true,
      "serviceDetail": "Describe your service"
   },

   "logo": "data:image/png;base64,...",
   "photos": {
      "ownerPhoto": "data:image/jpeg;base64,...",
      "previewPhoto": "data:image/jpeg;base64,..."
   },
   "documents": {
      "govtId": "data:image/jpeg;base64,...",
      "registrationProof": "data:image/jpeg;base64,...",
      "cancelledCheque": "data:image/jpeg;base64,..."
   },

   "services": [
      {
         "serviceName": "Pre-Wedding Shoot",
         "price": "5999",
         "discount": "10",
         "images": ["data:image/jpeg;base64,..."]
      }
   ]
}
```

Response

```
201 Created | 200 OK
{
   "message": "Onboarding data saved",
   "business": { ...full business document... }
}
```

### 2) Update listing status

PUT `/api/business/:businessId/status`

Body

```
{ "status": "online" }   // or "offline"
```

### 3) Mark Partner Contract acceptance

PUT `/api/business/:businessId/contract`

Body

```
{ "accepted": true }
```

### 4) Prefill by existing business phone

Before starting signup, you can check if a business already exists for a phone number.

GET `/api/business/lookup/by-phone?phone=9876543210`

Response if exists:
```
200 OK
{
  "businessId": "...",
  "phone": "9876543210",
  "ownerName": "Existing Owner",
  "businessName": "Existing Business",
  "gstNumber": "GST123...",
  "cinNumber": "CIN456...",
  "panNumber": "PAN789...",
  "aadhaarNumber": "AADHAAR000..."
}
```

404 if no match.

### Deprecated endpoints (return 410)

- `POST /api/business/register`
- `PUT /api/business/add-service/:businessId`
- `PUT /api/business/update/:businessId`
- `PUT /api/business/docs/:businessId`
- `POST /api/business/` (plain create)
- `PUT /api/business/logo/:businessId`
- `PUT /api/business/service-images/:businessId/:serviceIndex`
- `GET /api/business/:userId` (conflicted path)

## Firebase Phone OTP

The current OTP flow uses Firebase Identity Toolkit REST endpoints (NOT the service account file). You must set `FIREBASE_API_KEY`.

Steps:
1. Firebase Console → Project Settings → General → Your apps → Config snippet → Copy `apiKey`.
2. Add to `.env`: `FIREBASE_API_KEY=AIzaSy...`
3. Restart backend (`npm run server`).
4. Test: `POST /api/auth/send-otp` with `{ "phone": "+<E164 number>" }` → Should return `{ message: "OTP sent", provider: "firebase" }`.

Environment variables (see `.env.example`):
- `FIREBASE_API_KEY` (required) Web API key.
- `DEFAULT_COUNTRY_CODE` (optional) Used for normalization when user supplies local numbers without + prefix.

Security notes:
- Do NOT commit `.env` to source control.
- The service account JSON is not used for phone OTP; keep it restricted or remove if unnecessary.

Failure modes:
- 500 with `Firebase phone auth is not configured` → Missing `FIREBASE_API_KEY`.
- 500 with `Failed to send OTP` → Network/API error; check console for Firebase error message.
- 400 `Invalid OTP` on verify → Wrong code or expired session.

### Firebase Client SDK Usage

A helper file `firebaseClient.js` initializes Firebase for the client. Example usage in your Expo app:

```js
import { firebaseApp } from '../firebaseClient';
import { getAuth, signInWithPhoneNumber, RecaptchaVerifier } from 'firebase/auth';

const auth = getAuth(firebaseApp);
// Implement client-side phone auth (recommended) then send ID token to backend if needed.
```

For pure backend phone verification we currently use REST endpoints with `FIREBASE_API_KEY`. Client-side flows provide better UX (automatic SMS code reading on Android, etc.).
