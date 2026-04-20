const axios = require('axios');

const wmataClient = axios.create({
  baseURL: 'https://api.wmata.com',
  headers: { api_key: process.env.WMATA_API_KEY },
  timeout: 10000,
});

module.exports = { wmataClient };
