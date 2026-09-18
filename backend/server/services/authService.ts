import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { google } from "googleapis";
import { Resend } from "resend";
import { config } from "../config/env";
import { prisma } from "../prisma/client";

export type UserRole = "admin" | "manager" | "receptionist" | "housekeeping";

export type AuthUser = {
  id: number;
  email: string;
  name: string;
  role: UserRole;
  phone?: string | null;
  password: string;
  createdAt: Date;
  updatedAt: Date;
};

export type PublicUser = Omit<AuthUser, "password" | "passwordHash">;

interface PrismaUserRecord {
  id: number;
  email: string;
  name: string;
  phone: string | null;
  password: string;
  role: string;
  created_at: Date;
  updated_at: Date;
}

export function toAuthUser(user: PrismaUserRecord): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: normalizeRole(user.role),
    phone: user.phone,
    password: user.password,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

export function normalizeRole(role?: string): UserRole {
  const normalized = role?.toLowerCase();
  if (normalized === "admin" || normalized === "manager" || normalized === "receptionist" || normalized === "housekeeping") {
    return normalized as UserRole;
  }
  return "receptionist";
}

export function isStrongPassword(password: string) {
  return password.length >= 8 && /[A-Z]/.test(password) && /[0-9]/.test(password);
}

export function buildPublicUser(user: AuthUser | { passwordHash?: string; password?: string; [key: string]: unknown }): PublicUser {
  const { password, passwordHash, ...rest } = user as AuthUser & { passwordHash?: string };
  return rest as PublicUser;
}

function createGmailRawMessage({ to, from, subject, text }: { to: string; from: string; subject: string; text: string }) {
  const message = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=\"UTF-8\"",
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
  ].join("\r\n");
  return Buffer.from(message).toString("base64url");
}

