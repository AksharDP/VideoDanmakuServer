import app from "../src/index";
import {
    describe,
    test,
    expect,
    beforeAll,
    afterAll,
    beforeEach,
    afterEach,
} from "bun:test";
import {
    closeDbConnection,
} from "../src/db/db";
import { sign } from "hono/jwt";
import { 
    cleanupDatabase, 
    createTestUserWithToken, 
    createTestUser,
    createTestComment,
    resetRateLimiter,
    TestUser,
    addCreatedUser,
    addCreatedComment,
    addCreatedVideo
} from "./testUtils";

const secret = process.env.JWT_SECRET || '';

describe("Auth API", () => {
    // Only cleanup at the end to avoid database connection issues
    afterAll(async () => {
        // Final cleanup
        await cleanupDatabase();
    });


    // Signup Tests
    describe("POST /signup", () => {
        test("should sign up a new user successfully", async () => {
            const newUser = {
                email: `test_${Date.now()}@example.com`,
                username: `user_${Date.now()}`,
                password: "password123",
            };
            const res = await app.request("/signup", {
                method: "POST",
                body: JSON.stringify(newUser),
                headers: { "Content-Type": "application/json" },
            });
            expect(res.status).toBe(201);
            const json = await res.json();
            expect(json.message).toBe("User created successfully");
            expect(json.user).toBeDefined();
            expect(json.user.email).toBe(newUser.email);
            expect(json.user.username).toBe(newUser.username);
            
            // Track created user for cleanup
            if (json.user) {
                addCreatedUser(json.user.id);
            }
        });

        test("should return 409 if email already exists", async () => {
            const uniqueEmail = `email${Date.now()}@example.com`;
            const uniqueUsername = `user${Date.now()}`;
            const newUser = {
                email: uniqueEmail,
                username: uniqueUsername,
                password: "password123",
            };
            const firstRes = await app.request("/signup", {
                method: "POST",
                body: JSON.stringify(newUser),
                headers: { "Content-Type": "application/json" },
            });
            
            // Track the first user created for cleanup
            if (firstRes.status === 201) {
                const firstJson = await firstRes.json();
                if (firstJson.user) {
                    addCreatedUser(firstJson.user.id);
                }
            }

            const res = await app.request("/signup", {
                method: "POST",
                body: JSON.stringify({ ...newUser, username: `new${Date.now()}` }),
                headers: { "Content-Type": "application/json" },
            });
            expect(res.status).toBe(409);
            const json = await res.json();
            expect(json.error).toBe("User already exists");
        });

        test("should return 409 if username already exists", async () => {
            const uniqueEmail = `user${Date.now()}@example.com`;
            const uniqueUsername = `user${Date.now()}`;
            const newUser = {
                email: uniqueEmail,
                username: uniqueUsername,
                password: "password123",
            };
            const firstRes = await app.request("/signup", {
                method: "POST",
                body: JSON.stringify(newUser),
                headers: { "Content-Type": "application/json" },
            });
            
            // Track the first user created for cleanup
            if (firstRes.status === 201) {
                const firstJson = await firstRes.json();
                if (firstJson.user) {
                    addCreatedUser(firstJson.user.id);
                }
            }
            
            const res = await app.request("/signup", {
                method: "POST",
                body: JSON.stringify({ ...newUser, email: `new${Date.now()}@example.com` }),
                headers: { "Content-Type": "application/json" },
            });
            expect(res.status).toBe(409);
            const json = await res.json();
            expect(json.error).toBe("User already exists");
        });

        test("should return 400 for invalid email", async () => {
            const res = await app.request("/signup", {
                method: "POST",
                body: JSON.stringify({
                    email: "invalid-email",
                    username: `user_${Date.now()}`,
                    password: "password123",
                }),
                headers: { "Content-Type": "application/json" },
            });
            expect(res.status).toBe(400);
        });

        test("should return 400 for username too short", async () => {
            const res = await app.request("/signup", {
                method: "POST",
                body: JSON.stringify({
                    email: `test_${Date.now()}@example.com`,
                    username: "a",
                    password: "password123",
                }),
                headers: { "Content-Type": "application/json" },
            });
            expect(res.status).toBe(400);
        });

        test("should return 400 for password too short", async () => {
            const res = await app.request("/signup", {
                method: "POST",
                body: JSON.stringify({
                    email: `test_${Date.now()}@example.com`,
                    username: `user_${Date.now()}`,
                    password: "123",
                }),
                headers: { "Content-Type": "application/json" },
            });
            expect(res.status).toBe(400);
        });
    });

    // Login Tests
    describe("POST /login", () => {
        test("should login successfully with email", async () => {
            const user = await createTestUser();
            
            const res = await app.request("/login", {
                method: "POST",
                body: JSON.stringify({
                    emailOrUsername: user.email,
                    password: user.password,
                }),
                headers: { "Content-Type": "application/json" },
            });
            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.token).toBeDefined();
        });

        test("should login successfully with username", async () => {
            const user = await createTestUser();
            
            const res = await app.request("/login", {
                method: "POST",
                body: JSON.stringify({
                    emailOrUsername: user.username,
                    password: user.password,
                }),
                headers: { "Content-Type": "application/json" },
            });
            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.token).toBeDefined();
        });

        test("should return 401 for incorrect password", async () => {
            const res = await app.request("/login", {
                method: "POST",
                body: JSON.stringify({
                    emailOrUsername: "testuser",
                    password: "wrongpassword",
                }),
                headers: { "Content-Type": "application/json" },
            });
            expect(res.status).toBe(401);
            const json = await res.json();
            expect(json.error).toBe("Invalid credentials");
        });

        test("should return 401 for non-existent user", async () => {
            const res = await app.request("/login", {
                method: "POST",
                body: JSON.stringify({
                    emailOrUsername: "nouser",
                    password: "password123",
                }),
                headers: { "Content-Type": "application/json" },
            });
            expect(res.status).toBe(401);
            const json = await res.json();
            expect(json.error).toBe("Invalid credentials");
        });
    });

    // Auth Middleware Tests
    describe("Auth Middleware", () => {
        test("should allow access with a valid token", async () => {
            await resetRateLimiter();
            const { user, token } = await createTestUserWithToken();
            
            const commentData = {
                platform: "youtube",
                videoId: `auth_test_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                time: 1,
                text: "hello",
            };
            
            const res = await app.request("/addComment", {
                method: "POST",
                body: JSON.stringify(commentData),
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
            });
            expect(res.status).toBe(200);
            
            // Track created records for cleanup
            const json = await res.json();
            if (json.success && json.comment) {
                addCreatedComment(json.comment.id);
                addCreatedVideo(commentData.platform, commentData.videoId);
            }
        });

        test("should return 401 for missing token", async () => {
            const res = await app.request("/addComment", {
                method: "POST",
                body: JSON.stringify({
                    platform: "youtube",
                    videoId: `auth_test_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                    time: 1,
                    text: "hello",
                }),
                headers: { "Content-Type": "application/json" },
            });
            expect(res.status).toBe(401);
            const json = await res.json();
            expect(json.error).toBe("Unauthorized");
        });

        test("should return 401 for invalid token", async () => {
            const res = await app.request("/addComment", {
                method: "POST",
                body: JSON.stringify({
                    platform: "youtube",
                    videoId: `auth_test_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                    time: 1,
                    text: "hello",
                }),
                headers: {
                    "Content-Type": "application/json",
                    Authorization: "Bearer invalidtoken",
                },
            });
            expect(res.status).toBe(401);
            const json = await res.json();
            expect(json.error).toBe("Invalid token");
        });

        test("should return 401 for expired token", async () => {
            const { user } = await createTestUserWithToken();
            
            const expiredToken = await sign(
                {
                    sub: user.id,
                    iat: Math.floor(Date.now() / 1000) - 3600,
                    exp: Math.floor(Date.now() / 1000) - 1800,
                },
                secret
            );

            const res = await app.request("/addComment", {
                method: "POST",
                body: JSON.stringify({
                    platform: "youtube",
                    videoId: `auth_test_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                    time: 1,
                    text: "hello",
                }),
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${expiredToken}`,
                },
            });
            expect(res.status).toBe(401);
            const json = await res.json();
            expect(json.error).toBe("Token expired");
        });
    });
});
