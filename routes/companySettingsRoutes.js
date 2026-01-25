const router = require('express').Router();
const companySettingsController = require('../controllers/companySettingsController');
const { requireAuth, requireCompany, requireManager } = require('../middleware/auth');

router.get('/company-settings', companySettingsController.getCompanySettings);
router.put('/company-settings', requireAuth, requireCompany, requireManager, companySettingsController.updateCompanySettings);

module.exports = router;

