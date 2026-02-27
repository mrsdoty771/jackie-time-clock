const router = require('express').Router();
const punchController = require('../controllers/punchController');
const { requireAuth, requireCompany, requireManager } = require('../middleware/auth');

router.get('/company-admin-employee', requireAuth, requireCompany, requireManager, punchController.getCompanyAdminEmployee);
router.post('/punch', requireAuth, requireCompany, punchController.createPunch);
router.get('/punches', requireAuth, requireCompany, punchController.listPunches);
router.get('/punches/:id', requireAuth, requireCompany, requireManager, punchController.getPunch);
router.put('/punches/:id', requireAuth, requireCompany, requireManager, punchController.updatePunch);
router.delete('/punches/:id', requireAuth, requireCompany, requireManager, punchController.deletePunch);

module.exports = router;

