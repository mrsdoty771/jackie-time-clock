const router = require('express').Router();
const authController = require('../controllers/authController');

router.get('/login-options', authController.getLoginOptions);
router.post('/login', authController.login);
router.post('/logout', authController.logout);
router.get('/me', authController.me);

module.exports = router;

