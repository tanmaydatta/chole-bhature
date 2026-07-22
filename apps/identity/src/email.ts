export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailAdapter {
  send(message: EmailMessage): Promise<void>;
}

export interface ResendEmailAdapterOptions {
  apiKey: string;
  from: string;
  allowedRecipients?: ReadonlySet<string>;
  fetch?: typeof fetch;
}

export interface IdentityEmailOptions {
  mode: 'local-capture' | 'resend';
  database: D1Database;
  resendApiKey?: string;
  resendFrom?: string;
  allowedRecipients: ReadonlySet<string>;
}

export function createLocalCaptureEmailAdapter(database: D1Database): EmailAdapter {
  return {
    async send(message) {
      await database.prepare(`
        INSERT INTO local_email_capture (id, recipient, subject, text_body, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5)
      `).bind(
        crypto.randomUUID(),
        message.to,
        message.subject,
        message.text,
        Date.now(),
      ).run();
    },
  };
}

export function createResendEmailAdapter(options: ResendEmailAdapterOptions): EmailAdapter {
  const send = options.fetch ?? globalThis.fetch;

  return {
    async send(message) {
      if (options.allowedRecipients && !options.allowedRecipients.has(message.to)) {
        throw new Error('Recipient is not allowed in staging');
      }

      const payload: Record<string, unknown> = {
        from: options.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
      };
      if (message.html !== undefined) payload.html = message.html;

      const response = await send('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error('Email delivery failed');
    },
  };
}

export function createIdentityEmailAdapter(options: IdentityEmailOptions): EmailAdapter {
  if (options.mode === 'local-capture') {
    return createLocalCaptureEmailAdapter(options.database);
  }

  if (!options.resendApiKey || !options.resendFrom) {
    throw new Error('Resend email configuration is incomplete');
  }

  return createResendEmailAdapter({
    apiKey: options.resendApiKey,
    from: options.resendFrom,
    allowedRecipients: options.allowedRecipients,
  });
}
