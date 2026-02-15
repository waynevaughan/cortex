export default function handler(req, res) {
  const pw = process.env.CORTEX_PASSWORD;
  res.status(200).json({ hasPassword: !!pw, pwLength: pw?.length || 0 });
}
