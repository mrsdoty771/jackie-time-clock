const mongoose = require('mongoose');

const CompanySettingsSchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, unique: true, index: true },
    companyName: { type: String, required: true, default: 'MVC' },
    logoData: { type: String, default: null }, // data URL (e.g. data:image/png;base64,...) for dashboard logo
    companyAdminEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
    timezone: { type: String, default: 'UTC', trim: true }, // IANA timezone e.g. America/New_York
    /** First day of the 7-day pay week (0=Sunday … 6=Saturday, same as Date.getDay()). Default Monday. */
    payWeekStartDay: { type: Number, default: 1 },
    /** Last day of the pay week (six days after start; default Sunday for Mon–Sun week). */
    payWeekEndDay: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CompanySettings', CompanySettingsSchema);

