'use strict';

// openai-compatible uses the OpenAI wire format with a custom LLM_BASE_URL.
// Covers Ollama (http://localhost:11434), LM Studio, Groq, OpenRouter, Azure-style endpoints.
const openai = require('./openai');

module.exports = { name: 'openai-compatible', call: openai.call };
