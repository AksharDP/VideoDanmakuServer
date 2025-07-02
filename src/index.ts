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

export default app;