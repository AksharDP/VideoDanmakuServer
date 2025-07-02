import { z } from "zod";
import { sign, verify } from "hono/jwt";
import bcrypt from "bcrypt";
import db from "../db/db";
import { users, authTokens } from "../db/schema";
import { eq, or, and } from "drizzle-orm";
import type { Context, Next } from "hono";
import sanitizeHtml from "sanitize-html";

const saltRounds = 10;
const secret = process.env.JWT_SECRET || '';

if (!secret) {
    throw new Error("JWT_SECRET environment variable is not set");
}

export const signupSchema = z.object({
    email: z.string().email(),
    username: z.string().min(3).max(32),
    password: z.string().min(8),
});

export const loginSchema = z.object({
    emailOrUsername: z.string(),
    password: z.string(),
    rememberMe: z.boolean().optional(),
});

export async function signupUser(body: z.infer<typeof signupSchema>) {
    const { email, username, password } = body;

    const sanitizedUsername = sanitizeHtml(username, {
        allowedTags: [],
        allowedAttributes: {},
    });

    const sanitizedEmail = sanitizeHtml(email, {
        allowedTags: [],
        allowedAttributes: {},
    });

    const existingUser = await db
        .select()
        .from(users)
        .where(
            or(
                eq(users.email, sanitizedEmail),
                eq(users.username, sanitizedUsername)
            )
        )
        .limit(1);

    if (existingUser.length > 0) {
        return { error: "User already exists", status: 409 };
    }

    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const newUser = await db
        .insert(users)
        .values({
            email: sanitizedEmail,
            username: sanitizedUsername,
            password: hashedPassword,
        })
        .returning();

    return {
        message: "User created successfully",
        user: newUser[0],
        status: 201,
    };
}

export async function loginUser(body: z.infer<typeof loginSchema>) {
    const { emailOrUsername, password, rememberMe } = body;

    const sanitizedEmailOrUsername = sanitizeHtml(emailOrUsername, {
        allowedTags: [],
        allowedAttributes: {},
    });

    const user = await db
        .select()
        .from(users)
        .where(
            or(
                eq(users.email, sanitizedEmailOrUsername),
                eq(users.username, sanitizedEmailOrUsername)
            )
        )
        .limit(1);

    if (user.length === 0) {
        return { error: "Invalid credentials", status: 401 };
    }

    const validPassword = await bcrypt.compare(password, user[0].password);

    if (!validPassword) {
        return { error: "Invalid credentials", status: 401 };
    }

    const payload = {
        sub: user[0].id,
        iat: Math.floor(Date.now() / 1000),
        ...(!rememberMe && {
            exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
        }),
    };

    const token = await sign(payload, secret);

    await db.insert(authTokens).values({
        userId: user[0].id,
        token,
        expiresAt: payload.exp ? new Date(payload.exp * 1000) : null,
    });

    return { token, status: 200 };
}

export async function forgotPassword() {
    return { message: "Forgot password endpoint" };
}

export async function authMiddleware(c: Context, next: Next) {
    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return c.json({ error: "Unauthorized" }, 401);
    }

    const token = authHeader.substring(7);

    try {
        const decodedPayload = await verify(token, secret);
        if (!decodedPayload || !decodedPayload.sub) {
            return c.json({ error: "Invalid token" }, 401);
        }

        if (decodedPayload.exp && Date.now() / 1000 > decodedPayload.exp) {
            return c.json({ error: "Token expired" }, 401);
        }

        const tokenRecord = await db.query.authTokens.findFirst({
            where: and(
                eq(authTokens.token, token),
                eq(authTokens.userId, Number(decodedPayload.sub))
            ),
        });

        if (!tokenRecord) {
            return c.json({ error: "Invalid token" }, 401);
        }

        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        if (tokenRecord.lastUsedAt < sixMonthsAgo) {
            await db
                .delete(authTokens)
                .where(eq(authTokens.id, tokenRecord.id));
            return c.json({ error: "Token expired due to inactivity" }, 401);
        }

        await db
            .update(authTokens)
            .set({ lastUsedAt: new Date() })
            .where(eq(authTokens.id, tokenRecord.id));

        const user = await db.query.users.findFirst({
            where: eq(users.id, Number(decodedPayload.sub)),
        });

        if (!user) {
            return c.json({ error: "User not found" }, 401);
        }

        c.set("user", user);
    } catch (error) {
        return c.json({ error: "Invalid token" }, 401);
    }

    await next();
}