async function sendPasswordResetEmail({ to, token, name }: { to: string; token: string; name?: string }) {
  const appBaseUrl =
    process.env.APP_BASE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.FRONTEND_URL ??
    config.appBaseUrl ??
    "http://localhost:5173";
  const resetUrl = `${String(appBaseUrl).replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
  const firstName = name?.trim().split(/\s+/)[0] ?? "User";

  const gmailClientId = process.env.GMAIL_CLIENT_ID?.trim();
  const gmailClientSecret = process.env.GMAIL_CLIENT_SECRET?.trim();
  const gmailRedirectUri = process.env.GMAIL_REDIRECT_URI?.trim();
  const gmailRefreshToken = process.env.GMAIL_REFRESH_TOKEN?.trim();
  const gmailUserEmail = process.env.GMAIL_USER_EMAIL?.trim();
  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  const emailFrom = process.env.EMAIL_FROM?.trim();
  const subject = "Reset your InnKeeper password";
  const text = [
    `Hello ${firstName},`,
    "",
    "We received a request to reset your InnKeeper account password.",
    "",
    "Use the following link to reset your password:",
    resetUrl,
    "",
    "This password reset link expires after 30 minutes.",
    "",
    "If you did not request a reset, you can ignore this email.",
    "",
    "Thanks,",
    "The InnKeeper Team",
  ].join("\n");

  try {
    if (gmailClientId && gmailClientSecret && gmailRedirectUri && gmailRefreshToken && gmailUserEmail) {
      const oauth2Client = new google.auth.OAuth2(gmailClientId, gmailClientSecret, gmailRedirectUri);
      oauth2Client.setCredentials({ refresh_token: gmailRefreshToken });
      const gmail = google.gmail({ version: "v1", auth: oauth2Client });
      const response = await gmail.users.messages.send({
        userId: "me",
        requestBody: { raw: createGmailRawMessage({ to, from: gmailUserEmail, subject, text }) },
      });
      if (!response.data?.id) throw new Error("Gmail API returned no message ID.");
      return { success: true, messageId: response.data.id, resetUrl };
    }

    if (!resendApiKey || !emailFrom) {
      return { success: false, resetUrl, error: "Gmail and Resend email configuration are missing." };
    }

    const resend = new Resend(resendApiKey);
    const { data, error } = await resend.emails.send({ from: emailFrom, to, subject, text });
    if (error) throw new Error(error.message || "Resend email delivery failed.");
    return { success: true, messageId: data?.id, resetUrl };
  } catch (error: any) {
    if (resendApiKey && emailFrom) {
      try {
        const resend = new Resend(resendApiKey);
        const { data, error: fallbackError } = await resend.emails.send({ from: emailFrom, to, subject, text });
        if (!fallbackError) return { success: true, messageId: data?.id, resetUrl };
        throw new Error(fallbackError.message || "Resend email delivery failed.");
      } catch (error: any) {
        console.error("[Auth Service] Gmail and Resend password reset delivery failed:", error?.message || error);
        return { success: false, resetUrl, error: error?.message || "Failed to send reset email." };
      }
    }
    console.error("[Auth Service] Gmail password reset delivery failed:", error?.message || error);
    return { success: false, resetUrl, error: error?.message || "Failed to send reset email." };
  }
}

export async function registerUser(input: { email: string; password: string; name: string; phone?: string; role?: string }) {
  const normalizedEmail = input.email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    throw Object.assign(new Error("Email already registered"), { status: 409 });
  }

  if (!isStrongPassword(input.password)) {
    throw Object.assign(new Error("Password must be at least 8 characters and include uppercase letters and numbers"), { status: 400 });
  }

  const passwordHash = await bcrypt.hash(input.password, 10);
  const user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      name: input.name.trim(),
      phone: input.phone ?? null,
      password: passwordHash,
      role: normalizeRole(input.role),
    },
  });

  return buildPublicUser(toAuthUser(user));
}

export async function loginUser(input: { email: string; password: string; rememberMe?: boolean }) {
  const normalizedEmail = input.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user) {
    throw Object.assign(new Error("Invalid credentials"), { status: 401 });
  }

  const valid = await bcrypt.compare(input.password, user.password);
  if (!valid) {
    throw Object.assign(new Error("Invalid credentials"), { status: 401 });
  }

  const authUser = toAuthUser(user);
  const accessToken = jwt.sign(
    { sub: authUser.id, email: authUser.email, role: authUser.role },
    config.jwtSecret,
    { expiresIn: input.rememberMe ? "30d" : "12h" }
  );

  return {
    user: buildPublicUser(authUser),
    accessToken,
  };
}

export async function forgotPassword(input: { email: string }) {
  const normalizedEmail = input.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user) {
    return { message: "If the email exists, reset instructions were sent." };
  }

  await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });

  const resetToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 30);

  await prisma.passwordResetToken.create({
    data: {
      tokenHash,
      userId: user.id,
      expiresAt,
      used: false,
    },
  });

  await sendPasswordResetEmail({
    to: user.email,
    token: resetToken,
    name: user.name,
  });

  return { message: "If the email exists, reset instructions were sent." };
}

export async function resetPassword(input: { email?: string; token: string; password: string; confirmPassword?: string }) {
  if (input.confirmPassword !== undefined && input.password !== input.confirmPassword) {
    throw Object.assign(new Error("Passwords do not match"), { status: 400 });
  }

  const token = input.token.trim();
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const resetRecord = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!resetRecord || !resetRecord.user) {
    throw Object.assign(new Error("Invalid or expired reset token"), { status: 400 });
  }

  if (resetRecord.used || resetRecord.expiresAt < new Date()) {
    throw Object.assign(new Error("Invalid or expired reset token"), { status: 400 });
  }

  if (input.email && input.email.trim().toLowerCase() !== resetRecord.user.email.toLowerCase()) {
    throw Object.assign(new Error("Invalid or expired reset token"), { status: 400 });
  }

  if (!isStrongPassword(input.password)) {
    throw Object.assign(new Error("Password must be at least 8 characters and include uppercase letters and numbers"), { status: 400 });
  }

  const passwordHash = await bcrypt.hash(input.password, 10);
  await prisma.user.update({
    where: { id: resetRecord.user.id },
    data: { password: passwordHash },
  });

  await prisma.passwordResetToken.update({
    where: { id: resetRecord.id },
    data: { used: true },
  });

  await prisma.passwordResetToken.deleteMany({
    where: { userId: resetRecord.user.id, id: { not: resetRecord.id } },
  });

  return { message: "Password updated successfully." };
}

export async function getUserById(id: string) {
  const numericId = Number.parseInt(id, 10);
  if (Number.isNaN(numericId)) {
    return null;
  }
  const user = await prisma.user.findUnique({ where: { id: numericId } });
  return user ? buildPublicUser(toAuthUser(user)) : null;
}