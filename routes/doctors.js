const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// GET /api/doctors - list all doctors with department info
router.get('/', async (req, res) => {
  const { department_id, search } = req.query;
  try {
    let query = `
      SELECT d.*, dep.name as department_name, dep.icon as department_icon
      FROM doctors d
      LEFT JOIN departments dep ON d.department_id = dep.id
      WHERE d.is_active = TRUE
    `;
    const params = [];

    if (department_id) {
      query += ' AND d.department_id = ?';
      params.push(department_id);
    }
    if (search) {
      query += ' AND (d.name LIKE ? OR d.specialization LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    query += ' ORDER BY d.name ASC';

    const [doctors] = await db.execute(query, params);
    res.json({ success: true, doctors });
  } catch (err) {
    console.error('Get doctors error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/doctors/:id
router.get('/:id', async (req, res) => {
  try {
    const [doctors] = await db.execute(
      `SELECT d.*, dep.name as department_name, dep.icon as department_icon
       FROM doctors d
       LEFT JOIN departments dep ON d.department_id = dep.id
       WHERE d.id = ? AND d.is_active = TRUE`,
      [req.params.id]
    );
    if (doctors.length === 0) {
      return res.status(404).json({ success: false, message: 'Doctor not found' });
    }
    res.json({ success: true, doctor: doctors[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/doctors/:id/slots?date=YYYY-MM-DD
router.get('/:id/slots', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ success: false, message: 'Date required' });

  try {
    const [doctors] = await db.execute(
      'SELECT start_time, end_time, slot_duration, available_days FROM doctors WHERE id = ? AND is_active = TRUE',
      [req.params.id]
    );
    if (doctors.length === 0) return res.status(404).json({ success: false, message: 'Doctor not found' });

    const doctor = doctors[0];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayOfWeek = dayNames[new Date(date).getDay()];
    const availableDays = doctor.available_days.split(',');

    if (!availableDays.includes(dayOfWeek)) {
      return res.json({ success: true, slots: [], message: 'Doctor not available on this day' });
    }

    // Get existing appointments for this date
    const [booked] = await db.execute(
      "SELECT appointment_time FROM appointments WHERE doctor_id = ? AND appointment_date = ? AND status NOT IN ('cancelled')",
      [req.params.id, date]
    );
    const bookedTimes = booked.map(b => b.appointment_time.slice(0, 5));

    // Generate slots
    const slots = [];
    const [startH, startM] = doctor.start_time.split(':').map(Number);
    const [endH, endM] = doctor.end_time.split(':').map(Number);
    const startMin = startH * 60 + startM;
    const endMin = endH * 60 + endM;

    for (let m = startMin; m < endMin; m += doctor.slot_duration) {
      const h = Math.floor(m / 60).toString().padStart(2, '0');
      const min = (m % 60).toString().padStart(2, '0');
      const timeStr = `${h}:${min}`;
      slots.push({ time: timeStr, available: !bookedTimes.includes(timeStr) });
    }

    res.json({ success: true, slots });
  } catch (err) {
    console.error('Get slots error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Admin: POST /api/doctors
router.post('/', authMiddleware, adminMiddleware, async (req, res) => {
  const { name, email, phone, department_id, specialization, qualification, experience_years, bio, consultation_fee, available_days, start_time, end_time, slot_duration } = req.body;
  try {
    const [result] = await db.execute(
      'INSERT INTO doctors (name, email, phone, department_id, specialization, qualification, experience_years, bio, consultation_fee, available_days, start_time, end_time, slot_duration) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [name, email, phone, department_id, specialization, qualification, experience_years || 0, bio, consultation_fee || 0, available_days || 'Mon,Tue,Wed,Thu,Fri', start_time || '09:00', end_time || '17:00', slot_duration || 30]
    );
    res.status(201).json({ success: true, message: 'Doctor created', id: result.insertId });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
