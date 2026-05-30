const mongoose = require('mongoose');

const LoginInviteSchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, index: true },
    token: { type: String, required: true, unique: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    expiresAt: { type: Date, required: true, index: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('LoginInvite', LoginInviteSchema);
