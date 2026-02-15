export default function handler(req, res) {
  const pw = process.env.CORTEX_PASSWORD;
  const auth = req.headers.authorization;
  const expected = `Bearer ${pw}`;
  res.status(200).json({ 
    hasPassword: !!pw, 
    pwLength: pw?.length || 0,
    authHeader: auth ? auth.slice(0, 10) + '...' : null,
    expectedPrefix: expected.slice(0, 10) + '...',
    match: auth === expected
  });
}
