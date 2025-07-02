import { Hono } from "hono";
import { validateOrInitDatabase, getComments, addComment } from "./db/db";
import { rateLimiter } from "./rateLimit";
import packageJson from "../package.json";



const app = new Hono();

app.get("/", (c) => {
    // return c.text("VideoDanmakuServer is running!");
    return c.json({
        message: "VideoDanmakuServer is running!",
        version: packageJson.version,
    });
});

app.get("/ping", (c) => {
    return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/rateLimit/status", async (c) => {
    try {
        const { ip, username } = c.req.query();
        const status = rateLimiter.getStatus(ip, username);
        return c.json({
            success: true,
            data: status,
        });
    } catch (error) {
        console.error("Error getting rate limit status:", error);
        return c.json(
            { success: false, error: "Failed to get rate limit status" },
            500
        );
    }
});

app.get("/getComments", async (c) => {
    try {
        const { platform, videoId, username } = c.req.query();

        if (!platform || !videoId) {
            return c.json(
                {
                    success: false,
                    error: "Missing platform or videoId query parameters",
                },
                400
            );
        }

        const clientIP =
            c.req.header("x-forwarded-for") ||
            c.req.header("x-real-ip") ||
            "unknown";

        const rateLimitCheck = await rateLimiter.checkRetrievalRateLimit(
            clientIP,
            username
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

        const result = await getComments(platform, videoId);

        if (result.success) {
            await rateLimiter.recordRetrieval(clientIP, username);
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

app.post("/addComment", async (c) => {
    try {
        const {
            platform,
            videoId,
            time,
            text,
            username,
            color,
            scrollMode,
            fontSize,
        } = await c.req.json();

        if (!platform || !videoId || time === undefined || !text || !username) {
            return c.json(
                {
                    success: false,
                    error: "Missing required fields: platform, videoId, time, text, username",
                },
                400
            );
        }

        const clientIP =
            c.req.header("x-forwarded-for") ||
            c.req.header("x-real-ip") ||
            "unknown";

        const rateLimitCheck = await rateLimiter.checkRateLimit(
            clientIP,
            username
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
            platform,
            videoId,
            Number(time),
            text,
            color || "#ffffff",
            username,
            scrollMode || "slide",
            fontSize || "normal"
        );

        if (result.success) {
            await rateLimiter.recordComment(clientIP, username);
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
