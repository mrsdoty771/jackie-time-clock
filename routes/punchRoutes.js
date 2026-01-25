const router = require('express').Router();
const punchController = require('../controllers/punchController');
const { requireAuth, requireCompany, requireManager } = require('../middleware/auth');

router.post('/punch', requireAuth, requireCompany, punchController.createPunch);
router.get('/punches', requireAuth, requireCompany, punchController.listPunches);
router.delete('/punches/:id', requireAuth, requireCompany, requireManager, punchController.deletePunch);

module.exports = router;

