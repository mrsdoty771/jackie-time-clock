const mongoose = require('mongoose');

const CompanySettingsSchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, unique: true, index: true },
    companyName: { type: String, required: true, default: 'MVC' },
    logoData: { type: String, default: null }, // data URL (e.g. data:image/png;base64,...) for dashboard logo
  },
  { timestamps: true }
);

module.exports = mongoose.model('CompanySettings', CompanySettingsSchema);

