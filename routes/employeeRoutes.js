const router = require('express').Router();
const employeeController = require('../controllers/employeeController');
const { requireAuth, requireCompany, requireManager } = require('../middleware/auth');

// Public login dropdown
router.get('/employees/public', employeeController.listPublicEmployees);

// Authenticated employee management
router.get('/employees', requireAuth, requireCompany, employeeController.listEmployees);
router.get('/employees/next-number', requireAuth, requireCompany, requireManager, employeeController.getNextEmployeeNumber);
router.get('/employees/:id', requireAuth, requireCompany, requireManager, employeeController.getEmployee);
router.post('/employees', requireAuth, requireCompany, requireManager, employeeController.createEmployee);
router.post(
  '/employees/:id/send-login-text',
  requireAuth,
  requireCompany,
  requireManager,
  employeeController.sendEmployeeLoginText
);
router.put('/employees/:id', requireAuth, requireCompany, requireManager, employeeController.updateEmployee);
router.put('/employees/:id/terminate', requireAuth, requireCompany, requireManager, employeeController.terminateEmployee);
router.put('/employees/:id/password', requireAuth, requireCompany, requireManager, employeeController.setEmployeePassword);
router.delete('/employees/:id', requireAuth, requireCompany, requireManager, employeeController.deactivateEmployee);
router.post('/employees/:id/grant-manager', requireAuth, requireCompany, requireManager, employeeController.grantManager);
router.post('/employees/:id/revoke-manager', requireAuth, requireCompany, requireManager, employeeController.revokeManager);

module.exports = router;

