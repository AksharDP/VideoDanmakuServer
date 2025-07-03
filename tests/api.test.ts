import app from "../src/index";
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import db, { closeDbConnection } from "../src/db/db";

// Helper function to get a valid token
async function getAuthToken() {
    const user = {
        email: `testuser_${Date.now()}@example.com`,
        username: `testuser_${Date.now()}`,
        password: "password123",
    };
    const signupRes = await app.request("/signup", {
        method: "POST",
        body: JSON.stringify(user),
        headers: { "Content-Type": "application/json" },
    });
    
    if (signupRes.status !== 201) {
        console.error("Signup failed:", await signupRes.text());
        throw new Error("Failed to signup user for test");
    }
    
    const loginRes = await app.request("/login", {
        method: "POST",
        body: JSON.stringify({
            emailOrUsername: user.email,
            password: user.password,
        }),
        headers: { "Content-Type": "application/json" },
    });
    
    if (loginRes.status !== 200) {
        console.error("Login failed:", await loginRes.text());
        throw new Error("Failed to login user for test");
    }
    
    const { token } = await loginRes.json();
    return token;
}

describe("VideoDanmakuServer API", () => {
    let authToken: string;

    beforeAll(async () => {
        authToken = await getAuthToken();
    });

    afterAll(async () => {
        // Don't close connection here - let other test files use it
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
        const res = await app.request("/addComment", {
            method: "POST",
            body: JSON.stringify({}),
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authToken}`,
            },
        });
        expect(res.status).toBe(400);
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
                Authorization: `Bearer ${authToken}`,
            },
        });

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.success).toBe(true);
        expect(json.comment).toBeDefined();
        expect(json.comment.content).toBe(comment.text);
    });

    test("GET /getComments - Success", async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
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
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const res = await app.request(
            "/getComments?platform=youtube&videoId=dne"
        );
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.success).toBe(true);
        expect(json.comments).toEqual([]);
    });

    test("GET /getComments - No comments", async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
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
                Authorization: `Bearer ${authToken}`,
            },
        });

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.success).toBe(true);
        expect(json.comment).toBeDefined();
        expect(json.comment.content).toBe(comment.text);
    });
});
