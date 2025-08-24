// llama.cpp OpenAI-compatible client (local-only)
export async function llamaCppChat(baseUrl: string, messages: Array<{ role: string, content: string }>, opts?: {
  temperature?: number;
  max_tokens?: number;
}) {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'local', // llama.cpp ignores model name; keep any string
      messages,
      temperature: opts?.temperature ?? 0.7,
      max_tokens: opts?.max_tokens ?? 512,
      stream: false,
    })
  });
  if (!res.ok) throw new Error(`llama.cpp HTTP ${res.status}`);
  return res.json();
}

export async function* llamaCppStream(baseUrl: string, messages: Array<{ role: string, content: string }>, opts?: {
  temperature?: number;
}) {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'local',
      messages,
      temperature: opts?.temperature ?? 0.7,
      stream: true,
    })
  });
  if (!res.ok || !res.body) throw new Error(`llama.cpp HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Parse Server-Sent Events lines: "data: {...}\n"
    const lines = buffer.split('\n');
    // keep last partial line in buffer
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const json = trimmed.slice(5).trim();
      if (json === '[DONE]') return;
      try {
        const obj = JSON.parse(json);
        const delta = obj.choices?.[0]?.delta?.content || '';
        if (delta) yield delta;
      } catch { /* ignore parse errors on partials */ }
    }
  }
}
