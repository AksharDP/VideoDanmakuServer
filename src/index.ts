import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { validateOrInitDatabase, getComments, addComment } from "./db/db";
import { rateLimiter } from "./rateLimit";
import packageJson from "../package.json";
import {
    signupUser,
    loginUser,
    forgotPassword,
    authMiddleware,
    signupSchema,
    loginSchema,
} from "./auth/auth";
import sanitizeHtml from "sanitize-html";
import { cors as honoCors } from 'hono/cors';

const app = new Hono();

app.use('/*', honoCors({
    origin: [
        'https://www.youtube.com',
        'https://youtube.com'
    ],
    allowMethods: ['GET', 'POST'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Forwarded-For', 'X-Real-IP'],
    credentials: true,
    exposeHeaders: ['Content-Length', 'X-Request-ID'],
}));

app.post("/signup", zValidator("json", signupSchema), async (c) => {
    try {
        const body = c.req.valid("json");
        const result = await signupUser(body);
        return c.json(result, result.status as any);
    } catch (error) {
        console.error("Error signing up:", error);
        return c.json({ error: "Missing or invalid parameters" }, 400);
    }
});

app.post("/login", zValidator("json", loginSchema), async (c) => {
    try {
        const body = c.req.valid("json");
        const result = await loginUser(body);
        return c.json(result, result.status as any);
    } catch (error) {
        console.error("Error logging in:", error);
        return c.json({ error: "Missing or invalid parameters" }, 400);
    }
});

app.post("/forgot-password", async (c) => {
    try {
        const result = await forgotPassword();
        return c.json(result);
    } catch (error) {
        console.error("Error processing forgot password request:", error);
        return c.json({ error: "Failed to process request" }, 500);
    }
});


app.get("/", (c) => {
    return c.json({
        message: "VideoDanmakuServer is running!",
        version: packageJson.version,
    });
});

app.get("/ping", (c) => {
    return c.json({ status: "ok", timestamp: new Date().toISOString() });
});


app.get("/getComments", async (c) => {
    try {
        const { platform, videoId, username, numOfComments } = c.req.query();

        if (!platform || !videoId) {
            return c.json(
                {
                    success: false,
                    error: "Missing platform or videoId query parameters",
                },
                400
            );
        }

        const sanitizedPlatform = sanitizeHtml(platform, {
            allowedTags: [],
            allowedAttributes: {},
        });
        const sanitizedVideoId = sanitizeHtml(videoId, {
            allowedTags: [],
            allowedAttributes: {},
        });
        const sanitizedUsername = username
            ? sanitizeHtml(username, { allowedTags: [], allowedAttributes: {} })
            : undefined;

        // Parse numOfComments, default to 1000 if not provided or invalid
        let limit = 1000;
        if (numOfComments !== undefined) {
            const parsed = parseInt(numOfComments, 10);
            if (!isNaN(parsed) && parsed > 0) {
                limit = parsed;
            }
        }

        const clientIP =
            c.req.header("x-forwarded-for") ||
            c.req.header("x-real-ip") ||
            "unknown";

        const rateLimitCheck = await rateLimiter.checkRetrievalRateLimit(
            clientIP,
            sanitizedUsername
        );
        if (!rateLimitCheck.allowed) {
            return c.json(
                {
                    success: false,
                    error: rateLimitCheck.error,
                    type: "rate_limit",
                },
                429
            );
        }

        const result = await getComments(sanitizedPlatform, sanitizedVideoId, limit);

        if (result.success) {
            await rateLimiter.recordRetrieval(clientIP, sanitizedUsername);
        }

        return c.json(result);
    } catch (error) {
        console.error("Error fetching comments:", error);
        return c.json(
            { success: false, error: "Failed to fetch comments" },
            500
        );
    }
});

app.post("/addComment", authMiddleware, async (c) => {
    try {
        const user = c.get("user");
        const { platform, videoId, time, text, color, scrollMode, fontSize } =
            await c.req.json();

        if (!platform || !videoId || time === undefined || !text) {
            return c.json(
                {
                    success: false,
                    error: "Missing required fields: platform, videoId, time, text",
                },
                400
            );
        }

        const sanitizedPlatform = sanitizeHtml(platform, {
            allowedTags: [],
            allowedAttributes: {},
        });
        const sanitizedVideoId = sanitizeHtml(videoId, {
            allowedTags: [],
            allowedAttributes: {},
        });
        const sanitizedText = sanitizeHtml(text);
        const sanitizedColor = color
            ? sanitizeHtml(color, { allowedTags: [], allowedAttributes: {} })
            : "#ffffff";
        const sanitizedScrollMode = scrollMode
            ? sanitizeHtml(scrollMode, {
                  allowedTags: [],
                  allowedAttributes: {},
              })
            : "slide";
        const sanitizedFontSize = fontSize
            ? sanitizeHtml(fontSize, { allowedTags: [], allowedAttributes: {} })
            : "normal";

        const clientIP =
            c.req.header("x-forwarded-for") ||
            c.req.header("x-real-ip") ||
            "unknown";

        const rateLimitCheck = await rateLimiter.checkRateLimit(
            clientIP,
            user.username
        );
        if (!rateLimitCheck.allowed) {
            return c.json(
                {
                    success: false,
                    error: rateLimitCheck.error,
                    type: "rate_limit",
                },
                429
            );
        }

        const result = await addComment(
            sanitizedPlatform,
            sanitizedVideoId,
            Number(time),
            sanitizedText,
            sanitizedColor,
            user.id,
            sanitizedScrollMode as any,
            sanitizedFontSize as any
        );

        if (result.success) {
            await rateLimiter.recordComment(clientIP, user.username);
        }

        return c.json(result);
    } catch (error) {
        console.error("Error adding comment:", error);
        return c.json({ success: false, error: "Failed to add comment" }, 500);
    }
});

if (process.env.NODE_ENV !== "test") {
    validateOrInitDatabase();
}

function parsePort() {
    const args = process.argv.slice(2);
    let port = process.env.PORT || 3000;

    for (let i = 0; i < args.length; i++) {
        if ((args[i] === "--port" || args[i] === "-P") && args[i + 1]) {
            port = parseInt(args[i + 1], 10);
            if (isNaN(port)) {
                console.error("Invalid port number provided");
                process.exit(1);
            }
            break;
        }
    }

    return port;
}

const port = parsePort();

let serverExport: any;

if (process.env.NODE_ENV === "test") {
    serverExport = app;
} else {
    serverExport = {
        port,
        fetch: app.fetch,
    };
}

export default serverExport;

