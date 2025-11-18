const express = require('express');
const router = express.Router();
const Announcement = require('../models/Announcement');
const Order = require('../models/Order');
const Transaction = require('../models/Transaction');
const Review = require('../models/Review');
const Business = require('../models/Business');

function err(res, status, message, code, details) { return res.status(status).json({ error: true, message, code, ...(details?{details}:{}) }); }

// Announcements
// GET /api/vendors/:businessId/announcements?limit=5
router.get('/:businessId/announcements', async (req, res) => {
  try {
    const { businessId } = req.params;
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 5));
    const announcements = await Announcement.find({ businessId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    res.json({ announcements });
  } catch (e) {
    console.error('get announcements error', e);
    err(res, 500, 'Failed to fetch announcements', 'SERVER_ERROR');
  }
});

// POST /api/vendors/:businessId/announcements { title, desc?, icon? }
router.post('/:businessId/announcements', async (req, res) => {
  try {
    const { businessId } = req.params;
    const { title, desc, icon } = req.body || {};
    if (!title) return err(res, 400, 'title is required', 'VALIDATION_FAILED');
    const announcement = await Announcement.create({ businessId, title: String(title).trim(), desc, icon });
    res.status(201).json({ announcement });
  } catch (e) {
    console.error('create announcement error', e);
    err(res, 500, 'Failed to create announcement', 'SERVER_ERROR');
  }
});

// GET /api/vendors/:businessId/home-metrics?date=today
router.get('/:businessId/home-metrics', async (req, res) => {
  try {
    const { businessId } = req.params;
    // date param reserved for future; currently always "today"
    const start = new Date();
    start.setHours(0,0,0,0);
    const end = new Date();
    end.setHours(23,59,59,999);

    const todayOrders = await Order.find({ businessId, createdAt: { $gte: start, $lte: end } }).lean();
    const bookingsToday = todayOrders.length;
    const earningsToday = todayOrders.reduce((sum, o) => sum + (o.total || 0), 0);

  const upcomingCount = await Order.countDocuments({ businessId, status: { $in: ['pending','accepted','upcoming','in_progress','on_the_way'] } });

    const biz = await Business.findById(businessId).select('ratingAvg ratingCount').lean();
    const rating = biz && biz.ratingAvg != null ? Number(biz.ratingAvg.toFixed(2)) : null;

    const cancellationsToday = todayOrders.filter(o => ['cancelled','declined'].includes(o.status)).length;

    res.json({ bookingsToday, earningsToday, rating, upcomingCount, cancellationsToday });
  } catch (e) {
    console.error('home-metrics error', e);
    err(res, 500, 'Failed to fetch metrics', 'SERVER_ERROR');
  }
});

// GET /api/vendors/:businessId/earnings-summary?range=this-month
router.get('/:businessId/earnings-summary', async (req, res) => {
  try {
    const { businessId } = req.params;
    const { range = 'this-month' } = req.query;

    let from, to;
    const now = new Date();
    if (range === 'this-month') {
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      to = new Date(now.getFullYear(), now.getMonth()+1, 0, 23,59,59,999);
    } else if (range === 'today') {
      from = new Date(); from.setHours(0,0,0,0); to = new Date(); to.setHours(23,59,59,999);
    } else {
      return err(res, 400, 'Unsupported range', 'VALIDATION_FAILED');
    }

    const transactions = await Transaction.find({ businessId, date: { $gte: from, $lte: to } }).lean();
    const grossBookings = transactions.filter(t => t.type === 'booking').reduce((s,t)=>s+t.amount,0);
    const commissions = transactions.filter(t => t.type === 'commission').reduce((s,t)=>s+t.amount,0);
    const withdrawals = transactions.filter(t => t.type === 'withdrawal').reduce((s,t)=>s+t.amount,0);

    const gross = grossBookings;
    const commission = commissions;
    const net = gross - commission;
    const withdrawable = net - withdrawals; // simplistic model; adjust for pending states
    const pending = transactions.filter(t => t.status === 'pending').reduce((s,t)=>s+t.amount,0);

    res.json({ range, gross, net, commission, withdrawable, pending, currency: 'INR' });
  } catch (e) {
    console.error('earnings-summary error', e);
    err(res, 500, 'Failed to fetch earnings summary', 'SERVER_ERROR');
  }
});

// GET /api/vendors/:businessId/transactions?page=1&limit=20
router.get('/:businessId/transactions', async (req, res) => {
  try {
    const { businessId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const p = Math.max(1, Number(page));
    const l = Math.min(100, Math.max(1, Number(limit)));

    const filter = { businessId };
    const totalItems = await Transaction.countDocuments(filter);
    const transactions = await Transaction.find(filter)
      .sort({ date: -1 })
      .skip((p - 1) * l)
      .limit(l)
      .lean();
    res.json({ transactions: transactions.map(t => ({ id: t._id, type: t.type, amount: t.amount, date: t.date, mode: t.mode, status: t.status })), page: p, limit: l, totalItems, totalPages: Math.ceil(totalItems / l) });
  } catch (e) {
    console.error('transactions error', e);
    err(res, 500, 'Failed to fetch transactions', 'SERVER_ERROR');
  }
});

// GET /api/vendors/:businessId/reviews?limit=3
router.get('/:businessId/reviews', async (req, res) => {
  try {
    const { businessId } = req.params;
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 3));
    const reviews = await Review.find({ businessId }).sort({ createdAt: -1 }).limit(limit).lean();
    const averageRatingAgg = await Review.aggregate([
      { $match: { businessId: require('mongoose').Types.ObjectId.createFromHexString(businessId) } },
      { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } }
    ]);
    const averageRating = averageRatingAgg.length ? Number(averageRatingAgg[0].avg.toFixed(2)) : null;

    // Update snapshot on Business
    if (averageRating != null) {
      await Business.findByIdAndUpdate(businessId, { $set: { ratingAvg: averageRating, ratingCount: averageRatingAgg[0].count } });
    }

    res.json({ reviews: reviews.map(r => ({ id: r._id, customerName: r.customerName, rating: r.rating, comment: r.comment, createdAt: r.createdAt })), averageRating });
  } catch (e) {
    console.error('reviews error', e);
    err(res, 500, 'Failed to fetch reviews', 'SERVER_ERROR');
  }
});

module.exports = router;
