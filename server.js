require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const app = express();
const Business = require('./models/Business');

const multer = require("multer");
const path = require('path');
const fs = require('fs');
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const ts = Date.now();
    cb(null, `${ts}-${safe}`);
  }
});
const upload = multer({ storage });

// middleware
app.use(cors({
  origin: ["http://localhost:8081", "http://localhost:8082"],
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));

const BODY_LIMIT = process.env.BODY_LIMIT || '50mb';
app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));

// connect MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.error("MongoDB connection error:", err));

app.use('/uploads', express.static(uploadsDir));

app.get("/", (req, res) => {
  res.send("Backend is working 🎉");
});
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const isPublicRoute = (req) => {
  const pub = [
    { method: 'POST', path: '/api/auth/login' },
    { method: 'POST', path: '/api/auth/register' },
    { method: 'POST', path: '/api/customer/register' },
    { method: 'POST', path: '/api/customer/auth/login' },
  ];
  return pub.some(r => r.method === req.method && req.path === r.path);
};

app.use((req, res, next) => {
  if (req.method === 'OPTIONS') return next();
  if (isPublicRoute(req)) return next();

  const hdr = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Missing Bearer token' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.auth = decoded;
    req.userId = decoded.sub || decoded.id;
    return next();
  } catch (e) {
    return res.status(401).json({ message: 'Invalid/expired token' });
  }
});


app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/cities', require('./routes/cityRoutes'));
app.use("/api/business", require('./routes/business'));
app.use('/api/customer', require('./routes/customer'));
app.use('/api/customer/auth', require('./routes/customerAuth'));

// // Create a new Business when serviceType is selected
// app.post("/api/business", async (req, res) => {
//   try {
//     const { userId, serviceType } = req.body;

//     if (!userId || !serviceType) {
//       return res.status(400).json({ message: "userId and serviceType are required" });
//     }

//     // Create Business doc with only serviceType + userId initially
//     const business = new Business({
//       userId,
//       serviceType,
//       // rest fields empty initially
//       name: "",
//       address: "",
//       phone: "",
//       services: []
//     });

//     await business.save();
//     res.status(201).json(business);

//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ message: "Error creating business" });
//   }
// });



app.use((req, res, next) => {
  res.status(404).json({ message: 'Route not found' });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({
      message: 'Request entity too large. Reduce payload size or increase BODY_LIMIT.',
    });
  }
  res.status(err.status || 500).json({ message: err.message || 'Internal Server Error' });
});

// start server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));


// require('dotenv').config();
// const express = require('express');
// const cors = require('cors');
// const mongoose = require('mongoose');

// const app = express();
// app.use(cors({
//   origin: "http://localhost:8081",  // allow your frontend
//   methods: ["GET", "POST"],
//   credentials: true
// }));
// app.use(express.json());

// mongoose.connect(process.env.MONGO_URI);

// // --- User model ---
// const { Schema, model } = mongoose;
// const userSchema = new Schema({
//   name: String,
//   email: { type: String, unique: true, required: true, lowercase: true, trim: true },
//   passwordHash: { type: String, required: true }
// }, { timestamps: true });
// const User = model('User', userSchema);

// // --- Helpers ---
// const bcrypt = require('bcrypt');
// const jwt = require('jsonwebtoken');
// const signToken = (user) =>
//   jwt.sign({ sub: user._id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });

// const auth = (req, res, next) => {
//   const hdr = req.headers.authorization || '';
//   const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
//   if (!token) return res.status(401).json({ message: 'Missing token' });
//   try {
//     req.user = jwt.verify(token, process.env.JWT_SECRET);
//     next();
//   } catch {
//     res.status(401).json({ message: 'Invalid/expired token' });
//   }
// };

// // --- Routes ---
// app.post('/api/auth/register', async (req, res) => {
//   try {
//     const { name, email, password } = req.body;
//     if (!email || !password) return res.status(400).json({ message: 'Email & password required' });
//     const exists = await User.findOne({ email });
//     if (exists) return res.status(409).json({ message: 'Email already in use' });
//     const passwordHash = await bcrypt.hash(password, 10);
//     const user = await User.create({ name, email, passwordHash });
//     const token = signToken(user);
//     res.status(201).json({ token, user: { id: user._id, name: user.name, email: user.email } });
//   } catch (e) {
//     res.status(500).json({ message: 'Register failed' });
//   }
// });

// app.get("/", (req, res) => {
//   res.send("Backend is working 🎉");
// });

// app.post('/api/auth/login', async (req, res) => {
//   const { email, password } = req.body;
//   const user = await User.findOne({ email });
//   if (!user) return res.status(401).json({ message: 'Invalid credentials' });
//   const ok = await bcrypt.compare(password, user.passwordHash);
//   if (!ok) return res.status(401).json({ message: 'Invalid credentials' });
//   const token = signToken(user);
//   res.json({ token, user: { id: user._id, name: user.name, email: user.email } });
// });

// app.get('/api/auth/me', auth, async (req, res) => {
//   const user = await User.findById(req.user.sub).select('_id name email');
//   res.json({ user });
// });

// const PORT = process.env.PORT || 4000;
// app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));

// // const express = require('express');
// // const mongoose = require('mongoose');
// // const cors = require('cors');
// // require('dotenv').config();

// // const app = express();
// // app.use(cors());
// // app.use(express.json());

// // // Connect to MongoDB
// // mongoose.connect(process.env.MONGO_URI, {
// //   useNewUrlParser: true,
// //   useUnifiedTopology: true,
// // })
// // .then(() => console.log('✅ MongoDB Connected'))
// // .catch(err => console.log(err));

// // // Test Route
// // app.get('/', (req, res) => {
// //   res.send('API is working 🚀');
// // });

// // // Start Server
// // const PORT = process.env.PORT || 5000;
// // app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
