'use strict';

const axios = require('axios');

/**
 * Translate NormalizedMessage[] → OpenAI messages array.
 * System prompt becomes a {role:'system'} message at position 0.
 * tool_result role → individual {role:'tool'} messages (one per result).
 */
function toOpenAIMessages(messages, systemPrompt) {
  const result = [];
  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt });
  }
  for (const msg of messages) {
    if (msg.role === 'user') {
      const text = msg.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
      result.push({ role: 'user', content: text });
    } else if (msg.role === 'assistant') {
      const textParts = msg.content.filter(c => c.type === 'text');
      const toolCalls = msg.content.filter(c => c.type === 'tool_call');
      const outMsg = { role: 'assistant' };
      if (textParts.length) outMsg.content = textParts.map(c => c.text).join('\n');
      if (toolCalls.length) {
        outMsg.tool_calls = toolCalls.map(c => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.input) },
        }));
      }
      result.push(outMsg);
    } else if (msg.role === 'tool_result') {
      for (const c of msg.content) {
        result.push({
          role: 'tool',
          tool_call_id: c.tool_call_id,
          content: typeof c.content === 'string' ? c.content : JSON.stringify(c.content),
        });
      }
    }
  }
  return result;
}

function toOpenAITools(tools) {
  return tools.map(t => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}

function fromOpenAIResponse(data) {
  const choice = data.choices?.[0];
  const msg    = choice?.message || {};
  const content = [];
  let hasToolCalls = false;

  if (msg.content) {
    content.push({ type: 'text', text: msg.content });
  }
  if (msg.tool_calls?.length) {
    hasToolCalls = true;
    for (const tc of msg.tool_calls) {
      let input = {};
      try { input = JSON.parse(tc.function.arguments || '{}'); } catch (_) { /* keep empty */ }
      content.push({ type: 'tool_call', id: tc.id, name: tc.function.name, input });
    }
  }

  return {
    message: { role: 'assistant', content },
    stop: !hasToolCalls,
    stop_reason: choice?.finish_reason || 'stop',
  };
}

async function call(messages, tools, options) {
  const { apiKey, model, baseUrl, maxTokens, timeoutMs, systemPrompt } = options;
  const url = (baseUrl || 'https://api.openai.com') + '/v1/chat/completions';

  const { data } = await axios.post(url, {
    model,
    max_tokens: maxTokens || 1024,
    messages: toOpenAIMessages(messages, systemPrompt),
    tools: toOpenAITools(tools),
    tool_choice: 'auto',
    think: false, // disable qwen3 extended thinking (Ollama-specific; ignored by OpenAI/others)
  }, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    timeout: timeoutMs || 30000,
  });

  return fromOpenAIResponse(data);
}

module.exports = { name: 'openai', call };
