import db, { deleteUser, deleteVideo, deleteComment } from "../src/db/db";
import { comments, videos, users, authTokens } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { rateLimiter } from "../src/rateLimit";
import bcrypt from "bcrypt";

export interface TestUser {
    id: number;
    email: string;
    username: string;
    password: string;
}

export interface CreatedData {
    userIds: number[];
    videoIdentifiers: { platform: string; videoId: string }[];
    commentIds: number[];
}

let createdData: CreatedData = {
    userIds: [],
    videoIdentifiers: [],
    commentIds: [],
};

export function addCreatedUser(userId: number) {
    createdData.userIds.push(userId);
}

export function addCreatedVideo(platform: string, videoId: string) {
    createdData.videoIdentifiers.push({ platform, videoId });
}

export function addCreatedComment(commentId: number) {
    createdData.commentIds.push(commentId);
}

export async function cleanupDatabase() {
    try {
        // Reset rate limiter to ensure clean state between tests
        rateLimiter.resetForTests();
        
        // In test environment, we can rely on cascade deletes
        // Delete users first, which will cascade delete comments and auth tokens
        console.log(`Cleaning up ${createdData.userIds.length} test users...`);
        for (const userId of createdData.userIds) {
            try {
                console.log(`Deleting user ${userId}...`);
                const result = await Promise.race([
                    deleteUser(userId),
                    new Promise<{ success: boolean; error?: string }>((_, reject) => 
                        setTimeout(() => reject(new Error("User deletion timeout")), 2000)
                    )
                ]);
                
                if (!result.success) {
                    console.warn(`Failed to delete user ${userId}: ${result.error}`);
                } else {
                    console.log(`Successfully deleted user ${userId}`);
                }
            } catch (error) {
                console.warn(`Failed to delete user ${userId}:`, error);
            }
            // Very small delay
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        
        // Delete videos (which will cascade delete any remaining comments)
        console.log(`Cleaning up ${createdData.videoIdentifiers.length} test videos...`);
        for (const videoIdentifier of createdData.videoIdentifiers) {
            try {
                const result = await Promise.race([
                    deleteVideo(videoIdentifier.platform, videoIdentifier.videoId),
                    new Promise<{ success: boolean; error?: string }>((_, reject) => 
                        setTimeout(() => reject(new Error("Video deletion timeout")), 2000)
                    )
                ]);
                
                if (!result.success) {
                    console.warn(`Failed to delete video ${videoIdentifier.platform}:${videoIdentifier.videoId}: ${result.error}`);
                }
            } catch (error) {
                console.warn(`Failed to delete video ${videoIdentifier.platform}:${videoIdentifier.videoId}:`, error);
            }
            // Very small delay
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        
        // Clean up any orphaned comments (shouldn't be necessary with cascade deletes)
        console.log(`Cleaning up ${createdData.commentIds.length} test comments...`);
        for (const commentId of createdData.commentIds) {
            try {
                const result = await deleteComment(commentId);
                if (!result.success && !result.error?.includes("not found")) {
                    console.warn(`Failed to delete comment ${commentId}: ${result.error}`);
                }
            } catch (error) {
                console.warn(`Failed to delete comment ${commentId}:`, error);
            }
        }

        console.log(`Test cleanup completed. Deleted ${createdData.commentIds.length} comments, ${createdData.videoIdentifiers.length} videos, and ${createdData.userIds.length} users.`);

        // Reset the tracking arrays for the next test run
        createdData = {
            userIds: [],
            videoIdentifiers: [],
            commentIds: [],
        };
    } catch (error) {
        console.error("Error in cleanup:", error);
        // Reset anyway to avoid carrying over to next test
        createdData = {
            userIds: [],
            videoIdentifiers: [],
            commentIds: [],
        };
    }
}

export async function resetRateLimiter() {
    rateLimiter.resetForTests();
}

export async function createTestUser(email?: string, username?: string, password?: string): Promise<TestUser> {
    const plainPassword = password || "password123";
    const hashedPassword = await bcrypt.hash(plainPassword, 10);
    
    const testUser = {
        email: email || `testuser_${Date.now()}_${Math.random().toString(36).substring(7)}@example.com`,
        username: username || `testuser_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        password: hashedPassword,
    };

    const insertedUser = await db.insert(users).values(testUser).returning();
    const user = insertedUser[0];
    
    addCreatedUser(user.id);
    
    return {
        id: user.id,
        email: user.email,
        username: user.username,
        password: plainPassword, // Return the plain password for login tests
    };
}

export async function getAuthTokenForUser(user: TestUser): Promise<string> {
    const app = require("../src/index").default;
    
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

export async function createTestUserWithToken(): Promise<{ user: TestUser; token: string }> {
    const app = require("../src/index").default;
    
    const user = {
        email: `testuser_${Date.now()}_${Math.random().toString(36).substring(7)}@example.com`,
        username: `testuser_${Date.now()}_${Math.random().toString(36).substring(7)}`,
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
    
    const signupJson = await signupRes.json();
    addCreatedUser(signupJson.user.id);
    
    const token = await getAuthTokenForUser({
        id: signupJson.user.id,
        email: signupJson.user.email,
        username: signupJson.user.username,
        password: user.password,
    });
    
    return { 
        user: {
            id: signupJson.user.id,
            email: signupJson.user.email,
            username: signupJson.user.username,
            password: user.password,
        }, 
        token 
    };
}

export async function createTestComment(
    token: string, 
    commentData: {
        platform?: string;
        videoId?: string;
        time?: number;
        text?: string;
        color?: string;
        scrollMode?: string;
        fontSize?: string;
    } = {}
): Promise<any> {
    const app = require("../src/index").default;
    
    const defaultComment = {
        platform: "youtube",
        videoId: `test_video_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        time: 10,
        text: `Test comment ${Date.now()}`,
        color: "#ffffff",
        scrollMode: "slide",
        fontSize: "normal",
        ...commentData // Override with provided data
    };

    const res = await app.request("/addComment", {
        method: "POST",
        body: JSON.stringify(defaultComment),
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
    });

    if (res.status !== 200) {
        const errorText = await res.text();
        console.error("Failed to create test comment:", errorText);
        throw new Error("Failed to create test comment for test");
    }

    const json = await res.json();
    
    // Track the created comment and video for cleanup
    if (json.comment) {
        addCreatedComment(json.comment.id);
        addCreatedVideo(defaultComment.platform, defaultComment.videoId);
    }
    
    return json.comment;
}
