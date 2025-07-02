import app from "../src/index";
import { describe, test, expect, afterAll, afterEach } from "bun:test";
import { clearDatabase, closeDbConnection } from "../src/db/db";

describe("Rate Limiting Tests", () => {
    afterEach(async () => {
        await clearDatabase();
    });

    afterAll(() => {
        app.stop();
        closeDbConnection();
    });

    test("POST /addComment - Rate limit by IP (5 second interval)", async () => {
        const comment = {
            platform: "youtube",
            videoId: "ratetest1",
            time: 10,
            text: "Rate limit test",
            username: "ratelimituser1",
        };

        const res1 = await app.request("/addComment", {
            method: "POST",
            body: JSON.stringify(comment),
            headers: {
                "Content-Type": "application/json",
                "x-forwarded-for": "192.168.1.100",
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
            },
        });
        expect(res2.status).toBe(429);
        const json2 = await res2.json();
        expect(json2.success).toBe(false);
        expect(json2.type).toBe("rate_limit");
        expect(json2.error).toContain("wait");
    });

    test("POST /addComment - Rate limit by username (5 second interval)", async () => {
        const comment = {
            platform: "youtube",
            videoId: "ratetest2",
            time: 10,
            text: "Rate limit test",
            username: "ratelimituser2",
        };

        const res1 = await app.request("/addComment", {
            method: "POST",
            body: JSON.stringify(comment),
            headers: {
                "Content-Type": "application/json",
                "x-forwarded-for": "192.168.1.101",
            },
        });
        expect(res1.status).toBe(200);

        const res2 = await app.request("/addComment", {
            method: "POST",
            body: JSON.stringify({ ...comment, text: "Second comment" }),
            headers: {
                "Content-Type": "application/json",
                "x-forwarded-for": "192.168.1.102",
            },
        });
        expect(res2.status).toBe(429);
        const json2 = await res2.json();
        expect(json2.success).toBe(false);
        expect(json2.type).toBe("rate_limit");
    });

    test("POST /addComment - Cross-IP aggregation prevents VPN circumvention", async () => {
        const comment = {
            platform: "youtube",
            videoId: "ratetest3",
            time: 10,
            text: "Cross-IP test",
            username: "crossipuser",
        };

        const ips = ["192.168.1.103", "192.168.1.104", "192.168.1.105"];

        for (let i = 0; i < ips.length; i++) {
            const res = await app.request("/addComment", {
                method: "POST",
                body: JSON.stringify({ ...comment, text: `Comment ${i + 1}` }),
                headers: {
                    "Content-Type": "application/json",
                    "x-forwarded-for": ips[i],
                },
            });

            if (i === 0) {
                expect(res.status).toBe(200);
            } else {
                expect(res.status).toBe(429);
                const json = await res.json();
                expect(json.error).toContain("Cross-IP limit exceeded");
            }

            await new Promise((resolve) => setTimeout(resolve, 100));
        }
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

    test("GET /rateLimit/status - Should return rate limit information", async () => {
        const comment = {
            platform: "youtube",
            videoId: "statustest",
            time: 10,
            text: "Status test comment",
            username: "statususer",
        };

        await app.request("/addComment", {
            method: "POST",
            body: JSON.stringify(comment),
            headers: {
                "Content-Type": "application/json",
                "x-forwarded-for": "192.168.1.109",
            },
        });

        const res = await app.request(
            "/rateLimit/status?ip=192.168.1.109&username=statususer"
        );
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.success).toBe(true);
        expect(json.data).toBeDefined();
        expect(json.data.totalIPs).toBeGreaterThan(0);
        expect(json.data.totalUsers).toBeGreaterThan(0);
    });

    test("Rate limits should allow requests after time intervals", async () => {
        const comment = {
            platform: "youtube",
            videoId: "timetest",
            time: 10,
            text: "Time interval test",
            username: "timeuser",
        };

        const res1 = await app.request("/addComment", {
            method: "POST",
            body: JSON.stringify(comment),
            headers: {
                "Content-Type": "application/json",
                "x-forwarded-for": "192.168.1.110",
            },
        });
        expect(res1.status).toBe(200);

        const res2 = await app.request("/addComment", {
            method: "POST",
            body: JSON.stringify({ ...comment, text: "Second comment" }),
            headers: {
                "Content-Type": "application/json",
                "x-forwarded-for": "192.168.1.110",
            },
        });
        expect(res2.status).toBe(429);
        const json2 = await res2.json();
        expect(json2.error).toMatch(/wait \d+ seconds/);
    });

    test("Different users/IPs should not interfere with each other", async () => {
        const comment1 = {
            platform: "youtube",
            videoId: "isolation1",
            time: 10,
            text: "Isolation test 1",
            username: "isolationuser1",
        };

        const comment2 = {
            platform: "youtube",
            videoId: "isolation2",
            time: 10,
            text: "Isolation test 2",
            username: "isolationuser2",
        };

        const res1 = await app.request("/addComment", {
            method: "POST",
            body: JSON.stringify(comment1),
            headers: {
                "Content-Type": "application/json",
                "x-forwarded-for": "192.168.1.111",
            },
        });

        const res2 = await app.request("/addComment", {
            method: "POST",
            body: JSON.stringify(comment2),
            headers: {
                "Content-Type": "application/json",
                "x-forwarded-for": "192.168.1.112",
            },
        });

        expect(res1.status).toBe(200);
        expect(res2.status).toBe(200);
    });
});
