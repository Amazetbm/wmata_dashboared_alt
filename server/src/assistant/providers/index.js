'use strict';

const anthropic        = require('./anthropic');
const openai           = require('./openai');
const gemini           = require('./gemini');
const openaiCompatible = require('./openai-compatible');

const ADAPTERS = {
  anthropic,
  openai,
  gemini,
  'openai-compatible': openaiCompatible,
};

/**
 * Return the provider adapter for the given config.
 * @param {{ provider: string }} config
 * @returns {{ name: string, call: Function }}
 */
function getAdapter(config) {
  const adapter = ADAPTERS[config.provider];
  if (!adapter) throw new Error(`Unknown provider: ${config.provider}`);
  return adapter;
}

module.exports = { getAdapter };
