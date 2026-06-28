/**
 * Telegram Bot API integration — no OAuth, uses bot token.
 * API: https://api.telegram.org/bot<token>/
 */

import { logger } from "../../lib/logger.js";

const TELEGRAM_API_URL = "https://api.telegram.org";

export interface TelegramBotConfig {
  botToken: string;
}

export interface TelegramBotInfo {
  id: number;
  username: string;
  firstName: string;
  canJoinGroups?: boolean;
  canReadAllGroupMessages?: boolean;
  supportsInlineQueries?: boolean;
}

export interface TelegramChatInfo {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
}

export interface TelegramMessageResult {
  success: boolean;
  messageId?: number;
  error?: string;
}

export interface TelegramMediaGroupItem {
  type: "photo" | "video" | "document" | "animation";
  media: string;
  caption?: string;
  parse_mode?: string;
}

function botUrl(botToken: string): string {
  return `${TELEGRAM_API_URL}/bot${botToken}`;
}

export async function getTelegramBotInfo(botToken: string): Promise<TelegramBotInfo> {
  const response = await fetch(`${botUrl(botToken)}/getMe`, {
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`Telegram getMe failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    ok: boolean;
    result?: {
      id: number;
      username: string;
      first_name: string;
      can_join_groups?: boolean;
      can_read_all_group_messages?: boolean;
      supports_inline_queries?: boolean;
    };
  };

  if (!data.ok || !data.result) {
    throw new Error("Telegram bot info not available");
  }

  return {
    id: data.result.id,
    username: data.result.username,
    firstName: data.result.first_name,
    canJoinGroups: data.result.can_join_groups,
    canReadAllGroupMessages: data.result.can_read_all_group_messages,
    supportsInlineQueries: data.result.supports_inline_queries,
  };
}

export async function getTelegramChatInfo(
  botToken: string,
  chatId: string
): Promise<TelegramChatInfo> {
  const response = await fetch(`${botUrl(botToken)}/getChat?chat_id=${chatId}`, {
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`Telegram getChat failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    ok: boolean;
    result?: {
      id: number;
      type: string;
      title?: string;
      username?: string;
      first_name?: string;
      last_name?: string;
    };
  };

  if (!data.ok || !data.result) {
    throw new Error("Telegram chat not found");
  }

  return {
    id: data.result.id,
    type: data.result.type as TelegramChatInfo["type"],
    title: data.result.title,
    username: data.result.username,
    firstName: data.result.first_name,
    lastName: data.result.last_name,
  };
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  parseMode?: "Markdown" | "MarkdownV2" | "HTML"
): Promise<TelegramMessageResult> {
  try {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text: text.slice(0, 4096),
    };

    if (parseMode) {
      body.parse_mode = parseMode;
    }

    const response = await fetch(`${botUrl(botToken)}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const err = await response.text();
      logger.error({ status: response.status, error: err }, "Telegram sendMessage failed");
      return { success: false, error: `Telegram API error: ${response.status}` };
    }

    const data = (await response.json()) as { result?: { message_id?: number } };
    return { success: true, messageId: data.result?.message_id };
  } catch (error) {
    logger.error({ error }, "Telegram sendMessage failed");
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function sendTelegramPhoto(
  botToken: string,
  chatId: string,
  photoUrl: string,
  caption?: string,
  parseMode?: "Markdown" | "MarkdownV2" | "HTML"
): Promise<TelegramMessageResult> {
  try {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      photo: photoUrl,
    };

    if (caption) {
      body.caption = caption.slice(0, 1024);
    }
    if (parseMode) {
      body.parse_mode = parseMode;
    }

    const response = await fetch(`${botUrl(botToken)}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const err = await response.text();
      logger.error({ status: response.status, error: err }, "Telegram sendPhoto failed");
      return { success: false, error: `Telegram API error: ${response.status}` };
    }

    const data = (await response.json()) as { result?: { message_id?: number } };
    return { success: true, messageId: data.result?.message_id };
  } catch (error) {
    logger.error({ error }, "Telegram sendPhoto failed");
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function sendTelegramMediaGroup(
  botToken: string,
  chatId: string,
  media: TelegramMediaGroupItem[]
): Promise<TelegramMessageResult> {
  try {
    const response = await fetch(`${botUrl(botToken)}/sendMediaGroup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        media: media.slice(0, 10).map((item) => ({
          type: item.type,
          media: item.media,
          caption: item.caption?.slice(0, 1024),
          parse_mode: item.parse_mode,
        })),
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const err = await response.text();
      logger.error({ status: response.status, error: err }, "Telegram sendMediaGroup failed");
      return { success: false, error: `Telegram API error: ${response.status}` };
    }

    const data = (await response.json()) as { result?: Array<{ message_id?: number }> };
    return { success: true, messageId: data.result?.[0]?.message_id };
  } catch (error) {
    logger.error({ error }, "Telegram sendMediaGroup failed");
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
