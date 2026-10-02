'use strict';

const MAX_ITER = 5;

/**
 * Build the system prompt. Accepts an injected clock so tests can pin the date.
 * @param {Date} now
 * @returns {string}
 */
function buildSystemPrompt(now) {
  const eastern = now.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    dateStyle: 'full',
    timeStyle: 'short',
  });
  return `You are the WMATA Operator Dashboard assistant. You help transit operators answer questions about live and historical Washington DC Metrorail and Metrobus data.

Current date and time (Eastern): ${eastern}

WMATA rail lines:
- RD: Red Line (Shady Grove ↔ Glenmont)
- BL: Blue Line (Largo Town Center ↔ Franconia-Springfield)
- OR: Orange Line (New Carrollton ↔ Vienna)
- GR: Green Line (Branch Ave ↔ Greenbelt)
- YL: Yellow Line (Huntington ↔ Greenbelt)
- SV: Silver Line (Ashburn ↔ Largo Town Center)

Data freshness: Train positions, incidents, elevator outages, and schedule adherence are snapshotted every 30 seconds. Predictions (next trains) are live from the WMATA API.

Tool usage guidelines:
- Always call find_station before get_next_trains if you only have a station name, not a code.
- Call show_on_map whenever your answer references a specific line, station, or bus route — this highlights it on the operator's map automatically.
- When a tool returns empty results, say so explicitly; do not guess or fabricate data.
- Schedule adherence thresholds: on-time = deviation ≤10% of headway, minor = ≤25%, significant = >25%.
- Return concise, operator-focused language. Avoid raw JSON in your replies.`;
}

/**
 * Run the agentic tool-calling loop.
 *
 * @param {string} question
 * @param {Array<{role:'user'|'assistant', content:string}>} history - flat client-side history
 * @param {{ name:string, call:Function }} adapter - provider adapter
 * @param {Array} toolDefs - TOOL_DEFINITIONS from tools.js
 * @param {{ model, apiKey, baseUrl, maxTokens, timeoutMs }} config
 * @param {function(): Date} [now] - injected clock; defaults to () => new Date()
 * @returns {Promise<{ reply:string, tools_used:string[], map_actions:Array }>}
 */
async function runAgentLoop(question, history, adapter, toolDefs, config, now = () => new Date()) {
  const systemPrompt = buildSystemPrompt(now());

  const options = {
    apiKey:       config.apiKey,
    model:        config.model,
    baseUrl:      config.baseUrl,
    maxTokens:    config.maxTokens,
    timeoutMs:    config.timeoutMs,
    systemPrompt,
  };

  // Convert flat history to NormalizedMessage format; strip unknown fields
  const messages = [
    ...history
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map(m => ({ role: m.role, content: [{ type: 'text', text: m.content }] })),
    { role: 'user', content: [{ type: 'text', text: question }] },
  ];

  const mapActions = [];
  const toolsUsed  = [];

  // Build name → definition lookup (handler is null for show_on_map)
  const toolMap = Object.fromEntries(toolDefs.map(t => [t.name, t]));

  for (let i = 0; i < MAX_ITER; i++) {
    const response = await adapter.call(messages, toolDefs, options);
    messages.push(response.message);

    if (response.stop) {
      const replyBlock = response.message.content.find(c => c.type === 'text');
      const rawReply = replyBlock?.text ?? '(No response)';
      // Some models (e.g. qwen3 via Ollama) emit show_on_map as XML text instead of
      // a tool call. Extract and strip them so they don't appear in the reply.
      const cleanReply = rawReply.replace(
        /<show_on_map\s+action="([^"]+)"\s+target="([^"]+)"\s*\/?>/g,
        (_, action, target) => { mapActions.push({ action, target }); return ''; }
      ).trim();
      return {
        reply:       cleanReply,
        tools_used:  toolsUsed,
        map_actions: mapActions,
      };
    }

    const toolCalls = response.message.content.filter(c => c.type === 'tool_call');
    const results   = await Promise.allSettled(
      toolCalls.map(tc => {
        if (tc.name === 'show_on_map') return Promise.resolve({ success: true });
        const def = toolMap[tc.name];
        if (!def || !def.handler) return Promise.reject(new Error(`Unknown tool: ${tc.name}`));
        return def.handler(tc.input);
      })
    );

    const toolResultContents = results.map((r, idx) => {
      const tc = toolCalls[idx];

      if (tc.name === 'show_on_map') {
        // Intercept: record the map action, return success to the LLM
        if (r.status === 'fulfilled') mapActions.push(tc.input);
        return {
          type: 'tool_result',
          tool_call_id: tc.id,
          name:         tc.name,
          content:      { success: true },
        };
      }

      if (r.status === 'fulfilled') {
        toolsUsed.push(tc.name);
        return {
          type:         'tool_result',
          tool_call_id: tc.id,
          name:         tc.name,
          content:      r.value,
        };
      }

      // Tool threw — feed error back to the LLM so it can adapt
      console.error(`[agentLoop] tool "${tc.name}" error:`, r.reason?.message);
      return {
        type:         'tool_result',
        tool_call_id: tc.id,
        name:         tc.name,
        content:      `Tool error: ${r.reason?.message ?? 'unknown error'}`,
        is_error:     true,
      };
    });

    messages.push({ role: 'tool_result', content: toolResultContents });
  }

  return {
    reply:       'I was unable to complete the request within the step limit. Please try a more specific question.',
    tools_used:  toolsUsed,
    map_actions: mapActions,
  };
}

module.exports = { runAgentLoop };
