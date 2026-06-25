const INSECURE_PASSWORDS = new Set([
  'admin123',
]);

function isInsecurePassword(password) {
  if (typeof password !== 'string') return false;
  return INSECURE_PASSWORDS.has(password.trim().toLowerCase());
}

module.exports = {
  isInsecurePassword,
};
