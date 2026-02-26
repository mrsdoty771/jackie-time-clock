const router = require('express').Router();
const authController = require('../controllers/authController');
const { requireAuth, requireCompany, requireManager } = require('../middleware/auth');

router.get('/login-options', authController.getLoginOptions);
router.post('/login', authController.login);
router.post('/forgot-password', authController.resetPassword);
router.post('/logout', authController.logout);
router.get('/me', authController.me);
router.get('/profile', requireAuth, requireCompany, authController.getProfile);
router.put('/profile', requireAuth, requireCompany, authController.updateProfile);
router.post('/profile/test-email', requireAuth, requireCompany, requireManager, authController.testEmail);

module.exports = router;

