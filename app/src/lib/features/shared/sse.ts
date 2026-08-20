/**
 * Robust SSE parser for the hiai-kit feature APIs.
 *
 * The scriptforge endpoints stream `data: <json>\n\n` events, and the
 * response body arrives in arbitrary network chunks, so the parser must
 * handle:
 *
 * - field/data lines split across chunk boundaries (including `\r\n`);
 * - multi-byte UTF-8 sequences split across chunks;
 * - CRLF, bare `\r`, and `\n` line endings;
 * - multi-line `data:` fields (joined with `\n`), `event:`/`id:`/`retry:`;
 * - comments (`:` lines), unknown fields, and a leading BOM;
 * - a final event that is not terminated by a blank line.
 */

export interface SSEMessage {
  /** Value of the `data` field(s); multi-line data is joined with `\n`. */
  data: string;
  /** Event type; defaults to `"message"`. */
  event: string;
  /** Last `id:` field value (ignored when it contains NUL). */
  id?: string;
  /** Last `retry:` field value. */
  retry?: number;
}

export class SSEParser {
  #decoder = new TextDecoder("utf-8");
  #buffer = "";
  #data = "";
  #event = "message";
  #id: string | undefined;
  #retry: number | undefined;
  #pending: SSEMessage[] = [];

  /**
   * Feed the next chunk of the stream. `input` may be a binary chunk from a
   * `ReadableStream` reader or an already-decoded string (tests).
   * Returns any events completed by this chunk.
   */
  push(input: string | Uint8Array | ArrayBuffer): SSEMessage[] {
    if (typeof input === "string") {
      this.#buffer += input;
    } else {
      // stream: true keeps incomplete multi-byte sequences buffered internally.
      this.#buffer += this.#decoder.decode(input, { stream: true });
    }
    this.#processBuffer();
    return this.#drain();
  }

  /** Flush any buffered input and dispatch a trailing unterminated event. */
  end(): SSEMessage[] {
    this.#buffer += this.#decoder.decode();
    this.#processBuffer();
    if (this.#data !== "" || this.#event !== "message") {
      this.#dispatch();
    }
    return this.#drain();
  }

  #processBuffer(): void {
    // Consume complete lines using the earliest line terminator. A trailing
    // `\r` is held back because it may be the first half of a `\r\n` sequence
    // split across chunks.
    while (this.#buffer.length > 0) {
      let terminator = this.#buffer.indexOf("\n");
      const cr = this.#buffer.indexOf("\r");
      if (cr !== -1 && cr < this.#buffer.length - 1 && (terminator === -1 || cr < terminator)) {
        terminator = cr;
      }
      if (terminator === -1) break;

      const isCrLf = this.#buffer[terminator] === "\r" && this.#buffer[terminator + 1] === "\n";
      this.#line(this.#buffer.slice(0, terminator));
      this.#buffer = this.#buffer.slice(terminator + (isCrLf ? 2 : 1));
    }
  }

  #line(raw: string): void {
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // BOM
    if (raw.startsWith(":")) return; // comment
    if (raw === "") {
      // Empty line: dispatch the buffered event (SSE spec §dispatch).
      this.#dispatch();
      return;
    }

    const colon = raw.indexOf(":");
    const field = colon === -1 ? raw : raw.slice(0, colon);
    const value = colon === -1 ? "" : raw.slice(colon + 1);
    const trimmed = value.startsWith(" ") ? value.slice(1) : value;

    switch (field) {
      case "data":
        this.#data = this.#data === "" ? trimmed : `${this.#data}\n${trimmed}`;
        break;
      case "event":
        this.#event = trimmed;
        break;
      case "id":
        if (!trimmed.includes("\0")) this.#id = trimmed;
        break;
      case "retry": {
        const parsed = Number(trimmed);
        if (Number.isFinite(parsed) && parsed >= 0) this.#retry = parsed;
        break;
      }
      default:
        break; // ignore unknown fields per the SSE spec
    }
  }

  #dispatch(): void {
    const message: SSEMessage = { data: this.#data, event: this.#event };
    if (this.#id !== undefined) message.id = this.#id;
    if (this.#retry !== undefined) message.retry = this.#retry;
    this.#pending.push(message);
    this.#data = "";
    this.#event = "message";
  }

  #drain(): SSEMessage[] {
    const out = this.#pending;
    this.#pending = [];
    return out;
  }
}

/** Parse a complete SSE text (e.g. a captured body) into messages. */
export function parseSSE(text: string): SSEMessage[] {
  const parser = new SSEParser();
  return parser.push(text).concat(parser.end());
}

/**
 * Consume a fetch `Response` body as an SSE stream, invoking `onMessage`
 * for each parsed event. Resolves once the stream ends or errors.
 */
export async function readSSEStream(
  response: Response,
  onMessage: (message: SSEMessage) => void
): Promise<void> {
  if (!response.body) return;
  const parser = new SSEParser();
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const message of parser.push(value)) onMessage(message);
  }
  for (const message of parser.end()) onMessage(message);
}
