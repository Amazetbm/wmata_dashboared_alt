'use strict';

const axios = require('axios');

/**
 * Translate NormalizedMessage[] → Anthropic messages array.
 * tool_result role → user message with tool_result content blocks.
 */
function toAnthropicMessages(messages) {
  const result = [];
  for (const msg of messages) {
    if (msg.role === 'user') {
      result.push({
        role: 'user',
        content: msg.content
          .filter(c => c.type === 'text')
          .map(c => ({ type: 'text', text: c.text })),
      });
    } else if (msg.role === 'assistant') {
      const content = [];
      for (const c of msg.content) {
        if (c.type === 'text')      content.push({ type: 'text', text: c.text });
        if (c.type === 'tool_call') content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
      }
      result.push({ role: 'assistant', content });
    } else if (msg.role === 'tool_result') {
      // All results for a batch go in one user message as tool_result blocks
      result.push({
        role: 'user',
        content: msg.content.map(c => ({
          type: 'tool_result',
          tool_use_id: c.tool_call_id,
          content: typeof c.content === 'string' ? c.content : JSON.stringify(c.content),
          ...(c.is_error ? { is_error: true } : {}),
        })),
      });
    }
  }
  return result;
}

function toAnthropicTools(tools) {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
}

function fromAnthropicResponse(data) {
  const content = [];
  let hasToolUse = false;

  for (const block of (data.content || [])) {
    if (block.type === 'text') {
      content.push({ type: 'text', text: block.text });
    } else if (block.type === 'tool_use') {
      hasToolUse = true;
      content.push({ type: 'tool_call', id: block.id, name: block.name, input: block.input || {} });
    }
  }

  return {
    message: { role: 'assistant', content },
    stop: !hasToolUse,
    stop_reason: data.stop_reason || 'end_turn',
  };
}

async function call(messages, tools, options) {
  const { apiKey, model, baseUrl, maxTokens, timeoutMs, systemPrompt } = options;
  const url = (baseUrl || 'https://api.anthropic.com') + '/v1/messages';

  const { data } = await axios.post(url, {
    model,
    max_tokens: maxTokens || 1024,
    system: systemPrompt,
    messages: toAnthropicMessages(messages),
    tools: toAnthropicTools(tools),
  }, {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    timeout: timeoutMs || 30000,
  });

  return fromAnthropicResponse(data);
}

module.exports = { name: 'anthropic', call };
