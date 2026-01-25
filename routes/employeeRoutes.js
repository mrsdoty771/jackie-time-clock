const router = require('express').Router();
const employeeController = require('../controllers/employeeController');
const { requireAuth, requireCompany, requireManager } = require('../middleware/auth');

// Public login dropdown
router.get('/employees/public', employeeController.listPublicEmployees);

// Authenticated employee management
router.get('/employees', requireAuth, requireCompany, employeeController.listEmployees);
router.post('/employees', requireAuth, requireCompany, requireManager, employeeController.createEmployee);
router.put('/employees/:id', requireAuth, requireCompany, requireManager, employeeController.updateEmployee);
router.put('/employees/:id/password', requireAuth, requireCompany, requireManager, employeeController.setEmployeePassword);
router.delete('/employees/:id', requireAuth, requireCompany, requireManager, employeeController.deactivateEmployee);

module.exports = router;

