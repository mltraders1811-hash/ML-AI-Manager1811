"use client";

import { useState } from "react";
import Link from "next/link";

type Message = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = ["Who owes me more than 50k?", "What were yesterday's sales?", "How much is Alpha Traders overdue by?"];

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    setError("");
    const next: Message[] = [...messages, { role: "user", content: text.trim() }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Chat request failed");
      setMessages([...next, { role: "assistant", content: body.reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex h-screen max-w-2xl flex-col px-4 py-6">
      <header className="mb-4 flex items-center gap-3">
        <Link href="/" className="text-sm font-medium text-neutral-500 hover:text-neutral-800">
          ← Dashboard
        </Link>
        <h1 className="text-lg font-bold text-neutral-900">AI Chat Assistant</h1>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-4">
        {messages.length === 0 ? (
          <div className="space-y-2">
            <p className="text-sm text-neutral-500">Ask about dues, customers, or sales. Try:</p>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="block w-full rounded-lg border border-neutral-200 px-3 py-2 text-left text-sm text-neutral-700 transition hover:bg-neutral-50"
              >
                {s}
              </button>
            ))}
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${
                  m.role === "user" ? "bg-brand text-white" : "bg-neutral-100 text-neutral-900"
                }`}
              >
                {m.content}
              </div>
            </div>
          ))
        )}
        {busy ? <div className="text-sm text-neutral-400">Thinking…</div> : null}
        {error ? <div className="text-sm text-overdue">{error}</div> : null}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="mt-4 flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question..."
          className="flex-1 rounded-lg border border-neutral-300 px-4 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-lg bg-brand px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </main>
  );
}
