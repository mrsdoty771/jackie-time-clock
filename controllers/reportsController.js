const Punch = require('../models/Punch');
const Employee = require('../models/Employee');

function parseDateOnly(dateStr) {
  if (!dateStr) return null;
  const d = new Date(String(dateStr) + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? null : d;
}

function dateKeyLocal(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// GET /api/reports/weekly?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&employee_id?
async function weekly(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const companyId = req.companyId;
  const user = req.session.user;

  const startDate = parseDateOnly(req.query.start_date);
  const endDate = parseDateOnly(req.query.end_date);

  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'start_date and end_date are required' });
  }
  if (startDate > endDate) {
    return res.status(400).json({ error: 'start_date must be before or equal to end_date' });
  }

  const filter = { companyId };
  if (user.role === 'employee') {
    filter.employeeId = user.employee_id;
  } else if (req.query.employee_id) {
    filter.employeeId = req.query.employee_id;
  }

  const endInclusive = new Date(endDate.getTime() + 24 * 60 * 60 * 1000 - 1);
  filter.punchTime = { $gte: startDate, $lte: endInclusive };

  try {
    const punches = await Punch.find(filter).sort({ employeeId: 1, punchTime: 1 }).lean();

    // Load employee details for employee_number/name (multi-tenant safe)
    const employeeIds = Array.from(new Set(punches.map((p) => String(p.employeeId))));
    const employees = await Employee.find({ companyId, _id: { $in: employeeIds } })
      .select('_id name employeeNumber')
      .lean();
    const empMap = new Map(employees.map((e) => [String(e._id), e]));

    const employeeMap = {};

    punches.forEach((p) => {
      const empId = String(p.employeeId);
      const emp = empMap.get(empId);
      const empName = emp?.name || p.employeeName || 'Employee';
      const empNum = emp?.employeeNumber || null;
      const dayKey = dateKeyLocal(p.punchTime);

      if (!employeeMap[empId]) {
        employeeMap[empId] = {
          employee_id: empId,
          employee_name: empName,
          employee_number: empNum,
          days: {},
          total_hours: 0,
        };
      }

      if (!employeeMap[empId].days[dayKey]) {
        employeeMap[empId].days[dayKey] = { date: dayKey, punches: [], hours: 0 };
      }

      employeeMap[empId].days[dayKey].punches.push({
        type: p.punchType,
        time: p.punchTime,
        notes: p.notes || null,
      });
    });

    // Calculate hours
    Object.values(employeeMap).forEach((emp) => {
      Object.values(emp.days).forEach((day) => {
        let clockIn = null;
        let clockOut = null;
        let lunchIn = null;
        let lunchOut = null;

        day.punches.sort((a, b) => new Date(a.time) - new Date(b.time));
        day.punches.forEach((p) => {
          if (p.type === 'clock_in') clockIn = new Date(p.time);
          if (p.type === 'clock_out') clockOut = new Date(p.time);
          if (p.type === 'lunch_in') lunchIn = new Date(p.time);
          if (p.type === 'lunch_out') lunchOut = new Date(p.time);
        });

        let hours = 0;
        if (clockIn && clockOut) {
          hours = (clockOut - clockIn) / (1000 * 60 * 60);
          if (lunchIn && lunchOut) {
            const lunchHours = (lunchIn - lunchOut) / (1000 * 60 * 60);
            hours -= lunchHours;
          }
          hours = Math.max(0, hours);
        }

        day.hours = parseFloat(hours.toFixed(2));
        emp.total_hours += day.hours;
      });
      emp.total_hours = parseFloat(emp.total_hours.toFixed(2));
    });

    return res.json(Object.values(employeeMap));
  } catch (err) {
    console.error('weekly report error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

module.exports = { weekly };

