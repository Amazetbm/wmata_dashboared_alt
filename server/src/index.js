require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { startPolling } = require('./jobs/poller');
const incidentRoutes = require('./routes/incidents');
const trainRoutes = require('./routes/trains');
const elevatorRoutes = require('./routes/elevators');
const predictionRoutes = require('./routes/predictions');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/api/incidents', incidentRoutes);
app.use('/api/trains', trainRoutes);
app.use('/api/elevators', elevatorRoutes);
app.use('/api/predictions', predictionRoutes);

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('MongoDB connected');
    startPolling();
    const port = process.env.PORT || 3000;
    app.listen(port, () => console.log(`Server running on port ${port}`));
  })
  .catch(err => {
    console.error('MongoDB connection failed:', err);
    process.exit(1);
  });
