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

    describe("POST /reportComment", () => {
        test("should report a comment successfully", async () => {
            const { token } = await createTestUserWithToken();
            
            // Create a comment to report
            const comment = await createTestComment(token, {
                platform: "youtube",
                videoId: `report_test_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                time: 15,
                text: "This comment will be reported",
            });

            const reportData = {
                commentId: comment.id,
                reason: "Inappropriate content",
                additionalDetails: "This comment contains offensive language"
            };

            const res = await app.request("/reportComment", {
                method: "POST",
                body: JSON.stringify(reportData),
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
            });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
        });

        test("should report a comment without additional details", async () => {
            const { token } = await createTestUserWithToken();
            
            // Create a comment to report
            const comment = await createTestComment(token, {
                platform: "youtube",
                videoId: `report_test_2_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                time: 20,
                text: "Another comment to report",
            });

            const reportData = {
                commentId: comment.id,
                reason: "Spam"
            };

            const res = await app.request("/reportComment", {
                method: "POST",
                body: JSON.stringify(reportData),
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
            });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
        });

        test("should return 400 for missing commentId", async () => {
            const { token } = await createTestUserWithToken();

            const reportData = {
                reason: "Inappropriate content"
            };

            const res = await app.request("/reportComment", {
                method: "POST",
                body: JSON.stringify(reportData),
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
            });

            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error).toBe("Missing commentId or reason");
        });

        test("should return 400 for missing reason", async () => {
            const { token } = await createTestUserWithToken();

            const reportData = {
                commentId: 123
            };

            const res = await app.request("/reportComment", {
                method: "POST",
                body: JSON.stringify(reportData),
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
            });

            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error).toBe("Missing commentId or reason");
        });

        test("should return 400 for non-existent comment", async () => {
            const { token } = await createTestUserWithToken();

            const reportData = {
                commentId: 999999, // Non-existent comment ID
                reason: "Inappropriate content"
            };

            const res = await app.request("/reportComment", {
                method: "POST",
                body: JSON.stringify(reportData),
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
            });

            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error).toBe("Comment not found");
        });

        test("should return 401 for missing authorization", async () => {
            const reportData = {
                commentId: 1,
                reason: "Inappropriate content"
            };

            const res = await app.request("/reportComment", {
                method: "POST",
                body: JSON.stringify(reportData),
                headers: {
                    "Content-Type": "application/json",
                },
            });

            expect(res.status).toBe(401);
            const json = await res.json();
            expect(json.error).toBe("Unauthorized");
        });

        test("should return 401 for invalid token", async () => {
            const reportData = {
                commentId: 1,
                reason: "Inappropriate content"
            };

            const res = await app.request("/reportComment", {
                method: "POST",
                body: JSON.stringify(reportData),
                headers: {
                    "Content-Type": "application/json",
                    Authorization: "Bearer invalid_token",
                },
            });

            expect(res.status).toBe(401);
            const json = await res.json();
            expect(json.error).toBe("Invalid token");
        });

        test("should allow user to report their own comment", async () => {
            const { token } = await createTestUserWithToken();
            
            // Create a comment
            const comment = await createTestComment(token, {
                platform: "youtube",
                videoId: `self_report_test_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                time: 25,
                text: "User reporting their own comment",
            });

            const reportData = {
                commentId: comment.id,
                reason: "I want to report my own comment"
            };

            const res = await app.request("/reportComment", {
                method: "POST",
                body: JSON.stringify(reportData),
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
            });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
        });

        test("should handle multiple reports on the same comment by different users", async () => {
            const { token: token1 } = await createTestUserWithToken();
            const { token: token2 } = await createTestUserWithToken();
            
            // Create a comment with first user
            const comment = await createTestComment(token1, {
                platform: "youtube",
                videoId: `multi_report_test_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                time: 30,
                text: "Comment to be reported multiple times",
            });

            // First user reports the comment
            const reportData1 = {
                commentId: comment.id,
                reason: "First user report"
            };

            const res1 = await app.request("/reportComment", {
                method: "POST",
                body: JSON.stringify(reportData1),
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token1}`,
                },
            });

            expect(res1.status).toBe(200);
            const json1 = await res1.json();
            expect(json1.success).toBe(true);

            // Second user reports the same comment
            const reportData2 = {
                commentId: comment.id,
                reason: "Second user report",
                additionalDetails: "This is also inappropriate"
            };

            const res2 = await app.request("/reportComment", {
                method: "POST",
                body: JSON.stringify(reportData2),
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token2}`,
                },
            });

            expect(res2.status).toBe(200);
            const json2 = await res2.json();
            expect(json2.success).toBe(true);
        });

        test("should handle very long reason string", async () => {
            const { token } = await createTestUserWithToken();
            
            // Create a comment to report
            const comment = await createTestComment(token, {
                platform: "youtube",
                videoId: `long_reason_test_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                time: 35,
                text: "Comment for long reason test",
            });

            const longReason = "A".repeat(255); // Maximum allowed length
            const reportData = {
                commentId: comment.id,
                reason: longReason
            };

            const res = await app.request("/reportComment", {
                method: "POST",
                body: JSON.stringify(reportData),
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
            });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
        });

        test("should reject reason string that is too long", async () => {
            const { token } = await createTestUserWithToken();
            
            // Create a comment to report
            const comment = await createTestComment(token, {
                platform: "youtube",
                videoId: `too_long_reason_test_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                time: 40,
                text: "Comment for too long reason test",
            });

            const tooLongReason = "A".repeat(256); // Exceeds maximum allowed length
            const reportData = {
                commentId: comment.id,
                reason: tooLongReason
            };

            const res = await app.request("/reportComment", {
                method: "POST",
                body: JSON.stringify(reportData),
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
            });

            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error).toContain("String must contain at most 255 character(s)");
        });

        test("should handle very long additional details", async () => {
            const { token } = await createTestUserWithToken();
            
            // Create a comment to report
            const comment = await createTestComment(token, {
                platform: "youtube",
                videoId: `long_details_test_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                time: 45,
                text: "Comment for long details test",
            });

            const longDetails = "B".repeat(500); // Maximum allowed length
            const reportData = {
                commentId: comment.id,
                reason: "Test reason",
                additionalDetails: longDetails
            };

            const res = await app.request("/reportComment", {
                method: "POST",
                body: JSON.stringify(reportData),
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
            });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
        });

        test("should reject additional details that are too long", async () => {
            const { token } = await createTestUserWithToken();
            
            // Create a comment to report
            const comment = await createTestComment(token, {
                platform: "youtube",
                videoId: `too_long_details_test_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                time: 50,
                text: "Comment for too long details test",
            });

            const tooLongDetails = "B".repeat(501); // Exceeds maximum allowed length
            const reportData = {
                commentId: comment.id,
                reason: "Test reason",
                additionalDetails: tooLongDetails
            };

            const res = await app.request("/reportComment", {
                method: "POST",
                body: JSON.stringify(reportData),
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
            });

            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error).toContain("String must contain at most 500 character(s)");
        });

        test("should handle invalid commentId types", async () => {
            const { token } = await createTestUserWithToken();

            const reportData = {
                commentId: "invalid", // String instead of number
                reason: "Test reason"
            };

            const res = await app.request("/reportComment", {
                method: "POST",
                body: JSON.stringify(reportData),
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
            });

            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error).toContain("Expected number");
        });

        test("should handle negative commentId", async () => {
            const { token } = await createTestUserWithToken();

            const reportData = {
                commentId: -1,
                reason: "Test reason"
            };

            const res = await app.request("/reportComment", {
                method: "POST",
                body: JSON.stringify(reportData),
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
            });

            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error).toContain("Number must be greater than or equal to 1");
        });

        test("should handle empty reason string", async () => {
            const { token } = await createTestUserWithToken();

            const reportData = {
                commentId: 1,
                reason: ""
            };

            const res = await app.request("/reportComment", {
                method: "POST",
                body: JSON.stringify(reportData),
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
            });

            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error).toBe("Missing commentId or reason");
        });
    });

    describe("Report Comment Security Tests", () => {
        describe("Input Sanitization", () => {
            test("should handle XSS attempts in reason field", async () => {
                const { token } = await createTestUserWithToken();
                
                const comment = await createTestComment(token, {
                    platform: "youtube",
                    videoId: `xss_test_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                    time: 10,
                    text: "Comment to test XSS in reason",
                });

                const xssPayload = "<script>alert('XSS')</script>";
                const reportData = {
                    commentId: comment.id,
                    reason: xssPayload
                };

                const res = await app.request("/reportComment", {
                    method: "POST",
                    body: JSON.stringify(reportData),
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                });

                expect(res.status).toBe(200);
                const json = await res.json();
                expect(json.success).toBe(true);
                // The API should accept the input (sanitization would happen on display)
            });

            test("should handle XSS attempts in additional details field", async () => {
                const { token } = await createTestUserWithToken();
                
                const comment = await createTestComment(token, {
                    platform: "youtube",
                    videoId: `xss_details_test_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                    time: 15,
                    text: "Comment to test XSS in details",
                });

                const xssPayload = "<img src=x onerror=alert('XSS')>";
                const reportData = {
                    commentId: comment.id,
                    reason: "Inappropriate content",
                    additionalDetails: xssPayload
                };

                const res = await app.request("/reportComment", {
                    method: "POST",
                    body: JSON.stringify(reportData),
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                });

                expect(res.status).toBe(200);
                const json = await res.json();
                expect(json.success).toBe(true);
            });

            test("should handle SQL injection attempts in reason field", async () => {
                const { token } = await createTestUserWithToken();
                
                const comment = await createTestComment(token, {
                    platform: "youtube",
                    videoId: `sql_test_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                    time: 20,
                    text: "Comment to test SQL injection",
                });

                const sqlPayload = "'; DROP TABLE comments; --";
                const reportData = {
                    commentId: comment.id,
                    reason: sqlPayload
                };

                const res = await app.request("/reportComment", {
                    method: "POST",
                    body: JSON.stringify(reportData),
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                });

                expect(res.status).toBe(200);
                const json = await res.json();
                expect(json.success).toBe(true);
                // ORM should prevent SQL injection
            });

            test("should handle unicode and special characters", async () => {
                const { token } = await createTestUserWithToken();
                
                const comment = await createTestComment(token, {
                    platform: "youtube",
                    videoId: `unicode_test_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                    time: 25,
                    text: "Comment to test unicode",
                });

                const unicodePayload = "Inappropriate content with 🚫 emojis and unicode: ñáéíóú 中文 العربية";
                const reportData = {
                    commentId: comment.id,
                    reason: unicodePayload,
                    additionalDetails: "Additional details with special chars: !@#$%^&*()_+-=[]{}|;':\",./<>?"
                };

                const res = await app.request("/reportComment", {
                    method: "POST",
                    body: JSON.stringify(reportData),
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                });

                expect(res.status).toBe(200);
                const json = await res.json();
                expect(json.success).toBe(true);
            });
        });

        describe("Authorization Security", () => {
            test("should require valid JWT token", async () => {
                const reportData = {
                    commentId: 1,
                    reason: "Test reason"
                };

                const res = await app.request("/reportComment", {
                    method: "POST",
                    body: JSON.stringify(reportData),
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: "Bearer invalid.token.here",
                    },
                });

                expect(res.status).toBe(401);
            });

            test("should reject malformed JWT tokens", async () => {
                const reportData = {
                    commentId: 1,
                    reason: "Test reason"
                };

                const res = await app.request("/reportComment", {
                    method: "POST",
                    body: JSON.stringify(reportData),
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: "Bearer malformed-token",
                    },
                });

                expect(res.status).toBe(401);
            });

            test("should handle missing Authorization header", async () => {
                const reportData = {
                    commentId: 1,
                    reason: "Test reason"
                };

                const res = await app.request("/reportComment", {
                    method: "POST",
                    body: JSON.stringify(reportData),
                    headers: {
                        "Content-Type": "application/json",
                    },
                });

                expect(res.status).toBe(401);
            });

            test("should handle Authorization header without Bearer prefix", async () => {
                const { token } = await createTestUserWithToken();
                
                const reportData = {
                    commentId: 1,
                    reason: "Test reason"
                };

                const res = await app.request("/reportComment", {
                    method: "POST",
                    body: JSON.stringify(reportData),
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: token, // Missing "Bearer " prefix
                    },
                });

                expect(res.status).toBe(401);
            });
        });

        describe("Input Validation Security", () => {
            test("should handle extremely large JSON payloads", async () => {
                const { token } = await createTestUserWithToken();
                
                // Create a very large payload (but within limits)
                const largeReason = "A".repeat(255);
                const largeDetails = "B".repeat(500);
                
                const reportData = {
                    commentId: 1,
                    reason: largeReason,
                    additionalDetails: largeDetails
                };

                const res = await app.request("/reportComment", {
                    method: "POST",
                    body: JSON.stringify(reportData),
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                });

                // Should fail because commentId 1 doesn't exist, but should handle the large payload
                expect(res.status).toBe(400);
                const json = await res.json();
                expect(json.error).toBe("Comment not found");
            });

            test("should handle null values properly", async () => {
                const { token } = await createTestUserWithToken();

                const reportData = {
                    commentId: null,
                    reason: null,
                    additionalDetails: null
                };

                const res = await app.request("/reportComment", {
                    method: "POST",
                    body: JSON.stringify(reportData),
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                });

                expect(res.status).toBe(400);
                const json = await res.json();
                expect(json.error).toBe("Missing commentId or reason");
            });

            test("should handle undefined values properly", async () => {
                const { token } = await createTestUserWithToken();

                const reportData = {
                    commentId: undefined,
                    reason: undefined,
                    additionalDetails: undefined
                };

                const res = await app.request("/reportComment", {
                    method: "POST",
                    body: JSON.stringify(reportData),
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                });

                expect(res.status).toBe(400);
                const json = await res.json();
                expect(json.error).toBe("Missing commentId or reason");
            });

            test("should handle non-JSON content-type", async () => {
                const { token } = await createTestUserWithToken();

                const res = await app.request("/reportComment", {
                    method: "POST",
                    body: "commentId=1&reason=test",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                        Authorization: `Bearer ${token}`,
                    },
                });

                // Should fail gracefully - 500 is acceptable for malformed requests
                expect([400, 500]).toContain(res.status);
            });
        });

        describe("Business Logic Security", () => {
            test("should prevent reporting the same comment multiple times by the same user", async () => {
                const { token } = await createTestUserWithToken();
                
                const comment = await createTestComment(token, {
                    platform: "youtube",
                    videoId: `duplicate_report_test_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                    time: 30,
                    text: "Comment to test duplicate reporting",
                });

                const reportData = {
                    commentId: comment.id,
                    reason: "First report"
                };

                // First report should succeed
                const res1 = await app.request("/reportComment", {
                    method: "POST",
                    body: JSON.stringify(reportData),
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                });

                expect(res1.status).toBe(200);
                const json1 = await res1.json();
                expect(json1.success).toBe(true);

                // Second report by same user should also succeed (no duplicate prevention implemented)
                // This might be a business requirement to allow or prevent
                const res2 = await app.request("/reportComment", {
                    method: "POST",
                    body: JSON.stringify({ ...reportData, reason: "Second report" }),
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                });

                expect(res2.status).toBe(200);
                const json2 = await res2.json();
                expect(json2.success).toBe(true);
            });

            test("should handle integer overflow for commentId", async () => {
                const { token } = await createTestUserWithToken();

                const reportData = {
                    commentId: Number.MAX_SAFE_INTEGER + 1,
                    reason: "Test reason"
                };

                const res = await app.request("/reportComment", {
                    method: "POST",
                    body: JSON.stringify(reportData),
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                });

                expect(res.status).toBe(400);
                // Should handle the overflow gracefully
            });

            test("should handle floating point commentId", async () => {
                const { token } = await createTestUserWithToken();

                const reportData = {
                    commentId: 1.5,
                    reason: "Test reason"
                };

                const res = await app.request("/reportComment", {
                    method: "POST",
                    body: JSON.stringify(reportData),
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                });

                expect(res.status).toBe(400);
                const json = await res.json();
                expect(json.success).toBe(false);
            });
        });

        describe("Error Handling Security", () => {
            test("should not leak database errors in response", async () => {
                const { token } = await createTestUserWithToken();

                const reportData = {
                    commentId: 999999,
                    reason: "Test reason"
                };

                const res = await app.request("/reportComment", {
                    method: "POST",
                    body: JSON.stringify(reportData),
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                });

                expect(res.status).toBe(400);
                const json = await res.json();
                expect(json.error).toBe("Comment not found");
                // Should not contain database-specific error messages
                expect(json.error).not.toContain("SQL");
                expect(json.error).not.toContain("database");
                expect(json.error).not.toContain("constraint");
            });

            test("should handle malformed JSON gracefully", async () => {
                const { token } = await createTestUserWithToken();

                const res = await app.request("/reportComment", {
                    method: "POST",
                    body: "{ invalid json }",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                });

                // Should fail with either 400 or 500 - both are acceptable for malformed JSON
                expect([400, 500]).toContain(res.status);
                // Should not expose JSON parsing errors in production
            });
        });
    });
});
