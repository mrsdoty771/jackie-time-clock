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
    /** Twilio SMS — per-company; env vars used as fallback when a field is empty. */
    twilioAccountSid: { type: String, default: null, trim: true },
    twilioAuthTokenEncrypted: { type: String, default: null },
    twilioPhoneNumber: { type: String, default: null, trim: true },
    /** Legacy single punch-notification number; superseded by twilioNotifyRecipients. */
    twilioNotifyPhone: { type: String, default: null, trim: true },
    /** Everyone who gets a text when an employee punches. Name is a label only. */
    twilioNotifyRecipients: {
      type: [
        {
          _id: false,
          name: { type: String, default: '', trim: true },
          phone: { type: String, default: '', trim: true },
        },
      ],
      default: [],
    },
    /** Public HTTPS URL for login invite links in SMS (overrides BASE_URL env when set). */
    publicBaseUrl: { type: String, default: null, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CompanySettings', CompanySettingsSchema);

