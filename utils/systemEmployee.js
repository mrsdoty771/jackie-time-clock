/** Internal punch target for managers/super-admins without a linked employee — not a real staff member. */
const SYSTEM_CLOCK_EMPLOYEE_NUMBER = 'ADMIN';

function isSystemClockEmployee(emp) {
  if (!emp) return false;
  const num = emp.employeeNumber != null ? emp.employeeNumber : emp.employee_number;
  return String(num || '').trim().toUpperCase() === SYSTEM_CLOCK_EMPLOYEE_NUMBER;
}

/** Mongo filter fragment: exclude the system clock employee from staff listings. */
function excludeSystemClockEmployeesFilter() {
  return { employeeNumber: { $ne: SYSTEM_CLOCK_EMPLOYEE_NUMBER } };
}

module.exports = {
  SYSTEM_CLOCK_EMPLOYEE_NUMBER,
  isSystemClockEmployee,
  excludeSystemClockEmployeesFilter,
};
