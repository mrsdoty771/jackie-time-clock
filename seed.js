const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

/**
 * Safe seed script (no hardcoded secrets).
 * This script will create a super-admin user based on your .env variables.
 */
async function main() {
  const databaseUrl = String(process.env.DATABASE_URL || '').trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is not set in .env');

  // Pulling secrets from environment variables for security
  const companyId = String(process.env.SUPER_ADMIN_COMPANY_ID || '').trim();
  const username = String(process.env.SUPER_ADMIN_USERNAME || '').trim();
  const email = String(process.env.SUPER_ADMIN_EMAIL || '').trim();
  const password = String(process.env.SUPER_ADMIN_PASSWORD || '').trim();

  if (!companyId || !username || !email || !password) {
    throw new Error('Missing one or more SUPER_ADMIN environment variables in .env');
  }

  console.log('Connecting to database...');
  await mongoose.connect(databaseUrl, { serverSelectionTimeoutMS: 10000 });
  console.log('Connected to MongoDB');

  // Import the model after the connection is established
  const User = require('./models/User');

  // Check if user already exists to avoid duplicates
  const existing = await User.findOne({ 
    companyId, 
    $or: [{ email }, { username }] 
  }).lean();

  if (existing) {
    console.log('Super Admin already exists. No new user created.');
    return;
  }

  // Create the Super Admin
  await User.create({
    companyId,
    username,
    email,
    password: bcrypt.hashSync(password, 10),
    role: 'super-admin', // Matches the enum we added to User.js
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
      console.log('Database connection closed.');
    } catch {
      // ignore
    }
  });