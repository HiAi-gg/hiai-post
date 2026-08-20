import { describe, expect, it } from "vitest";
import type { SSEMessage } from "./sse";
import { parseSSE, readSSEStream, SSEParser } from "./sse";

describe("SSEParser", () => {
  it("parses a complete multi-event stream", () => {
    const text = [
      "event: result",
      'data: {"type":"result","message":"Topics generated"}',
      "",
      'data: {"type":"complete"}',
      "",
    ].join("\n");
    const events = parseSSE(text);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ event: "result" });
    expect(events[0].data).toBe('{"type":"result","message":"Topics generated"}');
    expect(events[1]).toMatchObject({ event: "message" });
  });

  it("buffers partial lines split across chunks", () => {
    const parser = new SSEParser();
    const chunks = ["data: {", '"type":"res', 'ult"}\n\n', "data: x\n\n"];
    const out: SSEMessage[] = [];
    for (const chunk of chunks) out.push(...parser.push(chunk));
    out.push(...parser.end());
    expect(out).toHaveLength(2);
    expect(out[0].data).toBe('{"type":"result"}');
    expect(out[1].data).toBe("x");
  });

  it("splits a single field across chunk boundaries mid-token", () => {
    const parser = new SSEParser();
    const events = [
      ...parser.push("data: 1"),
      ...parser.push("\n\n"),
      ...parser.push("event: done\ndata"),
      ...parser.push(": 2\n\n"),
    ];
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ data: "1", event: "message" });
    expect(events[1]).toMatchObject({ data: "2", event: "done" });
  });

  it("handles CRLF, bare CR, and LF line endings", () => {
    const crlf = parseSSE("data: a\r\n\r\n");
    const cr = parseSSE("data: b\r\r");
    expect(crlf[0].data).toBe("a");
    expect(cr[0].data).toBe("b");
  });

  it("treats a bare CR earlier in a chunk as a line terminator", () => {
    // Mixed endings in one chunk: `\r` splits the line even though a `\n`
    // appears later in the same chunk.
    const events = parseSSE("data: a\rdocument: x\n\n");
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe("a");
  });

  it("holds a trailing CR when it may start a split CRLF sequence", () => {
    const parser = new SSEParser();
    // First chunk ends with a lone \r — must not dispatch prematurely.
    const first = parser.push("data: a\r");
    expect(first).toHaveLength(0);
    // Next chunk completes the CRLF + blank line.
    const second = parser.push("\n\ndata: b\n\n");
    expect(second).toHaveLength(2);
    expect(second[0].data).toBe("a");
    expect(second[1].data).toBe("b");
  });

  it("joins multi-line data fields with newlines", () => {
    const events = parseSSE("data: line1\ndata: line2\ndata: line3\n\n");
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe("line1\nline2\nline3");
  });

  it("ignores comments and unknown fields", () => {
    const events = parseSSE(": keep-alive\nx-unknown: nope\ndata: ok\n\n");
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe("ok");
  });

  it("parses id and retry fields and ignores NUL ids", () => {
    const events = parseSSE("id: 42\nretry: 5000\ndata: hi\n\nid: bad\u0000value\ndata: no\n\n");
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ data: "hi", id: "42", retry: 5000 });
    // NUL-containing id is ignored, previous id carries over.
    expect(events[1]).toMatchObject({ data: "no", id: "42" });
  });

  it("strips a leading BOM", () => {
    const events = parseSSE("\uFEFFdata: hello\n\n");
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe("hello");
  });

  it("reassembles multi-byte UTF-8 characters split across binary chunks", () => {
    const parser = new SSEParser();
    // "é" is 0xC3 0xA9 — split the two bytes across chunks.
    const encoder = new TextEncoder();
    const full = encoder.encode("data: café\n\n");
    const events = [...parser.push(full.subarray(0, 8)), ...parser.push(full.subarray(8))];
    events.push(...parser.end());
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe("café");
  });

  it("dispatches a trailing event without a blank line on end()", () => {
    const parser = new SSEParser();
    parser.push('event: complete\ndata: {"count":1}');
    const events = parser.end();
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("complete");
  });

  it("handles an empty data field", () => {
    const events = parseSSE("event: ping\ndata\n\n");
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("ping");
    expect(events[0].data).toBe("");
  });
});

describe("readSSEStream", () => {
  it("streams messages from a fetch-like response body", async () => {
    const encoder = new TextEncoder();
    const chunks = ['event: result\ndata: {"a":1}\n\n', 'data: {"b":2}\n\n'];
    const body = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    const response = new Response(body, {
      headers: { "Content-Type": "text/event-stream" },
    });

    const messages: SSEMessage[] = [];
    await readSSEStream(response, (message) => messages.push(message));
    expect(messages).toHaveLength(2);
    expect(messages[0].data).toBe('{"a":1}');
    expect(messages[1].data).toBe('{"b":2}');
  });
});
