import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3008";
const LOGIN_URL = `${API_BASE}/api/auth/login`;
const PROFILE_URL = `${API_BASE}/api/auth/me`;
const CHAT_LIST_URL = `${API_BASE}/api/ai/chats`;
const CHAT_URL = `${API_BASE}/api/ai/chat`;

const App = () => {
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [chatList, setChatList] = useState([]);
  const [activeChat, setActiveChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isLoadingChats, setIsLoadingChats] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef(null);

  const authHeaders = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : {}),
    [token],
  );

  useEffect(() => {
    if (token) {
      loadProfile();
    }
  }, [token]);

  useEffect(() => {
    if (activeChat?._id) {
      fetchChat(activeChat._id);
    }
  }, [activeChat?._id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loadProfile = async () => {
    try {
      const response = await axios.get(PROFILE_URL, { headers: authHeaders });
      setUser(response.data.user);
      await loadChats();
    } catch (err) {
      console.error(err);
      logout();
    }
  };

  const loadChats = async () => {
    setIsLoadingChats(true);
    setError("");

    try {
      const response = await axios.get(CHAT_LIST_URL, {
        headers: authHeaders,
      });
      setChatList(response.data || []);
      if (!activeChat && response.data?.length > 0) {
        setActiveChat(response.data[0]);
      }
    } catch (err) {
      console.error(err);
      setError("Unable to load chat list. Please check your token or backend.");
    } finally {
      setIsLoadingChats(false);
    }
  };

  const fetchChat = async (chatId) => {
    if (!token) {
      return;
    }

    try {
      const response = await axios.get(`${CHAT_URL}/${chatId}`, {
        headers: authHeaders,
      });
      setActiveChat(response.data.chat);
      setMessages(response.data.messages || []);
    } catch (err) {
      console.error(err);
      setError("Failed to load chat history.");
    }
  };

  const login = async (event) => {
    event.preventDefault();
    setError("");
    setStatus("Signing in...");

    try {
      const response = await axios.post(LOGIN_URL, {
        email,
        password,
      });

      const newToken = response.data.token;
      localStorage.setItem("token", newToken);
      setToken(newToken);
      setEmail("");
      setPassword("");
      setStatus("");
    } catch (err) {
      console.error(err);
      setStatus("");
      setError(
        err.response?.data?.error ||
          err.response?.data?.message ||
          "Login failed.",
      );
    }
  };

  const logout = () => {
    localStorage.removeItem("token");
    setToken("");
    setUser(null);
    setChatList([]);
    setActiveChat(null);
    setMessages([]);
    setStatus("");
    setError("");
  };

  const sendPrompt = async (event) => {
    event.preventDefault();
    setError("");

    const text = prompt.trim();
    if (!text || isSending) {
      return;
    }

    setPrompt("");
    setStatus("Sending prompt...");
    setIsSending(true);

    const userMessage = {
      _id: `user-${Date.now()}`,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    const assistantMessageId = `assistant-${Date.now()}`;
    const assistantMessage = {
      _id: assistantMessageId,
      role: "assistant",
      content: "",
      streaming: true,
      createdAt: new Date().toISOString(),
    };

    setMessages((current) => [...current, userMessage, assistantMessage]);

    try {
      const response = await fetch(`${CHAT_URL}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          prompt: text,
          chatId: activeChat?._id || "new",
          createNewChat: !activeChat?._id,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Chat request failed.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let responseText = "";
      let newChatId = activeChat?._id;

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          const dataLine = part
            .split("\n")
            .find((line) => line.startsWith("data:"));
          if (!dataLine) {
            continue;
          }

          const payload = dataLine.slice(5).trim();
          if (payload === "[DONE]") {
            continue;
          }

          try {
            const event = JSON.parse(payload);
            if (event.chatId) {
              newChatId = event.chatId;
              if (!activeChat?._id || activeChat._id !== newChatId) {
                setActiveChat((current) =>
                  current?._id === newChatId
                    ? current
                    : { _id: newChatId, title: "New chat" },
                );
              }
            }
            if (typeof event.token === "string") {
              responseText += event.token;
              setMessages((current) =>
                current.map((message) =>
                  message._id === assistantMessageId
                    ? { ...message, content: responseText }
                    : message,
                ),
              );
            }
          } catch (parseError) {
            console.warn("Failed to parse SSE payload", parseError);
          }
        }
      }

      if (buffer.includes("data:")) {
        const line = buffer
          .split("\n")
          .find((item) => item.startsWith("data:"));
        const payload = line?.slice(5).trim();
        if (payload && payload !== "[DONE]") {
          try {
            const event = JSON.parse(payload);
            if (event.chatId) {
              newChatId = event.chatId;
            }
            if (typeof event.token === "string") {
              responseText += event.token;
              setMessages((current) =>
                current.map((message) =>
                  message._id === assistantMessageId
                    ? { ...message, content: responseText }
                    : message,
                ),
              );
            }
          } catch (parseError) {
            console.warn("Final SSE parse failed", parseError);
          }
        }
      }

      setMessages((current) =>
        current.map((message) =>
          message._id === assistantMessageId
            ? { ...message, streaming: false }
            : message,
        ),
      );

      setStatus("Response received");
      await loadChats();

      if (newChatId && (!activeChat?._id || newChatId !== activeChat._id)) {
        setActiveChat({ _id: newChatId, title: "New chat" });
      }
    } catch (err) {
      console.error(err);
      setError(err.message || "Unable to complete chat request.");
      setStatus("");
      setMessages((current) =>
        current.map((message) =>
          message._id === assistantMessageId
            ? {
                ...message,
                content:
                  message.content + "\n\n[Failed to stream full response]",
                streaming: false,
              }
            : message,
        ),
      );
    } finally {
      setIsSending(false);
    }
  };

  if (!token || !user) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md rounded-3xl border border-slate-700 bg-slate-900/95 p-8 shadow-2xl shadow-slate-950/40">
          <div className="mb-8 text-center">
            <p className="text-sm uppercase tracking-[0.35em] text-cyan-400">
              RAG Chatbot Login
            </p>
            <h1 className="mt-4 text-3xl font-semibold text-white">
              Connect to backend API
            </h1>
            <p className="mt-2 text-sm text-slate-400">
              Use your backend credentials to log in and start chatting.
            </p>
          </div>

          <form onSubmit={login} className="space-y-5">
            <label className="block text-sm text-slate-300">
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none transition focus:border-cyan-400"
                placeholder="admin@example.com"
                required
              />
            </label>

            <label className="block text-sm text-slate-300">
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none transition focus:border-cyan-400"
                placeholder="••••••••"
                required
              />
            </label>

            {error && (
              <div className="rounded-2xl bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                {error}
              </div>
            )}

            <button
              type="submit"
              className="inline-flex w-full items-center justify-center rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
            >
              {status || "Sign in"}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-slate-500">
            Backend: <span className="text-slate-300">{API_BASE}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-7xl gap-6 px-4 py-6 lg:px-8">
        <aside className="hidden w-80 flex-col gap-4 rounded-3xl border border-slate-800 bg-slate-900/95 p-4 shadow-2xl shadow-slate-950/20 lg:flex">
          <div className="flex items-center justify-between gap-4 px-3 py-2">
            <div>
              <h2 className="text-lg font-semibold text-white">Chats</h2>
              <p className="text-sm text-slate-400">
                Select a conversation or start new.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setActiveChat(null);
                setMessages([]);
              }}
              className="rounded-2xl border border-slate-700 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
            >
              New
            </button>
          </div>

          <div className="overflow-y-auto px-1 pb-2">
            {isLoadingChats ? (
              <div className="rounded-3xl bg-slate-900/80 p-4 text-sm text-slate-400">
                Loading chats...
              </div>
            ) : chatList.length === 0 ? (
              <div className="rounded-3xl bg-slate-900/80 p-4 text-sm text-slate-400">
                No chats available yet. Start a new conversation.
              </div>
            ) : (
              chatList.map((chat) => (
                <button
                  key={chat._id}
                  type="button"
                  onClick={() => setActiveChat(chat)}
                  className={`mb-2 w-full rounded-3xl border px-4 py-4 text-left transition ${
                    activeChat?._id === chat._id
                      ? "border-cyan-400 bg-cyan-500/10 text-white"
                      : "border-slate-800 bg-slate-950/80 text-slate-300 hover:border-slate-600 hover:bg-slate-900"
                  }`}
                >
                  <div className="text-sm font-semibold">
                    {chat.title || "Untitled chat"}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {chat.updatedAt
                      ? new Date(chat.updatedAt).toLocaleString()
                      : "No messages yet"}
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="mt-auto rounded-3xl border border-slate-800 bg-slate-950/80 p-4 text-sm text-slate-400">
            <div className="font-semibold text-slate-100">{user?.email}</div>
            <div className="mt-1">
              {user?.organization?.name || "Organization"}
            </div>
            <button
              type="button"
              onClick={logout}
              className="mt-4 inline-flex w-full items-center justify-center rounded-2xl bg-rose-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-rose-400"
            >
              Logout
            </button>
          </div>
        </aside>

        <main className="flex-1 rounded-3xl border border-slate-800 bg-slate-900/95 p-6 shadow-2xl shadow-slate-950/30">
          <div className="mb-6 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.35em] text-cyan-400">
                AI Agent
              </p>
              <h1 className="mt-2 text-3xl font-semibold text-white">
                {activeChat?.title || "Start a new conversation"}
              </h1>
            </div>
            <div className="rounded-3xl border border-slate-800 bg-slate-950/80 px-4 py-3 text-sm text-slate-400">
              {status || "Connected to backend"}
            </div>
          </div>

          {error && (
            <div className="mb-4 rounded-3xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          )}

          <div className="mb-4 max-h-[60vh] overflow-y-auto rounded-3xl border border-slate-800 bg-slate-950/70 p-4 shadow-inner shadow-slate-950/10">
            {messages.length === 0 ? (
              <div className="space-y-4 text-slate-400">
                <p className="text-base">
                  Send a prompt to the backend and view streaming AI responses
                  here.
                </p>
                <p className="text-sm">
                  Example: "Summarize the attached documents" or "What are the
                  key points?"
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((message) => (
                  <div
                    key={message._id}
                    className={`rounded-3xl p-4 ${
                      message.role === "assistant"
                        ? "bg-slate-800 text-slate-100"
                        : "bg-slate-950 text-slate-200 self-end"
                    }`}
                  >
                    <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-slate-500">
                      <span>
                        {message.role === "assistant" ? "Assistant" : "You"}
                      </span>
                      {message.streaming && (
                        <span className="text-cyan-300">Streaming…</span>
                      )}
                    </div>
                    <div className="whitespace-pre-wrap text-sm leading-6 text-slate-100">
                      {message.content}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          <form onSubmit={sendPrompt} className="mt-4 flex flex-col gap-3">
            <label className="sr-only" htmlFor="prompt">
              Ask a question
            </label>
            <textarea
              id="prompt"
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Type your question or instruction here..."
              className="w-full resize-none rounded-3xl border border-slate-800 bg-slate-950 px-4 py-4 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400"
            />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-slate-500">
                Connected backend:{" "}
                <span className="text-slate-300">{API_BASE}</span>
              </p>
              <button
                type="submit"
                disabled={isSending || !prompt.trim()}
                className="inline-flex items-center justify-center rounded-3xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-700"
              >
                {isSending ? "Waiting for response…" : "Send prompt"}
              </button>
            </div>
          </form>
        </main>
      </div>
    </div>
  );
};

export default App;
