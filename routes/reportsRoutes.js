const router = require('express').Router();
const reportsController = require('../controllers/reportsController');
const { requireAuth, requireCompany } = require('../middleware/auth');

router.get('/reports/weekly', requireAuth, requireCompany, reportsController.weekly);

module.exports = router;

