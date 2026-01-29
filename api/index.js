// Minimal test
module.exports = (req, res) => {
  res.json({ status: "ok", path: req.url });
};
