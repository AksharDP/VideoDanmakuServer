import { Hono } from "hono";
import { validateOrInitDatabase, getComments, addComment } from "./db/db";

const app = new Hono();

app.get("/", (c) => {
    return c.text("VideoDanmakuServer is running!");
});

app.get("/ping", (c) => {
    return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/getComments", async (c) => {
    try {
        const { platform, videoId } = c.req.query();

        if (!platform || !videoId) {
            return c.json(
                {
                    success: false,
                    error: "Missing platform or videoId query parameters",
                },
                400
            );
        }

        const result = await getComments(platform, videoId);
        return c.json(result);
    } catch (error) {
        console.error("Error fetching comments:", error);
        return c.json(
            { success: false, error: "Failed to fetch comments" },
            500
        );
    }
});

// Route to add a comment to a video
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
        return c.json(result);
    } catch (error) {
        console.error("Error adding comment:", error);
        return c.json({ success: false, error: "Failed to add comment" }, 500);
    }
});

if (process.env.NODE_ENV !== 'test') {
    validateOrInitDatabase();
}

// Parse command line arguments for port
function parsePort() {
    const args = process.argv.slice(2);
    let port = process.env.PORT || 3000;
    
    for (let i = 0; i < args.length; i++) {
        if ((args[i] === '--port' || args[i] === '-P') && args[i + 1]) {
            port = parseInt(args[i + 1], 10);
            if (isNaN(port)) {
                console.error('Invalid port number provided');
                process.exit(1);
            }
            break;
        }
    }
    
    return port;
}

// Start the server with configurable port
const port = parsePort();

// Determine what to export and handle server startup
let serverExport: any;

if (process.env.NODE_ENV === 'production') {
    // Production mode - start the server directly
    console.log(`🚀 Production server starting on port ${port}`);
    
    Bun.serve({
        port: port,
        hostname: "0.0.0.0",
        fetch: app.fetch,
    });
    
    console.log(`✅ Production server running on http://0.0.0.0:${port} (accessible from internet)`);
    
    // Export nothing to prevent Bun from starting another server
    serverExport = {};
} else if (process.env.NODE_ENV === 'test') {
    // Test mode - export the app directly
    serverExport = app;
} else {
    // Development mode
    console.log(`🚀 Development server running on http://localhost:${port}`);
    serverExport = {
        port: port,
        fetch: app.fetch,
    };
}

export default serverExport;