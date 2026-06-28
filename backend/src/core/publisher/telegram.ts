/**
 * Telegram publisher — send messages and media via Telegram Bot API.
 */

import { logger } from "../../lib/logger.js";

export interface TelegramPublishOptions {
  botToken: string;
  chatId: string;
  content: string;
  mediaUrl?: string;
  mediaType?: "photo" | "video" | "animation" | "document";
  parseMode?: "Markdown" | "MarkdownV2" | "HTML";
  replyMarkup?: Record<string, unknown>;
}

interface TelegramPublishResult {
  success: boolean;
  messageId?: number;
  error?: string;
}

/**
 * Send a text message via Telegram Bot API.
 */
async function sendTextMessage(
  botToken: string,
  chatId: string,
  text: string,
  parseMode?: string,
  replyMarkup?: Record<string, unknown>
): Promise<number> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: text.slice(0, 4096), // Telegram message limit
  };

  if (parseMode) {
    body.parse_mode = parseMode;
  }

  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Telegram sendMessage failed: ${error}`);
  }

  const data = (await response.json()) as { result?: { message_id?: number } };
  if (!data.result?.message_id) {
    throw new Error("Message ID not returned");
  }

  return data.result.message_id;
}

/**
 * Send media via Telegram Bot API.
 */
async function sendMedia(
  botToken: string,
  chatId: string,
  mediaUrl: string,
  mediaType: string,
  caption?: string,
  parseMode?: string
): Promise<number> {
  const methodMap: Record<string, string> = {
    photo: "sendPhoto",
    video: "sendVideo",
    animation: "sendAnimation",
    document: "sendDocument",
  };

  const method = methodMap[mediaType] || "sendPhoto";
  const paramMap: Record<string, string> = {
    photo: "photo",
    video: "video",
    animation: "animation",
    document: "document",
  };

  const body: Record<string, unknown> = {
    chat_id: chatId,
    [paramMap[mediaType]]: mediaUrl,
  };

  if (caption) {
    body.caption = caption.slice(0, 1024); // Telegram caption limit
  }

  if (parseMode) {
    body.parse_mode = parseMode;
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Telegram ${method} failed: ${error}`);
  }

  const data = (await response.json()) as { result?: { message_id?: number } };
  if (!data.result?.message_id) {
    throw new Error("Message ID not returned");
  }

  return data.result.message_id;
}

/**
 * Publish to Telegram.
 */
export async function publishToTelegram(
  options: TelegramPublishOptions
): Promise<TelegramPublishResult> {
  try {
    const { botToken, chatId, content, mediaUrl, mediaType, parseMode, replyMarkup } = options;

    if (mediaUrl) {
      const messageId = await sendMedia(
        botToken,
        chatId,
        mediaUrl,
        mediaType || "photo",
        content,
        parseMode || "Markdown"
      );
      return { success: true, messageId };
    }

    const messageId = await sendTextMessage(
      botToken,
      chatId,
      content,
      parseMode || "Markdown",
      replyMarkup
    );

    return { success: true, messageId };
  } catch (error) {
    logger.error({ error }, "Telegram publish failed");
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
