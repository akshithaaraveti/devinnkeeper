import { prisma } from '../utils/db.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { z } from 'zod';
import { sendPasswordResetEmail } from '../utils/email.js';
import { normalizeRoleName } from '../services/rbacService.js';
import { verifyJwtToken } from '../middleware/authMiddleware.js';

const JWT_SECRET = process.env.JWT_SECRET || 'innkeeper-super-secret-key-change-in-production';
const JWT_EXPIRES_IN = '7d';

const COOKIE_NAME = 'innkeeper_session';
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'strict',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  secure: process.env.NODE_ENV === 'production',
};

export function normalizeRole(role) {
  return normalizeRoleName(role).toLowerCase();
}

function normalizeUser(user) {
  if (!user) return null;

  return {
    id: String(user.id),
    name: user.name,
    email: user.email,
    role: user.role,
    permissions: [],
    createdAt: user.created_at ?? user.createdAt,
    updatedAt: user.updated_at ?? user.updatedAt,
  };
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: normalizeRole(user.role) },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

export async function signup(req, res) {
  try {
    const { name, phone, password, confirmPassword, role } = req.body;
    const email = String(req.body?.email || '').trim().toLowerCase();

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match.' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const hashed = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        phone: phone || null,
        password: hashed,
        role: normalizeRole(role || 'receptionist'),
      },
    });

    const token = generateToken(user);
    res.cookie(COOKIE_NAME, token, COOKIE_OPTS);

    return res.status(201).json({
      message: 'Account created successfully.',
      token,
      user: {
        id: String(user.id),
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      },
    });
  } catch (err) {
    console.error('Signup error:', err);
    return res.status(500).json({ error: 'Internal server error during signup.' });
  }
}

export async function login(req, res) {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.password) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = generateToken(user);
    res.cookie(COOKIE_NAME, token, COOKIE_OPTS);

    return res.status(200).json({
      message: 'Login successful.',
      token,
      user: normalizeUser(user),
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({
      error: err?.message || 'Internal server error during login.',
    });
  }
}

export async function me(req, res) {
  try {
    // Accept token from Authorization header OR cookie
    const authHeader = req.headers.authorization;
    let token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token && req.cookies?.[COOKIE_NAME]) {
      token = req.cookies[COOKIE_NAME];
    }
    if (!token) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }

    const payload = verifyJwtToken(token);

    const user = await prisma.user.findUnique({ where: { id: Number(payload.id) } });
    if (!user) {
      return res.status(401).json({ error: 'User not found.' });
    }

    return res.status(200).json({
      user: {
        id: String(user.id),
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      },
    });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

export async function logout(req, res) {
  res.clearCookie(COOKIE_NAME);
  return res.status(200).json({ message: 'Logged out successfully.' });
}

function getZodErrorMessage(error) {
  return error.issues?.[0]?.message || error.errors?.[0]?.message || error.message || 'Validation error.';
}

const forgotPasswordSchema = z.object({
  email: z
    .string({ required_error: 'Email address is required.' })
    .trim()
    .toLowerCase()
    .email({ message: 'Please provide a valid email address.' }),
});

