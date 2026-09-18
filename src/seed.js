// One-time seed: creates the first admin account (if none exists) and default task types.
// Run with: npm run seed  (reads ADMIN_EMAIL / ADMIN_NAME / ADMIN_PASSWORD from env, or defaults)
const { loadEnv } = require('./env');
loadEnv();

const db = require('./db');
const auth = require('./auth');

function seedTaskTypes() {
  const existing = db.prepare('SELECT COUNT(*) as c FROM task_types').get();
  if (existing.c > 0) return;
  const defaults = [
    { name: 'Heures de travail', countsAsWorked: 1 },
    { name: 'Congé Férié', countsAsWorked: 0 },
    { name: 'Maladie', countsAsWorked: 0 },
  ];
  const stmt = db.prepare('INSERT INTO task_types (name, countsAsWorked, active, sortOrder) VALUES (?, ?, 1, ?)');
  defaults.forEach((t, i) => stmt.run(t.name, t.countsAsWorked, i));
  console.log('Seeded default task types.');
}

function seedAdmin() {
  const existing = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get();
  if (existing.c > 0) {
    console.log('An admin account already exists — skipping admin seed.');
    return;
  }
  const email = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();
  const name = process.env.ADMIN_NAME || 'Admin';
  const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
  const hash = auth.hashPassword(password);
  db.prepare(
    `INSERT INTO users (name, email, passwordHash, role, mustChangePassword) VALUES (?, ?, ?, 'admin', 1)`
  ).run(name, email, hash);
  console.log('---');
  console.log('Created initial admin account:');
  console.log(`  Email:    ${email}`);
  console.log(`  Password: ${password}`);
  console.log('You will be asked to set a new password on first login.');
  console.log('---');
}

seedTaskTypes();
seedAdmin();
