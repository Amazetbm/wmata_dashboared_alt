'use strict';

const router    = require('express').Router();
const rateLimit = require('express-rate-limit');
const { getAssistantConfig } = require('../assistant/config');
const { runAgentLoop }       = require('../assistant/agentLoop');
const { getAdapter }         = require('../assistant/providers');
const { TOOL_DEFINITIONS }   = require('../assistant/tools');

const chatLimiter = rateLimit({
  windowMs:        60 * 1000, // 1 minute
  max:             10,
  standardHeaders: 'draft-7',
  legacyHeaders:   false,
  message:         { error: 'Too many requests. Please wait a minute before asking again.' },
});

// GET /api/assistant/config
// Returns enabled status, provider name, and model. Never returns the API key.
router.get('/config', (_req, res) => {
  const cfg = getAssistantConfig();
  if (!cfg) return res.json({ enabled: false });
  res.json({ enabled: true, provider: cfg.provider, model: cfg.model });
});

// POST /api/assistant/chat
router.post('/chat', chatLimiter, async (req, res) => {
  const cfg = getAssistantConfig();
  if (!cfg) {
    return res.status(503).json({ error: 'The assistant feature is not configured on this server.' });
  }

  const { question, history = [] } = req.body || {};

  if (!question || typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'question is required' });
  }
  if (question.length > 1000) {
    return res.status(400).json({ error: 'question too long (max 1000 characters)' });
  }
  if (!Array.isArray(history)) {
    return res.status(400).json({ error: 'history must be an array' });
  }
  if (history.length > 20) {
    return res.status(400).json({ error: 'history too long (max 20 messages)' });
  }

  // Sanitise history — strip unknown fields, keep only role + content
  const safeHistory = history
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content }));

  try {
    const adapter = getAdapter(cfg);
    const result  = await runAgentLoop(question.trim(), safeHistory, adapter, TOOL_DEFINITIONS, cfg);
    res.json(result);
  } catch (err) {
    console.error('[assistant/chat]', err.message);
    // Do not leak provider error details to the client
    const statusCode = err.statusCode === 429 ? 503 : 502;
    res.status(statusCode).json({ error: 'The assistant encountered an error. Please try again.' });
  }
});

module.exports = router;
