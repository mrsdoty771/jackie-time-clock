const mongoose = require('mongoose');

const CompanySchema = new mongoose.Schema(
  {
    // Human-friendly name shown in dashboards (e.g., "MVC")
    name: { type: String, required: true, trim: true },

    // Unique identifier (maps to existing `companyId` usage across the app)
    // Examples: "MVC", "ALF", "mvc-plumbing"
    slug: { type: String, required: true, trim: true, unique: true, index: true },

    status: { type: String, enum: ['Active', 'Suspended', 'Trial'], default: 'Trial', required: true },

    subscriptionEndDate: { type: Date, default: null },
  },
  { timestamps: true }
);

CompanySchema.index({ status: 1 });

module.exports = mongoose.model('Company', CompanySchema);

