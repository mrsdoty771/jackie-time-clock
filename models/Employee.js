const mongoose = require('mongoose');

// Apartment building rule:
// Every document includes companyId and queries must filter by companyId.
const EmployeeSchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, index: true },

    name: { type: String, required: true },
    employeeNumber: { type: String, required: true },
    email: { type: String },
    phone: { type: String },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

// Employee numbers must be unique within a company
EmployeeSchema.index({ companyId: 1, employeeNumber: 1 }, { unique: true });

module.exports = mongoose.model('Employee', EmployeeSchema);

