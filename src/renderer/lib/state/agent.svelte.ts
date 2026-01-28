import { v4 as uuidv4 } from "uuid";

export function useAgent() {
  const connected = $state(false);
  const activeRequestId = $state<string | null>(null);
  const messages = $state<Array<{ role: string; content: string }>>([]);

  async function chat(message: string, threadId?: string) {
    const userMessage = { role: "user" as const, content: message };
    messages = [...messages, userMessage];

    activeRequestId = uuidv4();

    try {
      const response = await window.electronAPI.agent.chat(
        "",
        message,
        threadId
      );

      if (response.success && response.data) {
        const result = response.data as any;

        if (result.type === "graph-complete" && result.result) {
          const assistantMessages = result.result.messages || [];
          messages = [...messages, ...assistantMessages];
        }
      } else {
        messages = [
          ...messages,
          {
            role: "assistant",
            content: `Error: ${response.error || "Unknown error"}`,
          },
        ];
      }
    } catch (error) {
      messages = [
        ...messages,
        {
          role: "assistant",
          content: `Error: ${(error as Error).message}`,
        },
      ];
    } finally {
      activeRequestId = null;
    }
  }

  function clearMessages() {
    messages = [];
  }

  return {
    connected,
    activeRequestId,
    messages,
    chat,
    clearMessages,
  };
}
