// Captured-shape SSE event fixtures for @opencode-ai/sdk v1 stream.
// Built against @opencode-ai/sdk ^1.4.6. The OpencodeAdapter only reads
// `evt.type` and `evt.properties.{part,sessionID,error}`, so fixtures only
// populate what the adapter actually consumes.
//
// Each scenario terminates with `session.idle` to trigger result emission.
//
// Fixture builders are functions because tests inject the live `sessionID`
// allocated by the mocked `session.create`.

type SseEvent = {
  type: string;
  properties: Record<string, unknown>;
};

export const TEXT_PART_ID = 'part_text_1';
export const TOOL_CALL_ID = 'call_tool_1';

export function scenarioTextOnly(sessionID: string): SseEvent[] {
  return [
    {
      type: 'message.part.updated',
      properties: {
        delta: 'Hello',
        part: {
          id: TEXT_PART_ID,
          type: 'text',
          messageID: 'msg_1',
          sessionID,
          text: 'Hello world',
        },
      },
    },
    {
      type: 'message.part.updated',
      properties: {
        part: {
          type: 'step-finish',
          messageID: 'msg_1',
          sessionID,
          tokens: { input: 11, output: 4 },
        },
      },
    },
    {
      type: 'session.idle',
      properties: { sessionID },
    },
  ];
}

export function scenarioToolFlow(sessionID: string): SseEvent[] {
  return [
    {
      type: 'message.part.updated',
      properties: {
        delta: 'Calling echo…',
        part: {
          id: TEXT_PART_ID,
          type: 'text',
          messageID: 'msg_1',
          sessionID,
          text: 'Calling echo…',
        },
      },
    },
    {
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'part_tool_1',
          type: 'tool',
          messageID: 'msg_1',
          sessionID,
          tool: 'echo',
          callID: TOOL_CALL_ID,
          state: { status: 'running', input: { msg: 'hi' } },
        },
      },
    },
    {
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'part_tool_1',
          type: 'tool',
          messageID: 'msg_1',
          sessionID,
          tool: 'echo',
          callID: TOOL_CALL_ID,
          state: { status: 'completed', input: { msg: 'hi' }, output: 'echo: hi' },
        },
      },
    },
    {
      type: 'session.idle',
      properties: { sessionID },
    },
  ];
}

export function scenarioMultiMessage(sessionID: string): SseEvent[] {
  return [
    {
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'part_a',
          type: 'text',
          messageID: 'msg_1',
          sessionID,
          text: 'First message',
        },
      },
    },
    {
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'part_b',
          type: 'text',
          messageID: 'msg_2',
          sessionID,
          text: 'Second message',
        },
      },
    },
    {
      type: 'session.idle',
      properties: { sessionID },
    },
  ];
}

export function scenarioThinking(sessionID: string): SseEvent[] {
  return [
    {
      type: 'message.part.updated',
      properties: {
        delta: 'reasoning…',
        part: {
          id: 'part_r',
          type: 'reasoning',
          messageID: 'msg_1',
          sessionID,
          text: 'reasoning…',
        },
      },
    },
    {
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'part_t',
          type: 'text',
          messageID: 'msg_1',
          sessionID,
          text: 'OK',
        },
      },
    },
    {
      type: 'session.idle',
      properties: { sessionID },
    },
  ];
}

export function scenarioWithUserEcho(sessionID: string): SseEvent[] {
  return [
    {
      type: 'message.updated',
      properties: {
        info: { id: 'msg_user_1', sessionID, role: 'user' },
      },
    },
    {
      type: 'message.part.updated',
      properties: {
        delta: 'PROMPT_ECHO',
        part: {
          id: 'part_user_text',
          type: 'text',
          messageID: 'msg_user_1',
          sessionID,
          text: 'PROMPT_ECHO',
        },
      },
    },
    {
      type: 'message.updated',
      properties: {
        info: { id: 'msg_assistant_1', sessionID, role: 'assistant' },
      },
    },
    {
      type: 'message.part.updated',
      properties: {
        delta: 'Hi',
        part: {
          id: 'part_assistant_text',
          type: 'text',
          messageID: 'msg_assistant_1',
          sessionID,
          text: 'Hi',
        },
      },
    },
    {
      type: 'message.part.updated',
      properties: {
        part: {
          type: 'step-finish',
          messageID: 'msg_assistant_1',
          sessionID,
          tokens: { input: 5, output: 1 },
        },
      },
    },
    {
      type: 'session.idle',
      properties: { sessionID },
    },
  ];
}

export function scenarioToolError(sessionID: string): SseEvent[] {
  return [
    {
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'part_tool_err',
          type: 'tool',
          messageID: 'msg_1',
          sessionID,
          tool: 'echo',
          callID: 'call_err',
          state: { status: 'error', error: 'boom' },
        },
      },
    },
    {
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'part_t',
          type: 'text',
          messageID: 'msg_1',
          sessionID,
          text: 'Failed',
        },
      },
    },
    {
      type: 'session.idle',
      properties: { sessionID },
    },
  ];
}
