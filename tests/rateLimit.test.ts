import app from "../src/index";
import { describe, test, expect, afterAll, beforeAll } from "bun:test";
import { closeDbConnection } from "../src/db/db";
import db from "../src/db/db";

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

describe("Rate Limiting Tests", () => {
    let authToken: string;

    beforeAll(async () => {
        authToken = await getAuthToken();
    });

    afterAll(async () => {
        if (process.env.NODE_ENV === "test") {
            // Add a small delay before closing connections to avoid negative timeout issues
            await new Promise(resolve => setTimeout(resolve, 100));
            await closeDbConnection();
        }
    });

    test("POST /addComment - Rate limit by IP (5 second interval)", async () => {
        const comment = {
            platform: "youtube",
            videoId: "ratetest1",
            time: 10,
            text: "Rate limit test",
        };

        const res1 = await app.request("/addComment", {
            method: "POST",
            body: JSON.stringify(comment),
            headers: {
                "Content-Type": "application/json",
                "x-forwarded-for": "192.168.1.100",
                Authorization: `Bearer ${authToken}`,
            },
        });
        expect(res1.status).toBe(200);
        const json1 = await res1.json();
        expect(json1.success).toBe(true);

        const res2 = await app.request("/addComment", {
            method: "POST",
            body: JSON.stringify({ ...comment, text: "Second comment" }),
            headers: {
                "Content-Type": "application/json",
                "x-forwarded-for": "192.168.1.100",
                Authorization: `Bearer ${authToken}`,
            },
        });
        expect(res2.status).toBe(429);
        const json2 = await res2.json();
        expect(json2.success).toBe(false);
        expect(json2.type).toBe("rate_limit");
        expect(json2.error).toContain("wait");
    });

    test("POST /addComment - Rate limit by username (5 second interval)", async () => {
        await new Promise((resolve) => setTimeout(resolve, 1100));
        const comment = {
            platform: "youtube",
            videoId: "ratetest2",
            time: 10,
            text: "Rate limit test",
        };

        const res1 = await app.request("/addComment", {
            method: "POST",
            body: JSON.stringify(comment),
            headers: {
                "Content-Type": "application/json",
                "x-forwarded-for": "192.168.1.101",
                Authorization: `Bearer ${authToken}`,
            },
        });
        expect(res1.status).toBe(200);

        const res2 = await app.request("/addComment", {
            method: "POST",
            body: JSON.stringify({ ...comment, text: "Second comment" }),
            headers: {
                "Content-Type": "application/json",
                "x-forwarded-for": "192.168.1.102",
                Authorization: `Bearer ${authToken}`,
            },
        });
        expect(res2.status).toBe(429);
        const json2 = await res2.json();
        expect(json2.success).toBe(false);
        expect(json2.type).toBe("rate_limit");
    });

    test("GET /getComments - Rate limit (1 per second)", async () => {
        const queryParams =
            "platform=youtube&videoId=retrievaltest&username=retrievaluser";

        const res1 = await app.request(`/getComments?${queryParams}`, {
            headers: {
                "x-forwarded-for": "192.168.1.106",
            },
        });
        expect(res1.status).toBe(200);

        const res2 = await app.request(`/getComments?${queryParams}`, {
            headers: {
                "x-forwarded-for": "192.168.1.106",
            },
        });
        expect(res2.status).toBe(429);
        const json2 = await res2.json();
        expect(json2.success).toBe(false);
        expect(json2.type).toBe("rate_limit");
    });

    test("GET /getComments - Rate limit by username across IPs", async () => {
        const queryParams =
            "platform=youtube&videoId=retrievaltest2&username=retrievaluser2";

        const res1 = await app.request(`/getComments?${queryParams}`, {
            headers: {
                "x-forwarded-for": "192.168.1.107",
            },
        });
        expect(res1.status).toBe(200);

        const res2 = await app.request(`/getComments?${queryParams}`, {
            headers: {
                "x-forwarded-for": "192.168.1.108",
            },
        });
        expect(res2.status).toBe(429);
        const json2 = await res2.json();
        expect(json2.success).toBe(false);
        expect(json2.type).toBe("rate_limit");
    });
});