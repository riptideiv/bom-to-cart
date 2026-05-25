// Options page — configure OpenRouter API key and model
// Path: /root/bom-to-cart-extension/options/options.js

document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('config-form');
  const apiKeyInput = document.getElementById('api-key');
  const modelSelect = document.getElementById('model');
  const saveBtn = document.getElementById('save-btn');
  const testBtn = document.getElementById('test-btn');
  const statusDiv = document.getElementById('status');

  // Load current config (with retry for SW startup)
  let config = null;
  for (let i = 0; i < 5; i++) {
    config = await chrome.runtime.sendMessage({ type: 'agent:get-config' });
    if (config) break;
    await new Promise(r => setTimeout(r, 500));
  }
  if (!config) {
    statusDiv.textContent = '⚠ SW 未响应 — 点击 Save 重试';
    statusDiv.className = 'status error';
    config = {}; // fallback
  }

  if (config.apiKey) {
    apiKeyInput.value = config.apiKey;
    apiKeyInput.placeholder = '(已设置，修改后点 Save 更新)';
  }
  if (config.model) modelSelect.value = config.model;

  // Save
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'agent:set-config',
        payload: {
          apiKey: apiKeyInput.value.trim(),
          model: modelSelect.value
        }
      });
      if (resp && resp.error) throw new Error(resp.error);

      statusDiv.textContent = '✓ Saved!';
      statusDiv.className = 'status success';
      setTimeout(() => { statusDiv.textContent = ''; statusDiv.className = 'status'; }, 3000);
    } catch (err) {
      statusDiv.textContent = '✗ Error: ' + err.message;
      statusDiv.className = 'status error';
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  });

  // Toggle API key visibility
  document.getElementById('toggle-vis').addEventListener('click', () => {
    apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
  });

  // Test connection
  document.getElementById('test-btn').addEventListener('click', async () => {
    testBtn.disabled = true;
    testBtn.textContent = 'Testing...';
    statusDiv.textContent = '';
    statusDiv.className = 'status';

    // Save current key first so test uses latest
    if (apiKeyInput.value.trim()) {
      await chrome.runtime.sendMessage({
        type: 'agent:set-config',
        payload: { apiKey: apiKeyInput.value.trim(), model: modelSelect.value }
      });
    }

    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'agent:call',
        payload: {
          systemPrompt: 'Reply with exactly "OK" and nothing else.',
          userMessage: 'ping'
        }
      });
      if (!resp) throw new Error('SW 未响应');
      if (resp.error) throw new Error(resp.error);
      statusDiv.textContent = `✓ Connected! Model: ${resp.model}`;
      statusDiv.className = 'status success';
    } catch (err) {
      statusDiv.textContent = '✗ ' + err.message;
      statusDiv.className = 'status error';
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = 'Test Connection';
    }
  });
});