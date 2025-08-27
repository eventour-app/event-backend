require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();

// middleware
app.use(cors({
  origin: "http://localhost:8081",
  methods: ["GET", "POST"],
  credentials: true
}));
app.use(express.json());

// connect MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.error("MongoDB connection error:", err));

// test route
app.get("/", (req, res) => {
  res.send("Backend is working 🎉");
});

// routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/cities', require('./routes/cityRoutes')); // will create later

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
