'use strict';

const router      = require('express').Router();
const wmataUsage  = require('../lib/wmataUsage');

router.get('/wmata-usage', (_req, res) => {
  res.json(wmataUsage.getUsage());
});

module.exports = router;
