/**
 * Shared auth check for all API routes.
 * Validates the Authorization header against CORTEX_PASSWORD env var.
 * Returns true if authorized, false if not (and sends 401).
 */
export function checkAuth(req, res) {
  const password = process.env.CORTEX_PASSWORD;
  if (!password) return true; // No password set = open (local dev)

  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${password}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}