const resetPasswordSchema = z
  .object({
    token: z
      .string({ required_error: 'Reset token is required.' })
      .trim()
      .min(1, { message: 'Reset token is required.' }),
    password: z
      .string({ required_error: 'New password is required.' })
      .min(8, { message: 'Password must be at least 8 characters long.' })
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])[A-Za-z\d!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]{8,}$/,
        {
          message:
            'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character.',
        }
      ),
    confirmPassword: z.string({ required_error: 'Please confirm your password.' }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export async function forgotPassword(req, res) {
  try {
    console.log('[Auth] Password reset requested');
    const parseResult = forgotPasswordSchema.safeParse(req.body);
    if (!parseResult.success) {
      const errorMsg = getZodErrorMessage(parseResult.error);
      return res.status(400).json({ success: false, error: errorMsg, message: errorMsg });
    }

    const { email } = parseResult.data;

    // Search existing User table by normalized email
    const user = await prisma.user.findUnique({ where: { email } });

    if (user) {
      console.log('[Auth] User found');
      // Invalidate any previous active reset tokens for this user
      await prisma.passwordResetToken.deleteMany({
        where: { userId: user.id },
      });

      // Generate cryptographically secure random token
      const rawToken = crypto.randomBytes(32).toString('hex');
      console.log('[Auth] Reset token generated');

      // Store only SHA-256 hash of the token in the database
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

      // Set expiration to 30 minutes
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

      await prisma.passwordResetToken.create({
        data: {
          tokenHash,
          userId: user.id,
          expiresAt,
          used: false,
        },
      });

      console.log(`[Auth] Attempting to send password reset email`);
      try {
        // Send password reset email containing the raw token link directly to user's registered email.
        // Keep the endpoint generic and successful even if email delivery is temporarily misconfigured.
        const emailResult = await sendPasswordResetEmail({
          to: user.email,
          name: user.name,
          token: rawToken,
        });

        if (emailResult.success) {
          console.log('[Auth] Password reset email sent successfully');
        } else {
          console.error(`[Auth] Email Dispatch Error: ${emailResult.error}`);
        }
      } catch (emailError) {
        console.error('[Auth] Password reset email dispatch threw:', emailError?.message || emailError);
      }
    }

    // Always return generic success response to prevent account enumeration and expose clean UX
    return res.status(200).json({
      success: true,
      message: 'If an account exists for this email, a password reset link has been sent.',
    });
  } catch (err) {
    console.error('Forgot password error:', err);
    return res.status(500).json({
      success: false,
      error: 'Internal server error.',
      message: 'Internal server error processing password reset request.',
    });
  }
}

export async function resetPassword(req, res) {
  try {
    const parseResult = resetPasswordSchema.safeParse(req.body);
    if (!parseResult.success) {
      const errorMsg = getZodErrorMessage(parseResult.error);
      return res.status(400).json({ success: false, error: errorMsg, message: errorMsg });
    }

    const { token, password } = parseResult.data;

    // Hash incoming raw token to find matching database record
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const resetRecord = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    const now = new Date();
    if (!resetRecord || !resetRecord.user) {
      return res.status(400).json({
        success: false,
        error: 'This password reset link is invalid or has expired.',
        message: 'This password reset link is invalid or has expired.',
      });
    }

    if (resetRecord.used || new Date(resetRecord.expiresAt) < now) {
      return res.status(400).json({
        success: false,
        error: 'This password reset link is invalid or has expired. Please request a new one.',
        message: 'This password reset link is invalid or has expired. Please request a new one.',
      });
    }

    // Hash the new password using the exact same password hashing algorithm (bcryptjs with 12 salt rounds)
    const hashedPassword = await bcrypt.hash(password, 12);

    // Update the user's password in PostgreSQL
    await prisma.user.update({
      where: { id: resetRecord.userId },
      data: { password: hashedPassword },
    });

    // Mark the token as used so it cannot be reused
    await prisma.passwordResetToken.update({
      where: { id: resetRecord.id },
      data: { used: true },
    });

    // Invalidate/remove any other remaining active tokens for this user
    await prisma.passwordResetToken.deleteMany({
      where: {
        userId: resetRecord.userId,
        id: { not: resetRecord.id },
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Password reset successfully.',
    });
  } catch (err) {
    console.error('Reset password error:', err);
    return res.status(500).json({
      success: false,
      error: 'Internal server error.',
      message: 'Internal server error during password reset.',
    });
  }
}

export async function listStaff(req, res) {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, name: true, email: true, phone: true, role: true, created_at: true, updated_at: true },
      orderBy: { id: 'asc' },
    });
    return res.json(users.map((user) => ({ ...user, role: normalizeRole(user.role), createdAt: user.created_at, updatedAt: user.updated_at })));
  } catch (err) {
    console.error('listStaff error:', err);
    return res.status(500).json({ error: 'Failed to retrieve staff list.' });
  }
}

export async function createStaff(req, res) {
  try {
    const { name, email, phone, password, role } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, and password are required.' });
    const normalizedEmail = String(email).trim().toLowerCase();
    if (await prisma.user.findUnique({ where: { email: normalizedEmail } })) {
      return res.status(409).json({ error: 'A staff member with this email already exists.' });
    }
    const assignedRole = normalizeRole(role || 'receptionist');
    if (assignedRole === 'admin' && normalizeRole(req.user?.role) !== 'admin') {
      return res.status(403).json({ message: 'You do not have permission to perform this action' });
    }
    const user = await prisma.user.create({
      data: { name: String(name).trim(), email: normalizedEmail, phone: phone || null, password: await bcrypt.hash(password, 12), role: assignedRole },
      select: { id: true, name: true, email: true, phone: true, role: true, created_at: true },
    });
    return res.status(201).json({ ...user, role: normalizeRole(user.role), createdAt: user.created_at });
  } catch (err) {
    console.error('createStaff error:', err);
    return res.status(500).json({ error: 'Failed to create staff member.' });
  }
}

export async function updateStaff(req, res) {
  try {
    const staffId = Number(req.params.id);
    const { name, email, phone, role, password } = req.body;
    if (role && Number(req.user?.id) === staffId) return res.status(400).json({ message: 'Users cannot modify their own role' });
    if (role && normalizeRole(req.user?.role) !== 'admin') return res.status(403).json({ message: 'You do not have permission to perform this action' });
    const data = {};
    if (name) data.name = String(name).trim();
    if (email) data.email = String(email).trim().toLowerCase();
    if (phone !== undefined) data.phone = phone;
    if (role) data.role = normalizeRole(role);
    if (password) data.password = await bcrypt.hash(password, 12);
    const user = await prisma.user.update({ where: { id: staffId }, data, select: { id: true, name: true, email: true, phone: true, role: true, created_at: true, updated_at: true } });
    return res.json({ ...user, role: normalizeRole(user.role), createdAt: user.created_at, updatedAt: user.updated_at });
  } catch (err) {
    console.error('updateStaff error:', err);
    return res.status(500).json({ error: 'Failed to update staff member.' });
  }
}

export async function deleteStaff(req, res) {
  try {
    const staffId = Number(req.params.id);
    if (Number(req.user?.id) === staffId) return res.status(400).json({ error: 'Cannot delete your own account.' });
    await prisma.user.delete({ where: { id: staffId } });
    return res.json({ success: true, message: 'Staff member deleted.' });
  } catch (err) {
    console.error('deleteStaff error:', err);
    return res.status(500).json({ error: 'Failed to delete staff member.' });
  }
}

