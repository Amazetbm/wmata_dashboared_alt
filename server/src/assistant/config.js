'use strict';

const VALID_PROVIDERS = ['anthropic', 'openai', 'gemini', 'openai-compatible'];

let _config = null;
let _parsed = false;

/**
 * Parse and validate LLM environment variables.
 * Returns a config object if the assistant is enabled and valid, null otherwise.
 * The server continues to start regardless of the result.
 *
 * @returns {{ provider, model, apiKey, baseUrl, maxTokens, timeoutMs } | null}
 */
function getAssistantConfig() {
  if (_parsed) return _config;
  _parsed = true;

  if (process.env.ASSISTANT_ENABLED === 'false') {
    console.log('[assistant] Disabled via ASSISTANT_ENABLED=false');
    _config = null;
    return null;
  }

  const provider = (process.env.LLM_PROVIDER || '').toLowerCase().trim();
  const model    = (process.env.LLM_MODEL || '').trim();
  const apiKey   = (process.env.LLM_API_KEY || '').trim();
  const baseUrl  = (process.env.LLM_BASE_URL || '').trim();

  if (!provider) {
    _config = null;
    return null; // silently disabled — no LLM vars set
  }

  if (!VALID_PROVIDERS.includes(provider)) {
    console.warn(`[assistant] Unknown LLM_PROVIDER="${provider}". Valid values: ${VALID_PROVIDERS.join(', ')}. Assistant disabled.`);
    _config = null;
    return null;
  }

  if (!model) {
    console.warn('[assistant] LLM_MODEL is required. Assistant disabled.');
    _config = null;
    return null;
  }

  if (provider === 'openai-compatible' && !baseUrl) {
    console.warn('[assistant] LLM_BASE_URL is required for provider=openai-compatible. Assistant disabled.');
    _config = null;
    return null;
  }

  _config = {
    provider,
    model,
    apiKey,
    baseUrl: baseUrl || null,
    maxTokens: parseInt(process.env.LLM_MAX_TOKENS || '1024', 10) || 1024,
    timeoutMs: parseInt(process.env.LLM_TIMEOUT_MS  || '30000', 10) || 30000,
  };

  console.log(`[assistant] Enabled — provider=${provider}, model=${model}`);
  return _config;
}

module.exports = { getAssistantConfig };
