const mongoose = require('mongoose');

// Apartment building rule:
// Every document includes companyId and queries must filter by companyId.
const UserSchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, index: true },

    username: { type: String, required: true, index: true },
    name: { type: String, trim: true, default: null },
    email: { type: String, trim: true, lowercase: true, default: null },
    ext: { type: String, trim: true, default: null },
    password: { type: String, required: true }, // bcrypt hash

    role: { type: String, enum: ['manager', 'employee', 'super-admin'], default: 'employee' },

    // E-mail Address Setup (per-manager SMTP for report emails)
    displayName: { type: String, trim: true, default: null },
    smtpHost: { type: String, trim: true, default: null },
    smtpPort: { type: Number, default: null },
    smtpSecure: { type: Boolean, default: false },
    smtpUser: { type: String, trim: true, default: null },
    smtpPassEncrypted: { type: String, default: null },
    defaultEmailBody: { type: String, default: null },

    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  },
  { timestamps: true }
);

// Username must be unique within a company (not globally)
UserSchema.index({ companyId: 1, username: 1 }, { unique: true });

module.exports = mongoose.model('User', UserSchema);