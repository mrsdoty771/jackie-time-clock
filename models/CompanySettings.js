const mongoose = require('mongoose');

const CompanySettingsSchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, unique: true, index: true },
    companyName: { type: String, required: true, default: 'MVC' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CompanySettings', CompanySettingsSchema);

