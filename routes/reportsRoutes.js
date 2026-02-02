const router = require('express').Router();
const reportsController = require('../controllers/reportsController');
const { requireAuth, requireCompany, requireManager } = require('../middleware/auth');

router.get('/reports/weekly', requireAuth, requireCompany, reportsController.weekly);
router.post('/reports/email', requireAuth, requireCompany, requireManager, reportsController.emailReport);

module.exports = router;

