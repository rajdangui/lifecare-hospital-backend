const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// GET /api/appointments - patient gets own, admin gets all
router.get('/', authMiddleware, async (req, res) => {
  try {
    let query, params;
    const { status, doctor_id } = req.query;

    if (req.user.role === 'admin') {
      query = `
        SELECT a.*, u.name as patient_name, u.email as patient_email, u.phone as patient_phone,
               d.name as doctor_name, d.specialization, dep.name as department_name
        FROM appointments a
        JOIN users u ON a.patient_id = u.id
        JOIN doctors d ON a.doctor_id = d.id
        LEFT JOIN departments dep ON d.department_id = dep.id
        WHERE 1=1
      `;
      params = [];
      if (status) { query += ' AND a.status = ?'; params.push(status); }
      if (doctor_id) { query += ' AND a.doctor_id = ?'; params.push(doctor_id); }
    } else {
      query = `
        SELECT a.*, d.name as doctor_name, d.specialization, d.consultation_fee,
               dep.name as department_name
        FROM appointments a
        JOIN doctors d ON a.doctor_id = d.id
        LEFT JOIN departments dep ON d.department_id = dep.id
        WHERE a.patient_id = ?
      `;
      params = [req.user.id];
      if (status) { query += ' AND a.status = ?'; params.push(status); }
    }

    query += ' ORDER BY a.appointment_date DESC, a.appointment_time ASC';
    const [appointments] = await db.execute(query, params);
    res.json({ success: true, appointments });
  } catch (err) {
    console.error('Get appointments error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/appointments - book appointment
router.post('/', authMiddleware, async (req, res) => {
  const { doctor_id, appointment_date, appointment_time, reason } = req.body;

  if (!doctor_id || !appointment_date || !appointment_time) {
    return res.status(400).json({ success: false, message: 'Doctor, date, and time are required' });
  }

  try {
    // Check slot availability
    const [existing] = await db.execute(
      "SELECT id FROM appointments WHERE doctor_id = ? AND appointment_date = ? AND appointment_time = ? AND status NOT IN ('cancelled')",
      [doctor_id, appointment_date, appointment_time]
    );
    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: 'This slot is already booked' });
    }

    // Check patient doesn't double-book same doctor same day
    const [patientExisting] = await db.execute(
      "SELECT id FROM appointments WHERE patient_id = ? AND doctor_id = ? AND appointment_date = ? AND status NOT IN ('cancelled')",
      [req.user.id, doctor_id, appointment_date]
    );
    if (patientExisting.length > 0) {
      return res.status(409).json({ success: false, message: 'You already have an appointment with this doctor on this date' });
    }

    const [result] = await db.execute(
      'INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, reason, status) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, doctor_id, appointment_date, appointment_time, reason || null, 'pending']
    );

    res.status(201).json({
      success: true,
      message: 'Appointment booked successfully',
      appointment_id: result.insertId
    });
  } catch (err) {
    console.error('Book appointment error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// PUT /api/appointments/:id/status - update status
router.put('/:id/status', authMiddleware, async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled'];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid status' });
  }

  try {
    // Check ownership or admin
    const [appointments] = await db.execute('SELECT * FROM appointments WHERE id = ?', [req.params.id]);
    if (appointments.length === 0) return res.status(404).json({ success: false, message: 'Appointment not found' });

    const appt = appointments[0];
    if (req.user.role !== 'admin' && appt.patient_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    // Patients can only cancel
    if (req.user.role !== 'admin' && status !== 'cancelled') {
      return res.status(403).json({ success: false, message: 'Patients can only cancel appointments' });
    }

    await db.execute('UPDATE appointments SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ success: true, message: `Appointment ${status}` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// PUT /api/appointments/:id/notes - add notes (admin)
router.put('/:id/notes', authMiddleware, adminMiddleware, async (req, res) => {
  const { notes } = req.body;
  try {
    await db.execute('UPDATE appointments SET notes = ? WHERE id = ?', [notes, req.params.id]);
    res.json({ success: true, message: 'Notes updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/appointments/stats - admin dashboard stats
router.get('/stats', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [[totals]] = await db.execute(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
        SUM(CASE WHEN appointment_date = CURDATE() THEN 1 ELSE 0 END) as today
      FROM appointments
    `);

    const [[patientCount]] = await db.execute("SELECT COUNT(*) as count FROM users WHERE role = 'patient'");
    const [[doctorCount]] = await db.execute('SELECT COUNT(*) as count FROM doctors WHERE is_active = TRUE');

    res.json({
      success: true,
      stats: {
        ...totals,
        total_patients: patientCount.count,
        total_doctors: doctorCount.count
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
