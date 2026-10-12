import type { E2eControlRuntime } from '@incentives/contracts';
import { withAuthBusinessWrite } from './services/e2e-write-fence.js';

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
  controlRuntime?: E2eControlRuntime;
}

export function createLocalCaptureEmailAdapter(database: D1Database, runtime?: E2eControlRuntime): EmailAdapter {
  return {
    async send(message) {
      const insert = database.prepare(`
        INSERT INTO local_email_capture (id, recipient, subject, text_body, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5)
      `).bind(
        crypto.randomUUID(),
        message.to,
        message.subject,
        message.text,
        Date.now(),
      );
      // Real/shared recipients are not tenant-owned merely because they were invited.
      // Retained v2 synthetic namespaces are permanent, even without a live ledger.
      const scopes = await database.prepare(`SELECT run_id AS runId,merchant_id AS merchantId
        FROM e2e_control_email_namespaces
        WHERE substr(lower(?1),1,length(prefix))=prefix AND substr(lower(?1),-12)='@e2e.invalid'`)
        .bind(message.to).all<{ runId:string;merchantId:string|null }>();
      if (scopes.results.length===0) {
        await database.batch([insert]);
        return;
      }
      if (scopes.results.length!==1 || !scopes.results[0]?.merchantId) {
        throw new Error('E2E_CONTROL_EMAIL_SCOPE');
      }
      const invitations = await database.prepare(`SELECT organization_id AS organizationId
        FROM e2e_control_invitation_mail WHERE recipient=lower(?1) AND run_id=?2 AND merchant_id=?3`)
        .bind(message.to,scopes.results[0].runId,scopes.results[0].merchantId).all<{ organizationId:string }>();
      if (invitations.results.length!==1 || !invitations.results[0]) throw new Error('E2E_CONTROL_EMAIL_SCOPE');
      // SQL row predicates recheck the exact live invitation; final guard rechecks
      // the lease after the actual INSERT in the same atomic D1 batch.
      await withAuthBusinessWrite(database,runtime,invitations.results[0].organizationId,[insert]);
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
    return createLocalCaptureEmailAdapter(options.database,options.controlRuntime);
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
