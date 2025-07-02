import app from "../src/index";
import { describe, test, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { clearDatabase, dropAndRecreateSchema } from "../src/db/db";

describe("VideoDanmakuServer API", () => {
    beforeAll(async () => {
        await dropAndRecreateSchema();
    });

    test("GET /", async () => {
        const res = await app.request("/");
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("VideoDanmakuServer is running!");
    });

    test("GET /ping", async () => {
        const res = await app.request("/ping");
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.status).toBe("ok");
        expect(typeof json.timestamp).toBe("string");
    });

    test("GET /getComments - Missing parameters", async () => {
        const res = await app.request("/getComments");
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.success).toBe(false);
        expect(json.error).toBe("Missing platform or videoId query parameters");
    });

    test("POST /addComment - Missing body", async () => {
        const res = await app.request("/addComment", {
            method: "POST",
            body: JSON.stringify({}),
            headers: {
                'Content-Type': 'application/json'
            }
        });
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.success).toBe(false);
        expect(json.error).toBe(
            "Missing required fields: platform, videoId, time, text, username"
        );
    });

    test("POST /addComment - Success", async () => {
        const comment = {
            platform: "youtube",
            videoId: "12345",
            time: 10,
            text: "This is a test comment",
            username: "testuser",
            color: "#ffffff",
            scrollMode: "slide",
            fontSize: "normal",
        };

        const res = await app.request("/addComment", {
            method: "POST",
            body: JSON.stringify(comment),
            headers: {
                "Content-Type": "application/json",
            },
        });

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.success).toBe(true);
        expect(json.comment).toBeDefined();
        expect(json.comment.content).toBe(comment.text);
    });

    test("GET /getComments - Success", async () => {
        // First add a comment
        const comment = {
            platform: "youtube",
            videoId: "12345",
            time: 15,
            text: "Test comment for retrieval",
            username: "testuser2",
            color: "#ff0000",
            scrollMode: "top",
            fontSize: "large",
        };

        await app.request("/addComment", {
            method: "POST",
            body: JSON.stringify(comment),
            headers: {
                "Content-Type": "application/json",
            },
        });

        // Then get the comments
        const res = await app.request(
            "/getComments?platform=youtube&videoId=12345"
        );
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.success).toBe(true);
        expect(Array.isArray(json.comments)).toBe(true);
        expect(json.comments.length).toBeGreaterThan(0);
    });

    test("GET /getComments - Video not found", async () => {
        const res = await app.request(
            "/getComments?platform=youtube&videoId=dne"
        );
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.success).toBe(true);
        expect(json.comments).toEqual([]);
    });

    test("GET /getComments - No comments", async () => {
        const res = await app.request(
            "/getComments?platform=youtube&videoId=no_comments"
        );
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.success).toBe(true);
        expect(json.comments).toEqual([]);
    });

    test("POST /addComment - Same user, different platform", async () => {
        const comment = {
            platform: "vimeo",
            videoId: "54321",
            time: 20,
            text: "Another test comment",
            username: "testuser",
            color: "#000000",
            scrollMode: "top",
            fontSize: "large",
        };

        const res = await app.request("/addComment", {
            method: "POST",
            body: JSON.stringify(comment),
            headers: {
                "Content-Type": "application/json",
            },
        });

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.success).toBe(true);
        expect(json.comment).toBeDefined();
        expect(json.comment.content).toBe(comment.text);
    });
});
