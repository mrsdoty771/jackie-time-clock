const mongoose = require('mongoose');

// Apartment building rule:
// Every document includes companyId and queries must filter by companyId.
const PunchSchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, index: true },

    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    employeeName: { type: String }, // optional snapshot for faster reads

    punchType: {
      type: String,
      required: true,
      enum: ['clock_in', 'clock_out', 'lunch_in', 'lunch_out'],
      index: true,
    },
    punchTime: { type: Date, default: Date.now, index: true },

    notes: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Punch', PunchSchema);

