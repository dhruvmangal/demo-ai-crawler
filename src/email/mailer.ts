import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env';

interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!env.smtp.host) {
    return null;
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.password } : undefined
    });
  }
  return transporter;
}

// Falls back to logging the email to the console when SMTP isn't configured (the default
// in local/dev) rather than failing signup/reset flows outright.
export async function sendEmail({ to, subject, text }: SendEmailInput): Promise<void> {
  const t = getTransporter();
  if (!t) {
    console.log(`[Mailer] SMTP not configured -- would send email:\nTo: ${to}\nSubject: ${subject}\n${text}`);
    return;
  }
  await t.sendMail({ from: env.smtp.fromAddress, to, subject, text });
}
