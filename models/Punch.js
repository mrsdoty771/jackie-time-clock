const mongoose = require('mongoose');

// Apartment building rule:
// Every document includes companyId and queries must filter by companyId.
const PunchSchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, index: true },

    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    employeeName: { type: String }, // optional snapshot for faster reads

    /** Local date (YYYY-MM-DD) in the company's timezone; used for de-dupe rules. */
    punchLocalDate: { type: String, index: true },

    punchType: {
      type: String,
      required: true,
      enum: ['clock_in', 'clock_out', 'lunch_in', 'lunch_out'],
      index: true,
    },
    punchTime: { type: Date, default: Date.now, index: true },
    /** First recorded punch instant; stays fixed when a manager corrects punchTime. */
    originalPunchTime: { type: Date },

    notes: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    /**
     * Employee-reported corrections (e.g. forgotten clock-out) need manager approval.
     * Normal punches use 'none'. Employee-submitted clock-outs use 'pending' until reviewed.
     */
    approvalStatus: {
      type: String,
      enum: ['none', 'pending', 'approved', 'rejected'],
      default: 'none',
      index: true,
    },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
  },
  { timestamps: true }
);

// Enforce: only one of each punch type per employee per company per local day
PunchSchema.index(
  { companyId: 1, employeeId: 1, punchType: 1, punchLocalDate: 1 },
  {
    unique: true,
    name: 'uniq_punch_type_per_day',
    // Allow existing legacy rows (missing punchLocalDate) while enforcing all new/updated rows.
    partialFilterExpression: { punchLocalDate: { $exists: true, $type: 'string' } },
  }
);

module.exports = mongoose.model('Punch', PunchSchema);
