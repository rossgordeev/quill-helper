import React, { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';

type Role = 'user' | 'assistant' | 'system';
type Msg = { id: string; role: Role; content: string };

const DEFAULT_MODEL = 'llama3.2';

export default function App() {
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [input, setInput] = useState('');

  // 👇 Seed with system + one user bubble + one assistant bubble
  const [msgs, setMsgs] = useState<Msg[]>([
    { id: 'sys', role: 'system', content: 'You are a concise, helpful assistant.' },
    {
      id: 'seed-user',
      role: 'user',
      content:
        'Heads up: my messages are blue on the right, and your replies are gray on the left.',
    },
    {
      id: 'seed-assistant',
      role: 'assistant',
      content: 'Exactly — this is what my responses will look like.',
    },
  ]);

  const [streaming, setStreaming] = useState(false);
  const idleTimerRef = useRef<number | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // auto-scroll on new messages or streaming updates
  useEffect(() => {
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [msgs, streaming]);

  const visibleMessages = msgs.filter((m) => m.role !== 'system');
  const canSend = useMemo(() => input.trim().length > 0 && !streaming, [input, streaming]);

  function appendMessage(m: Msg) {
    setMsgs((prev) => [...prev, m]);
  }

  // stop typing after 150ms idle with streaming
  function bumpIdleTimer() {
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => {
      setStreaming(false);
      idleTimerRef.current = null;
    }, 150);
  }

  async function send() {
    const text = input.trim();
    if (!text) return;

    setInput('');

    const userMsg: Msg = { id: crypto.randomUUID(), role: 'user', content: text };
    const asstMsgId = crypto.randomUUID();
    const asstMsg: Msg = { id: asstMsgId, role: 'assistant', content: '' };

    appendMessage(userMsg);
    appendMessage(asstMsg);
    setStreaming(true);
    bumpIdleTimer();

    // stream tokens from the preload bridge
    window.llm.stream(text, model, (chunk: string) => {
      setMsgs((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last && last.id === asstMsgId) {
          last.content += chunk;
        }
        return copy;
      });
      bumpIdleTimer();
    });
  }

  return (
    <div className="page">
      <header className="bar">
        <div className="title">Local writing assistant (Ollama-ready)</div>
        <div className="row">
          <label className="label">Model</label>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="llama3.2">llama3.2</option>
            <option value="llama3.1:8b-instruct-q4_K_M">llama3.1:8b-instr-q4_K_M</option>
            <option value="qwen2.5:7b-instruct-q4_K_M">qwen2.5:7b-instr-q4_K_M</option>
          </select>
        </div>
      </header>

      <div ref={scrollerRef} className="scroll">
        <div className="chat">
          {visibleMessages.map((m) => (
            <Bubble key={m.id} role={m.role as 'user' | 'assistant'} text={m.content} />
          ))}
          {streaming && <Typing />}
        </div>
      </div>

      <form
        className="inputbar"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSend) send();
        }}
      >
        <textarea
          placeholder="Type a message…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={3}
        />
        <button disabled={!canSend} type="submit">
          Send
        </button>
      </form>
    </div>
  );
}

function Bubble({ role, text }: { role: 'user' | 'assistant'; text: string }) {
  const isUser = role === 'user';
  return (
    <div className={`bubble ${isUser ? 'user' : 'assistant'}`}>
      <div className="bubble-inner">{text}</div>
    </div>
  );
}

function Typing() {
  return (
    <div className="typing">
      <span /> <span /> <span />
    </div>
  );
}
