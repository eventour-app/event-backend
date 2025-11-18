const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const Business = require('../models/Business');
const Transaction = require('../models/Transaction');

function err(res, status, message, code, details) { return res.status(status).json({ error: true, message, code, ...(details?{details}:{}) }); }
function mapOrder(o) {
  return {
    _id: o._id,
    status: o.status,
    total: o.total,
    scheduledAt: o.scheduledAt || null,
    startTime: o.startTime || null,
    date: o.date || null,
    time: o.time || null,
    createdAt: o.createdAt,
    customer: { name: o.customerName, phone: o.customerPhone },
    serviceName: o.serviceName,
    packageName: o.packageName,
    location: o.location || o.venue || null,
    venue: o.venue || o.location || null,
    notes: o.notes || null,
  };
}

// GET /api/orders/business/:businessId?status=pending,accepted&page=1&limit=20
router.get('/business/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const { page = 1, limit = 20, status } = req.query;
    const p = Math.max(1, Number(page));
    const l = Math.min(100, Math.max(1, Number(limit)));

    const filter = { businessId };
    if (status) {
      const statuses = String(status).split(',').map(s => s.trim()).filter(Boolean);
      if (statuses.length) filter.status = { $in: statuses };
    }

    const totalItems = await Order.countDocuments(filter);
    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .skip((p - 1) * l)
      .limit(l)
      .lean();

    res.json({ orders: orders.map(mapOrder), page: p, limit: l, totalItems, totalPages: Math.ceil(totalItems / l) });
  } catch (e) {
    console.error('list orders error', e);
    err(res, 500, 'Failed to fetch orders', 'SERVER_ERROR');
  }
});

// GET /api/orders/:orderId
router.get('/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findById(orderId).lean();
    if (!order) return err(res, 404, 'Order not found', 'NOT_FOUND');
    res.json({ order: mapOrder(order) });
  } catch (e) {
    console.error('get order error', e);
    err(res, 500, 'Failed to fetch order', 'SERVER_ERROR');
  }
});

// PUT /api/orders/:orderId/status { status }
router.put('/:orderId/status', async (req, res) => {
  try {
    const { orderId } = req.params;
  const { status } = req.body || {};
  const allowed = ['accepted','declined','completed','cancelled','in_progress','on_the_way'];
    if (!allowed.includes(status)) return err(res, 400, 'Invalid status', 'VALIDATION_FAILED', { allowed });
    // Only allow vendor role to update order status
    const hdr = req.headers.authorization || '';
    const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
    try {
      if (token) {
        const decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET);
        if (decoded && decoded.role && decoded.role !== 'vendor') {
          return err(res, 403, 'Forbidden', 'FORBIDDEN');
        }
      }
    } catch {
      return err(res, 401, 'Invalid token', 'UNAUTHORIZED');
    }
    const order = await Order.findById(orderId);
    if (!order) return err(res, 404, 'Order not found', 'NOT_FOUND');
    order.status = status;
    await order.save();
    // Update related booking transaction status
    const txStatusMap = {
      accepted: 'processing',
      in_progress: 'processing',
      on_the_way: 'processing',
      completed: 'completed',
      cancelled: 'failed',
      declined: 'failed',
    };
    const txStatus = txStatusMap[status];
    if (txStatus) {
      await Transaction.updateMany({ orderId: order._id, type: 'booking' }, { $set: { status: txStatus } });
    }
    res.json({ order: { _id: order._id, status: order.status, updatedAt: order.updatedAt } });
  } catch (e) {
    console.error('update order status error', e);
    err(res, 500, 'Failed to update order status', 'SERVER_ERROR');
  }
});

// POST /api/orders/:orderId/message { body }
router.post('/:orderId/message', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { body } = req.body || {};
    if (!body || typeof body !== 'string') return err(res, 400, 'Message body required', 'VALIDATION_FAILED');
    // Determine sender role based on token (default vendor)
    let senderRole = 'vendor';
    const hdr = req.headers.authorization || '';
    const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
    try {
      if (token) {
        const decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET);
        if (decoded && decoded.role === 'customer') senderRole = 'customer';
      }
    } catch {}
    const order = await Order.findById(orderId);
    if (!order) return err(res, 404, 'Order not found', 'NOT_FOUND');
    order.messages.push({ senderRole, body });
    await order.save();
    res.status(201).json({ message: 'Message added', orderId: order._id });
  } catch (e) {
    console.error('add order message error', e);
    err(res, 500, 'Failed to add message', 'SERVER_ERROR');
  }
});

module.exports = router;
