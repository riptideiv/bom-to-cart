// Agent — call OpenRouter API directly, no Hermes gateway dependency.
// Short-lived: each call is independent, no conversation history.
// Path: /root/bom-to-cart-extension/lib/agent.js

const AGENT_CONFIG_KEY = 'agent-config';

const DEFAULT_CONFIG = {
  model: 'anthropic/claude-sonnet-4-20250514',
  baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
  temperature: 0.1,
  max_tokens: 4096
};

export const Agent = {
  /** Load agent config from storage. */
  async getConfig() {
    const result = await chrome.storage.local.get(AGENT_CONFIG_KEY);
    return { ...DEFAULT_CONFIG, ...(result[AGENT_CONFIG_KEY] || {}) };
  },

  /** Save agent config. */
  async setConfig(partial) {
    const current = await this.getConfig();
    const updated = { ...current, ...partial };
    await chrome.storage.local.set({ [AGENT_CONFIG_KEY]: updated });
    return updated;
  },

  /** Check if agent is configured (has API key). */
  async isConfigured() {
    const config = await this.getConfig();
    return !!config.apiKey;
  },

  /**
   * Call OpenRouter API. Stateless single-turn.
   * @param {object} opts - { systemPrompt, userMessage, jsonMode?, temperature?, model? }
   * @returns {object} - { content: string, model: string, usage: object } | throws
   */
  async call({ systemPrompt, userMessage, jsonMode = false, temperature }) {
    const config = await this.getConfig();
    if (!config.apiKey) {
      throw new Error('Agent not configured. Set OpenRouter API key in extension options.');
    }

    const body = {
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: temperature ?? config.temperature,
      max_tokens: config.max_tokens
    };

    // OpenRouter-specific: response_format for JSON mode
    if (jsonMode) {
      if (config.model.includes('claude') || config.model.includes('anthropic')) {
        // Anthropic models: prepend instruction instead of response_format
        body.messages[0].content += '\n\nYou MUST respond with valid JSON only. No markdown, no explanation outside the JSON.';
      } else {
        body.response_format = { type: 'json_object' };
      }
    }

    const response = await fetch(config.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
        'HTTP-Referer': 'https://github.com/riptideiv/bom-to-cart',
        'X-Title': 'BOM-to-Cart'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenRouter API error ${response.status}: ${err}`);
    }

    const data = await response.json();
    return {
      content: data.choices[0].message.content,
      model: data.model,
      usage: data.usage
    };
  }
};
