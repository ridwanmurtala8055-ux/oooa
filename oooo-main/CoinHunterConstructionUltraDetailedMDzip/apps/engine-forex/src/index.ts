import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

// EA Polling Endpoint
app.post('/ea/poll', (req, res) => {
  const { terminal_id } = req.body;
  // Check for pending signals for this terminal
  res.json({ signals: [] });
});

// EA Reporting Endpoint
app.post('/ea/report', (req, res) => {
  const { terminal_id, report } = req.body;
  console.log(`Report from terminal ${terminal_id}:`, report);
  res.json({ status: 'received' });
});

const PORT = process.env.FOREX_PORT || 5001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Forex Engine running on http://0.0.0.0:${PORT}`);
});
