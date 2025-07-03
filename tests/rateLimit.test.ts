import app from "../src/index";
import { describe, test, expect, afterAll, beforeAll, afterEach } from "bun:test";
import { closeDbConnection } from "../src/db/db";
import db from "../src/db/db";
import { 
    cleanupDatabase, 
    createTestUserWithToken, 
    createTestComment,
    TestUser 
} from "./testUtils";

describe("Rate Limiting Tests", () => {
    // Only cleanup at the end to avoid database connection issues
    afterAll(async () => {
        await cleanupDatabase();
        if (process.env.NODE_ENV === "test") {
            // Add a small delay before closing connections to avoid negative timeout issues
            await new Promise(resolve => setTimeout(resolve, 100));
            await closeDbConnection();
        }
    });

    test("POST /addComment - Rate limit by IP (5 second interval)", async () => {
        const { token } = await createTestUserWithToken();
        
        const comment = {
            platform: "youtube",
            videoId: `ratetest1_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            time: 10,
            text: "Rate limit test",
        };

        const res1 = await app.request("/addComment", {
            method: "POST",
            body: JSON.stringify(comment),
            headers: {
                "Content-Type": "application/json",
                "x-forwarded-for": "192.168.1.100",
                Authorization: `Bearer ${token}`,
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
                Authorization: `Bearer ${token}`,
            },
        });
        expect(res2.status).toBe(429);
        const json2 = await res2.json();
        expect(json2.success).toBe(false);
        expect(json2.type).toBe("rate_limit");
        expect(json2.error).toContain("wait");
    });

    test("POST /addComment - Rate limit by username (5 second interval)", async () => {
        const { token } = await createTestUserWithToken();
        
        await new Promise((resolve) => setTimeout(resolve, 1100));
        const comment = {
            platform: "youtube",
            videoId: `ratetest2_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            time: 10,
            text: "Rate limit test",
        };

        const res1 = await app.request("/addComment", {
            method: "POST",
            body: JSON.stringify(comment),
            headers: {
                "Content-Type": "application/json",
                "x-forwarded-for": "192.168.1.101",
                Authorization: `Bearer ${token}`,
            },
        });
        expect(res1.status).toBe(200);

        const res2 = await app.request("/addComment", {
            method: "POST",
            body: JSON.stringify({ ...comment, text: "Second comment" }),
            headers: {
                "Content-Type": "application/json",
                "x-forwarded-for": "192.168.1.102",
                Authorization: `Bearer ${token}`,
            },
        });
        expect(res2.status).toBe(429);
        const json2 = await res2.json();
        expect(json2.success).toBe(false);
        expect(json2.type).toBe("rate_limit");
    });

    test("GET /getComments - Rate limit (1 per second)", async () => {
        const uniqueVideoId = `retrievaltest_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        const uniqueUsername = `retrievaluser_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        const queryParams = `platform=youtube&videoId=${uniqueVideoId}&username=${uniqueUsername}`;

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
        const uniqueVideoId = `retrievaltest2_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        const uniqueUsername = `retrievaluser2_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        const queryParams = `platform=youtube&videoId=${uniqueVideoId}&username=${uniqueUsername}`;

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