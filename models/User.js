const mongoose = require('mongoose');

// Apartment building rule:
// Every document includes companyId and queries must filter by companyId.
const UserSchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, index: true },

    username: { type: String, required: true, index: true },
    email: { type: String, trim: true, lowercase: true, default: null },
    password: { type: String, required: true }, // bcrypt hash

    role: { type: String, enum: ['manager', 'employee', 'super-admin'], default: 'employee' },

    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  },
  { timestamps: true }
);

// Username must be unique within a company (not globally)
UserSchema.index({ companyId: 1, username: 1 }, { unique: true });

module.exports = mongoose.model('User', UserSchema);