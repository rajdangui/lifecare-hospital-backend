const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET /api/departments
router.get('/', async (req, res) => {
  try {
    const [departments] = await db.execute(`
      SELECT d.*, COUNT(doc.id) as doctor_count
      FROM departments d
      LEFT JOIN doctors doc ON d.id = doc.department_id AND doc.is_active = TRUE
      GROUP BY d.id
      ORDER BY d.name ASC
    `);
    res.json({ success: true, departments });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
