import { useEffect, useRef, useState, type FormEvent } from "react";
import { Client, type Conversation, type Message } from "@twilio/conversations";
import { ChevronRight, MessageSquareText } from "lucide-react";
import { api } from "./api";

interface GroupChatProps {
  eventGroupId: string;
  close: () => void;
  notify: (message: string) => void;
}

interface GroupChatAccess {
  token: string;
  conversationSid: string;
  identity: string;
  displayName: string;
  eventName: string;
  eventGroupName: string;
}

interface ChatMessage {
  sid: string;
  author: string;
  body: string;
  createdAt?: Date;
}

function participantName(attributes: unknown, identity: string) {
  if (typeof attributes === "object" && attributes && "displayName" in attributes) {
    const displayName = (attributes as { displayName?: unknown }).displayName;
    if (typeof displayName === "string" && displayName.trim()) return displayName;
  }
  if (typeof attributes === "string") {
    try {
      return participantName(JSON.parse(attributes), identity);
    } catch {
      // Fall through to the privacy-safe identity.
    }
  }
  return identity;
}

function toChatMessage(message: Message): ChatMessage {
  return {
    sid: message.sid,
    author: message.author ?? "Unknown member",
    body: message.body ?? "",
    createdAt: message.dateCreated ?? undefined
  };
}

export function GroupChat({ eventGroupId, close, notify }: GroupChatProps) {
  const [access, setAccess] = useState<GroupChatAccess | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    let client: Client | undefined;
    let currentConversation: Conversation | undefined;
    const loadAccess = () =>
      api<GroupChatAccess>(`/event-groups/${eventGroupId}/group-chat-access`, { method: "POST" });

    const connect = async () => {
      try {
        const nextAccess = await loadAccess();
        if (!active) return;
        setAccess(nextAccess);
        client = new Client(nextAccess.token);
        currentConversation = await client.getConversationBySid(nextAccess.conversationSid);
        const [page, participants] = await Promise.all([
          currentConversation.getMessages(100),
          currentConversation.getParticipants()
        ]);
        if (!active) return;
        setNames(
          Object.fromEntries(
            participants
              .filter((participant) => participant.identity)
              .map((participant) => [
                participant.identity!,
                participantName(participant.attributes, participant.identity!)
              ])
          )
        );
        setMessages(page.items.map(toChatMessage));
        setConversation(currentConversation);
        currentConversation.on("messageAdded", (message) => {
          if (active) setMessages((current) => [...current, toChatMessage(message)]);
        });
        const refreshToken = async () => {
          const refreshed = await loadAccess();
          if (active) await client?.updateToken(refreshed.token);
        };
        client.on("tokenAboutToExpire", refreshToken);
        client.on("tokenExpired", refreshToken);
      } catch (reason) {
        if (active) setError((reason as Error).message || "Unable to open group chat");
      }
    };

    void connect();
    return () => {
      active = false;
      currentConversation?.removeAllListeners();
      client?.removeAllListeners();
      void client?.shutdown();
    };
  }, [eventGroupId]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [close]);

  useEffect(() => {
    historyRef.current?.scrollTo({ top: historyRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    if (!conversation || sending) return;
    const form = formEvent.currentTarget;
    const body = String(new FormData(form).get("message") ?? "").trim();
    if (!body) return;
    setSending(true);
    try {
      await conversation.sendMessage(body);
      form.reset();
    } catch (reason) {
      notify((reason as Error).message || "Message could not be sent");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <nav className="chat-page-breadcrumb" aria-label="Breadcrumb">
        <button type="button" onClick={close}>
          Conversations <ChevronRight size={16} />
        </button>
      </nav>
      <div className="page-title">
        <span className="eyebrow">Communication</span>
        <h1 id="group-chat-title">
          {access?.eventName ?? "Event"} – {access?.eventGroupName ?? "Event team"} – Team Chat
        </h1>
      </div>
      <section className="group-chat-page chat-page-surface" aria-labelledby="group-chat-title">
        <div className="group-chat-history chat-page-history" ref={historyRef} aria-live="polite">
          {error ? (
            <div className="group-chat-state error" role="alert">
              {error}
            </div>
          ) : !conversation ? (
            <div className="group-chat-state">Connecting securely…</div>
          ) : messages.length ? (
            messages.map((message) => {
              const mine = message.author === access?.identity;
              return (
                <article className={mine ? "group-chat-message mine" : "group-chat-message"} key={message.sid}>
                  {!mine && <strong>{names[message.author] ?? message.author}</strong>}
                  <p>{message.body}</p>
                  <small>
                    {mine ? "You" : (names[message.author] ?? "Team member")}
                    {message.createdAt
                      ? ` · ${message.createdAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                      : ""}
                  </small>
                </article>
              );
            })
          ) : (
            <div className="group-chat-state">No messages yet. Start the conversation.</div>
          )}
        </div>
        <form className="group-chat-compose chat-page-compose" onSubmit={send}>
          <label className="sr-only" htmlFor="group-chat-message">
            Message
          </label>
          <textarea
            id="group-chat-message"
            name="message"
            rows={2}
            maxLength={1600}
            placeholder="Message your team"
            disabled={!conversation || sending}
            autoFocus
            required
          />
          <button className="primary" disabled={!conversation || sending}>
            <MessageSquareText size={16} /> {sending ? "Sending…" : "Send"}
          </button>
        </form>
      </section>
    </>
  );
}
