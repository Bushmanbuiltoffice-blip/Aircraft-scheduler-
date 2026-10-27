import type { D1Database } from "@cloudflare/workers-types";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
};

/**
 * Swap this interface for a real provider (Resend, MailChannels, Postmark, …)
 * when you want mail to leave the building. Nothing here calls an email API.
 */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export class OutboxEmailSender implements EmailSender {
  constructor(private readonly db: D1Database) {}

  async send(message: EmailMessage): Promise<void> {
    await this.db
      .prepare("INSERT INTO email_outbox (id, to_email, subject, body, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), message.to, message.subject, message.text, new Date().toISOString())
      .run();
    console.log(`[rampboard email] to=${message.to} subject=${message.subject}`);
  }
}

export function createEmailSender(db: D1Database): EmailSender {
  return new OutboxEmailSender(db);
}

export async function safeSend(sender: EmailSender, message: EmailMessage): Promise<void> {
  try {
    await sender.send(message);
  } catch (error) {
    console.error("Email hook failed", error);
  }
}

export function reservationMessage(input: {
  recipientName: string;
  tail: string;
  when: string;
  pilotName: string;
  instructorName: string | null;
  kind: "booked" | "updated" | "cancelled" | "checked_in";
  total?: string;
}): EmailMessage {
  const who = input.instructorName ? `${input.pilotName} with ${input.instructorName}` : `${input.pilotName} (solo)`;
  const verb =
    input.kind === "booked"
      ? "confirmed"
      : input.kind === "updated"
        ? "updated"
        : input.kind === "cancelled"
          ? "cancelled"
          : "closed";
  const lines = [
    `Hi ${input.recipientName},`,
    "",
    `Your Bushman Aviation reservation was ${verb}.`,
    `Aircraft: ${input.tail}`,
    `When: ${input.when} (Pacific Time)`,
    `Pilot: ${who}`,
  ];
  if (input.total) lines.push(`Total billed from Hobbs: ${input.total}`);
  lines.push("", "This note was recorded by Rampboard. No email provider is connected yet.");
  return {
    to: "",
    subject: `${input.tail} reservation ${verb}`,
    text: lines.join("\n"),
  };
}
