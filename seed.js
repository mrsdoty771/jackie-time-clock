const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

/**
 * Safe seed script (no hardcoded secrets).
 *
 * Usage (PowerShell example):
 *   $env:SUPER_ADMIN_COMPANY_ID="master-branch"
 *   $env:SUPER_ADMIN_USERNAME="JackieAdmin"
 *   $env:SUPER_ADMIN_EMAIL="you@yourdomain.com"
 *   $env:SUPER_ADMIN_PASSWORD="a-strong-password"
 *   node seed.js
 */
async function main() {
  const databaseUrl = String(process.env.DATABASE_URL || '').trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');

  const companyId = String(process.env.SUPER_ADMIN_COMPANY_ID || '').trim();
  const username = String(process.env.SUPER_ADMIN_USERNAME || '').trim();
  const email = String(process.env.SUPER_ADMIN_EMAIL || '').trim();
  const password = String(process.env.SUPER_ADMIN_PASSWORD || '').trim();

  if (!companyId) throw new Error('SUPER_ADMIN_COMPANY_ID is required');
  if (!username) throw new Error('SUPER_ADMIN_USERNAME is required');
  if (!email) throw new Error('SUPER_ADMIN_EMAIL is required');
  if (!password) throw new Error('SUPER_ADMIN_PASSWORD is required');

  await mongoose.connect(databaseUrl, { serverSelectionTimeoutMS: 10000 });
  console.log('Connected to MongoDB');

  const User = require('./models/User');

  const existing = await User.findOne({ companyId, $or: [{ email }, { username }] }).lean();
  if (existing) {
    console.log('Super Admin already exists.');
    return;
  }

  await User.create({
    companyId,
    username,
    email,
    password: bcrypt.hashSync(password, 10),
    role: 'super-admin',
  });

  console.log('Super Admin created successfully!');
}

main()
  .catch((err) => {
    console.error('Seed error:', err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.connection.close();
    } catch {
      // ignore
    }
  });