import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
    validateOrInitDatabase,
    getComments,
    addComment,
    reportComment,
    likeComment,
    removeLike,
    getCommentLikes,
    deleteComment,
} from "./db/db";
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
        return c.json(result.res, result.status as any);
    } catch (error) {
        console.error("Error signing up:", error);
        return c.json({ error: "Missing or invalid parameters" }, 400);
    }
});

app.get("/login", (c) => {
    return c.json({
        message: "Login endpoint - use POST method",
        methods: ["POST"],
        schema: {
            emailOrUsername: "string",
            password: "string",
            rememberMe: "boolean (optional)"
        }
    });
});

app.post("/login", zValidator("json", loginSchema), async (c) => {
    try {
        const body = c.req.valid("json");
        const clientIP = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
        const identifier = body.emailOrUsername.toLowerCase();

        const ipRateLimitCheck = await rateLimiter.checkAuthRateLimit(clientIP);
        if (!ipRateLimitCheck.allowed) {
            return c.json({ error: ipRateLimitCheck.error, type: "rate_limit" }, 429);
        }
        const identifierRateLimitCheck = await rateLimiter.checkAuthRateLimit(identifier);
        if (!identifierRateLimitCheck.allowed) {
            return c.json({ error: identifierRateLimitCheck.error, type: "rate_limit" }, 429);
        }

        const result = await loginUser(body);

        if (result.status !== 200) {
            await rateLimiter.recordFailedLogin(clientIP);
            await rateLimiter.recordFailedLogin(identifier);
        } else {
            await rateLimiter.resetLoginAttempts(clientIP);
            await rateLimiter.resetLoginAttempts(identifier);
        }

        return c.json(result.res, result.status as any);
    } catch (error) {
        console.error("Error logging in:", error);
        return c.json({ error: "Missing or invalid parameters" }, 400);
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
        const { platform, videoId, username, limit, bucketSize, maxCommentsPerBucket } = c.req.query();

        if (!platform || !videoId) {
            return c.json(
                {
                    success: false,
                    error: "Missing platform or videoId query parameters",
                },
                400
            );
        }

        const sanitizedUsername = username
            ? sanitizeHtml(username, { allowedTags: [], allowedAttributes: {} })
            : undefined;

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

        const sanitizedPlatform = sanitizeHtml(platform, {
            allowedTags: [],
            allowedAttributes: {},
        });
        const sanitizedVideoId = sanitizeHtml(videoId, {
            allowedTags: [],
            allowedAttributes: {},
        });

        // Parse and validate new parameters with defaults
        const totalLimit = limit ? parseInt(limit, 10) : 1000;
        const bSize = bucketSize ? parseInt(bucketSize, 10) : 5;
        const maxPerBucket = maxCommentsPerBucket ? parseInt(maxCommentsPerBucket, 10) : 25;

        const result = await getComments(sanitizedPlatform, sanitizedVideoId, totalLimit, bSize, maxPerBucket);

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
        const authHeader = c.req.header("Authorization");
        const authToken = authHeader?.substring(7); // Remove "Bearer " prefix
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
            authToken!,
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

app.post("/reportComment", authMiddleware, async (c) => {
    try {
        const user = c.get("user");
        const authHeader = c.req.header("Authorization");
        const authToken = authHeader?.substring(7); // Remove "Bearer " prefix
        const { commentId, reason, additionalDetails } = await c.req.json();

        if (!commentId || !reason) {
            return c.json(
                { success: false, error: "Missing commentId or reason" },
                400
            );
        }

        const result = await reportComment(
            commentId,
            authToken!,
            reason,
            additionalDetails
        );

        if (!result.success) {
            return c.json(result, 400);
        }

        return c.json(result);
    } catch (error) {
        console.error("Error reporting comment:", error);
        return c.json(
            { success: false, error: "Failed to report comment" },
            500
        );
    }
});

app.post("/likeComment", authMiddleware, async (c) => {
    try {
        const user = c.get("user");
        const authHeader = c.req.header("Authorization");
        const authToken = authHeader?.substring(7); // Remove "Bearer " prefix
        const { commentId, isLike } = await c.req.json();

        if (commentId === undefined || isLike === undefined) {
            return c.json(
                { success: false, error: "Missing commentId or isLike" },
                400
            );
        }

        if (typeof isLike !== "boolean") {
            return c.json(
                { success: false, error: "isLike must be a boolean" },
                400
            );
        }

        const result = await likeComment(commentId, authToken!, isLike);

        if (!result.success) {
            return c.json(result, 400);
        }

        return c.json(result);
    } catch (error) {
        console.error("Error liking comment:", error);
        return c.json(
            { success: false, error: "Failed to like comment" },
            500
        );
    }
});

app.post("/removeLike", authMiddleware, async (c) => {
    try {
        const user = c.get("user");
        const authHeader = c.req.header("Authorization");
        const authToken = authHeader?.substring(7); // Remove "Bearer " prefix
        const { commentId } = await c.req.json();

        if (!commentId) {
            return c.json(
                { success: false, error: "Missing commentId" },
                400
            );
        }

        const result = await removeLike(commentId, authToken!);

        if (!result.success) {
            return c.json(result, 400);
        }

        return c.json(result);
    } catch (error) {
        console.error("Error removing like:", error);
        return c.json(
            { success: false, error: "Failed to remove like" },
            500
        );
    }
});

app.post("/deleteComment", authMiddleware, async (c) => {
    try {
        const user = c.get("user");
        const authHeader = c.req.header("Authorization");
        const authToken = authHeader?.substring(7); // Remove "Bearer " prefix
        const { commentId } = await c.req.json();

        if (!commentId) {
            return c.json(
                { success: false, error: "Missing commentId" },
                400
            );
        }

        const result = await deleteComment(commentId, authToken!);

        if (!result.success) {
            return c.json(result, 400);
        }

        return c.json(result);
    } catch (error) {
        console.error("Error deleting comment:", error);
        return c.json(
            { success: false, error: "Failed to delete comment" },
            500
        );
    }
});

app.get("/commentLikes/:commentId", async (c) => {
    try {
        const commentId = parseInt(c.req.param("commentId"), 10);

        if (isNaN(commentId)) {
            return c.json(
                { success: false, error: "Invalid commentId" },
                400
            );
        }

        const result = await getCommentLikes(commentId);

        if (!result.success) {
            return c.json(result, 400);
        }

        return c.json(result);
    } catch (error) {
        console.error("Error getting comment likes:", error);
        return c.json(
            { success: false, error: "Failed to get comment likes" },
            500
        );
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
