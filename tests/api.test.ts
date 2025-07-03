import app from "../src/index";
import { describe, test, expect, beforeAll, afterAll, afterEach } from "bun:test";
import db, { closeDbConnection } from "../src/db/db";
import { 
    cleanupDatabase, 
    createTestUserWithToken, 
    createTestComment,
    resetRateLimiter,
    TestUser,
    addCreatedComment,
    addCreatedVideo
} from "./testUtils";

describe("VideoDanmakuServer API", () => {
    afterEach(async () => {
        // Clean up after each test to ensure isolation
        await cleanupDatabase();
    });

    afterAll(async () => {
        // Final cleanup (mainly resets rate limiter)
        await cleanupDatabase();
    });

    test("GET /", async () => {
        const res = await app.request("/");
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.message).toBe("VideoDanmakuServer is running!");
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
        const { token } = await createTestUserWithToken();
        
        const res = await app.request("/addComment", {
            method: "POST",
            body: JSON.stringify({}),
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
        });
        expect(res.status).toBe(400);
    });

    test("POST /addComment - Success", async () => {
        const { token } = await createTestUserWithToken();
        
        const comment = {
            platform: "youtube",
            videoId: `test_success_${Date.now()}_${Math.random().toString(36).substring(7)}`,
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
                Authorization: `Bearer ${token}`,
            },
        });

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.success).toBe(true);
        expect(json.comment).toBeDefined();
        expect(json.comment.content).toBe(comment.text);
        
        // Track created records for cleanup
        if (json.comment) {
            addCreatedComment(json.comment.id);
            addCreatedVideo(comment.platform, comment.videoId);
        }
    });

    test("GET /getComments - Success", async () => {
        // Reset rate limiter to ensure this test has clean state
        await resetRateLimiter();
        
        const { token } = await createTestUserWithToken();
        
        // Create a comment to have something to retrieve
        const comment = {
            platform: "youtube",
            videoId: "test_success_12345",
            time: 10,
            text: "This is a test comment for success test",
            color: "#ffffff",
            scrollMode: "slide",
            fontSize: "normal",
        };

        const addRes = await app.request("/addComment", {
            method: "POST",
            body: JSON.stringify(comment),
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
        });
        
        expect(addRes.status).toBe(200);
        
        // Track created records for cleanup
        const addJson = await addRes.json();
        if (addJson.comment) {
            addCreatedComment(addJson.comment.id);
            addCreatedVideo(comment.platform, comment.videoId);
        }

        // Wait to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 1000));
        
        const res = await app.request(
            `/getComments?platform=${comment.platform}&videoId=${comment.videoId}`
        );
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.success).toBe(true);
        expect(Array.isArray(json.comments)).toBe(true);
        expect(json.comments.length).toBeGreaterThan(0);
        expect(json.comments[0].content).toBe(comment.text);
    });

    test("GET /getComments - Video not found", async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const uniqueVideoId = `dne_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        const res = await app.request(
            `/getComments?platform=youtube&videoId=${uniqueVideoId}`
        );
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.success).toBe(true);
        expect(json.comments).toEqual([]);
    });

    test("GET /getComments - No comments", async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const uniqueVideoId = `no_comments_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        const res = await app.request(
            `/getComments?platform=youtube&videoId=${uniqueVideoId}`
        );
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.success).toBe(true);
        expect(json.comments).toEqual([]);
    });

    test("POST /addComment - Same user, different platform", async () => {
        const { token } = await createTestUserWithToken();
        
        const comment = {
            platform: "vimeo",
            videoId: `test_vimeo_${Date.now()}_${Math.random().toString(36).substring(7)}`,
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
                Authorization: `Bearer ${token}`,
            },
        });

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.success).toBe(true);
        expect(json.comment).toBeDefined();
        expect(json.comment.content).toBe(comment.text);
        
        // Track created records for cleanup
        if (json.comment) {
            addCreatedComment(json.comment.id);
            addCreatedVideo(comment.platform, comment.videoId);
        }
    });
});
