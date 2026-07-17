/**
 * Bridge to an SMTP server for transactional email — currently just
 * password-reset links. Configured entirely through environment variables,
 * following the exact env-gated disable pattern used by the DJI Cloud
 * bridge (packages/backend/src/services/djiCloud.ts): when they're absent
 * the feature is disabled and callers fall back to a manual-relay path
 * (see routes/auth.ts's /forgot-password) instead of silently failing.
 *
 * - SMTP_HOST
 * - SMTP_PORT
 * - SMTP_USER
 * - SMTP_PASSWORD
 * - SMTP_FROM
 */
import nodemailer from "nodemailer";

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
}

/** Read at call time (not module load) so tests can stub the env. */
function readConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST;
  const portRaw = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM;
  if (!host || !portRaw || !user || !password || !from) return null;

  const port = parseInt(portRaw, 10);
  if (Number.isNaN(port)) return null;

  return { host, port, user, password, from };
}

export function isEmailConfigured(): boolean {
  return readConfig() !== null;
}

/**
 * Sends the password-reset link to the account's email address. Throws if
 * SMTP isn't configured or delivery fails — callers are expected to catch
 * this and fall back to the console-log manual-relay path rather than
 * letting a delivery failure surface to the requester (which would leak
 * whether the account exists).
 */
export async function sendPasswordResetEmail(
  to: string,
  resetUrl: string,
): Promise<void> {
  const cfg = readConfig();
  if (!cfg) {
    throw new Error("SMTP není nakonfigurován");
  }

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.password },
  });

  await transporter.sendMail({
    from: cfg.from,
    to,
    subject: "Obnovení hesla — SkyRoute",
    text:
      `Pro obnovení hesla klikněte na odkaz níže. Odkaz je platný 1 hodinu.\n\n${resetUrl}\n\n` +
      `Pokud jste o obnovení hesla nežádali, tento e-mail ignorujte — vaše heslo zůstává beze změny.`,
    html:
      `<p>Pro obnovení hesla klikněte na odkaz níže. Odkaz je platný 1 hodinu.</p>` +
      `<p><a href="${resetUrl}">${resetUrl}</a></p>` +
      `<p>Pokud jste o obnovení hesla nežádali, tento e-mail ignorujte — vaše heslo zůstává beze změny.</p>`,
  });
}
