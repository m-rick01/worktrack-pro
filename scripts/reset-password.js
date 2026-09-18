// Reset a user's password from the command line (for when nobody can log in).
//
//   node scripts/reset-password.js <email> <newPassword>
//   node scripts/reset-password.js --all <newPassword>
//
// Add --force-change to make the user pick a new password at next sign-in.
// This edits the database directly; there is no email sent and no undo.
const path = require('node:path');

// .env sets DB_PATH relative to the project root, so anchor the process there
// before loading it — otherwise running this from another folder silently
// targets (and creates) a different database. Must happen before requiring db.
process.chdir(path.join(__dirname, '..'));
require('../src/env').loadEnv();

const db = require('../src/db');
const { hashPassword } = require('../src/auth');

const args = process.argv.slice(2);
const forceChange = args.includes('--force-change');
const rest = args.filter((a) => a !== '--force-change');
const [target, password] = rest;

if (!target || !password) {
  console.error('Usage: node scripts/reset-password.js <email|--all> <newPassword> [--force-change]');
  process.exit(1);
}

const dbPath = path.resolve(process.env.DB_PATH || 'data/worktrack.db');
console.log(`database: ${dbPath}\n`);

const users =
  target === '--all'
    ? db.prepare('SELECT id, email FROM users ORDER BY id').all()
    : db.prepare('SELECT id, email FROM users WHERE email = ?').all(target.toLowerCase());

if (users.length === 0) {
  console.error(`No account found for "${target}".`);
  process.exit(1);
}

const update = db.prepare('UPDATE users SET passwordHash = ?, mustChangePassword = ? WHERE id = ?');
for (const user of users) {
  // A fresh salt per user, so identical passwords don't share a hash.
  update.run(hashPassword(password), forceChange ? 1 : 0, user.id);
  console.log(`reset: ${user.email}`);
}

// Existing sign-ins would otherwise survive the password change.
const info =
  target === '--all'
    ? db.prepare('DELETE FROM sessions').run()
    : db.prepare('DELETE FROM sessions WHERE userId = ?').run(users[0].id);

console.log(`\n${users.length} password(s) reset, ${info.changes} session(s) signed out.`);
