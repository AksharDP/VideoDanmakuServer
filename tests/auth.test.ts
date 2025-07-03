import app from "../src/index";
import {
    describe,
    test,
    expect,
    beforeAll,
    afterAll,
    beforeEach,
} from "bun:test";
import {
    closeDbConnection,
} from "../src/db/db";
import { sign } from "hono/jwt";

const secret = process.env.JWT_SECRET || '';

describe("Auth API", () => {

    beforeAll(async () => {
        // No migrations needed - database should already be set up
    });

    afterAll(async () => {
        // Don't close connection here - let other test files use it
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
        });

        test("should return 409 if email already exists", async () => {
            const uniqueEmail = `email${Date.now()}@example.com`;
            const uniqueUsername = `user${Date.now()}`;
            const newUser = {
                email: uniqueEmail,
                username: uniqueUsername,
                password: "password123",
            };
            await app.request("/signup", {
                method: "POST",
                body: JSON.stringify(newUser),
                headers: { "Content-Type": "application/json" },
            });

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
            await app.request("/signup", {
                method: "POST",
                body: JSON.stringify(newUser),
                headers: { "Content-Type": "application/json" },
            });
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
        let uniqueEmail: string;
        let uniqueUsername: string;

        beforeEach(async () => {
            uniqueEmail = `login_${Date.now()}@example.com`;
            uniqueUsername = `login_${Date.now()}`;
            const newUser = {
                email: uniqueEmail,
                username: uniqueUsername,
                password: "password123",
            };
            await app.request("/signup", {
                method: "POST",
                body: JSON.stringify(newUser),
                headers: { "Content-Type": "application/json" },
            });
        });

        test("should login successfully with email", async () => {
            const res = await app.request("/login", {
                method: "POST",
                body: JSON.stringify({
                    emailOrUsername: uniqueEmail,
                    password: "password123",
                }),
                headers: { "Content-Type": "application/json" },
            });
            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.token).toBeDefined();
        });

        test("should login successfully with username", async () => {
            const res = await app.request("/login", {
                method: "POST",
                body: JSON.stringify({
                    emailOrUsername: uniqueUsername,
                    password: "password123",
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
        let token: string;
        let userId: number;

        beforeAll(async () => {
            const newUser = {
                email: `test_${Date.now()}@example.com`,
                username: `user_${Date.now()}`,
                password: "password123",
            };
            const signupRes = await app.request("/signup", {
                method: "POST",
                body: JSON.stringify(newUser),
                headers: { "Content-Type": "application/json" },
            });
            const signupJson = await signupRes.json();
            userId = signupJson.user.id;

            const loginRes = await app.request("/login", {
                method: "POST",
                body: JSON.stringify({
                    emailOrUsername: newUser.username,
                    password: newUser.password,
                }),
                headers: { "Content-Type": "application/json" },
            });
            const loginJson = await loginRes.json();
            token = loginJson.token;
        });

        test("should allow access with a valid token", async () => {
            const res = await app.request("/addComment", {
                method: "POST",
                body: JSON.stringify({
                    platform: "youtube",
                    videoId: "123",
                    time: 1,
                    text: "hello",
                }),
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
            });
            expect(res.status).toBe(200);
        });

        test("should return 401 for missing token", async () => {
            const res = await app.request("/addComment", {
                method: "POST",
                body: JSON.stringify({
                    platform: "youtube",
                    videoId: "123",
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
                    videoId: "123",
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
            const expiredToken = await sign(
                {
                    sub: userId,
                    iat: Math.floor(Date.now() / 1000) - 3600,
                    exp: Math.floor(Date.now() / 1000) - 1800,
                },
                secret
            );

            const res = await app.request("/addComment", {
                method: "POST",
                body: JSON.stringify({
                    platform: "youtube",
                    videoId: "123",
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
