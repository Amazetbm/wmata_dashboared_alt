'use strict';

const axios = require('axios');

/**
 * Translate NormalizedMessage[] → Gemini contents array.
 * System prompt is injected as a user/model exchange at the front (universal fallback —
 * systemInstruction support varies across Gemini model families).
 * tool_result role → user message with functionResponse parts.
 * Gemini uses 'model' not 'assistant' for the assistant role.
 */
function toGeminiContents(messages, systemPrompt) {
  const result = [];
  if (systemPrompt) {
    result.push({ role: 'user',  parts: [{ text: systemPrompt }] });
    result.push({ role: 'model', parts: [{ text: 'Understood. I will help with WMATA transit questions using the available tools.' }] });
  }
  for (const msg of messages) {
    if (msg.role === 'user') {
      const text = msg.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
      result.push({ role: 'user', parts: [{ text }] });
    } else if (msg.role === 'assistant') {
      const parts = [];
      for (const c of msg.content) {
        if (c.type === 'text')      parts.push({ text: c.text });
        if (c.type === 'tool_call') parts.push({ functionCall: { name: c.name, args: c.input } });
      }
      result.push({ role: 'model', parts });
    } else if (msg.role === 'tool_result') {
      // All function responses in one user message
      const parts = msg.content.map(c => ({
        functionResponse: {
          name: c.name,
          response: {
            content: typeof c.content === 'string' ? c.content : JSON.stringify(c.content),
          },
        },
      }));
      result.push({ role: 'user', parts });
    }
  }
  return result;
}

function toGeminiTools(tools) {
  return [{
    functionDeclarations: tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    })),
  }];
}

function fromGeminiResponse(data) {
  const candidate = data.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const content = [];
  let hasToolCalls = false;
  let callIdx = 0;

  for (const part of parts) {
    if (part.text) {
      content.push({ type: 'text', text: part.text });
    } else if (part.functionCall) {
      hasToolCalls = true;
      // Gemini doesn't emit call IDs — synthesize a stable one
      const id = `gemini-${part.functionCall.name}-${Date.now()}-${callIdx++}`;
      content.push({
        type: 'tool_call',
        id,
        name: part.functionCall.name,
        input: part.functionCall.args || {},
      });
    }
  }

  return {
    message: { role: 'assistant', content },
    stop: !hasToolCalls,
    stop_reason: candidate?.finishReason || 'STOP',
  };
}

async function call(messages, tools, options) {
  const { apiKey, model, baseUrl, maxTokens, timeoutMs, systemPrompt } = options;
  const base = baseUrl || 'https://generativelanguage.googleapis.com';
  const url  = `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const { data } = await axios.post(url, {
    contents: toGeminiContents(messages, systemPrompt),
    tools: toGeminiTools(tools),
    generationConfig: { maxOutputTokens: maxTokens || 1024 },
  }, {
    headers: { 'content-type': 'application/json' },
    timeout: timeoutMs || 30000,
  });

  return fromGeminiResponse(data);
}

module.exports = { name: 'gemini', call };
