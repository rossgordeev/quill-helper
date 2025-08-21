import { useState } from 'react';

function App() {
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState('');

  async function sendPrompt() {
    const result = await (window as any).electronAPI.chatWithLLM(prompt);
    setResponse(result);
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>Quill Helper</h1>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={4}
        cols={50}
        placeholder="Ask me something..."
      />
      <br />
      <button onClick={sendPrompt}>Send</button>
      <pre>{response}</pre>
    </div>
  );
}

export default App;
