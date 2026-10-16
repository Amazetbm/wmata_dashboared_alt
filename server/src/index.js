require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { startPolling } = require('./jobs/poller');
const { ensureTtlIndexes } = require('./db/ensureTtlIndexes');
const incidentRoutes = require('./routes/incidents');
const trainRoutes = require('./routes/trains');
const elevatorRoutes = require('./routes/elevators');
const predictionRoutes = require('./routes/predictions');
const adherenceRoutes = require('./routes/adherence');
const outageRoutes    = require('./routes/outages');
const mapRoutes       = require('./routes/map');
const busRoutes       = require('./routes/bus');
const assistantRoutes = require('./routes/assistant');

const app = express();
app.set('trust proxy', 1); // trust X-Real-IP from nginx for rate limiting
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/api/incidents', incidentRoutes);
app.use('/api/trains', trainRoutes);
app.use('/api/elevators', elevatorRoutes);
app.use('/api/predictions', predictionRoutes);
app.use('/api/adherence', adherenceRoutes);
app.use('/api/outages',  outageRoutes);
app.use('/api/map',     mapRoutes);
app.use('/api/bus',       busRoutes);
app.use('/api/assistant', assistantRoutes);

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('MongoDB connected');
    await ensureTtlIndexes();
    startPolling();
    const port = process.env.PORT || 3000;
    app.listen(port, () => console.log(`Server running on port ${port}`));
  })
  .catch(err => {
    console.error('MongoDB connection failed:', err);
    process.exit(1);
  });
