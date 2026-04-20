const cron = require('node-cron');
const { wmataClient } = require('../middleware/wmata');
const Incident = require('../models/Incident');
const TrainPosition = require('../models/TrainPosition');
const ElevatorOutage = require('../models/ElevatorOutage');

async function fetchAndStore() {
  const snapshotAt = new Date();

  try {
    const [incRes, trainRes, elevRes] = await Promise.allSettled([
      wmataClient.get('/Incidents.svc/json/Incidents'),
      wmataClient.get('/TrainPositions/TrainPositions?contentType=json'),
      wmataClient.get('/Incidents.svc/json/ElevatorIncidents'),
    ]);

    if (incRes.status === 'fulfilled') {
      const incidents = (incRes.value.data.Incidents || []).map(i => ({ ...i, snapshotAt }));
      if (incidents.length) await Incident.insertMany(incidents);
    } else {
      console.error('Incidents fetch error:', incRes.reason?.message);
    }

    if (trainRes.status === 'fulfilled') {
      const trains = (trainRes.value.data.TrainPositions || []).map(t => ({ ...t, snapshotAt }));
      if (trains.length) await TrainPosition.insertMany(trains);
    } else {
      console.error('Train positions fetch error:', trainRes.reason?.message);
    }

    if (elevRes.status === 'fulfilled') {
      const outages = (elevRes.value.data.ElevatorIncidents || []).map(e => ({ ...e, snapshotAt }));
      if (outages.length) await ElevatorOutage.insertMany(outages);
    } else {
      console.error('Elevator outages fetch error:', elevRes.reason?.message);
    }

    console.log(`[${snapshotAt.toISOString()}] Snapshot stored`);
  } catch (err) {
    console.error('Polling error:', err.message);
  }
}

function startPolling() {
  fetchAndStore();
  // every 30 seconds
  cron.schedule('*/30 * * * * *', fetchAndStore);
}

module.exports = { startPolling, fetchAndStore };
