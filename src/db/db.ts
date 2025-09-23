import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import path from "path";
import * as schema from "./schema";
import { z } from "zod";
import { verify } from "hono/jwt";

const postgres = require("postgres").default;
let connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    throw new Error(
        "DATABASE_URL environment variable is required. Please set it in your system environment variables."
    );
}

const connectionOptions = {
    onnotice: () => {},
    max: process.env.NODE_ENV === "test" ? 1 : 20,
    idle_timeout: process.env.NODE_ENV === "test" ? 5 : 30,
    connect_timeout: process.env.NODE_ENV === "test" ? 5 : 30,
    prepare: true,
    transform: {
        undefined: null,
    },
};

const client = postgres(connectionString, connectionOptions);
const db = drizzle(client, { schema });

const secret = process.env.JWT_SECRET || '';

if (!secret) {
    throw new Error("JWT_SECRET environment variable is not set");
}

export async function verifyAuthToken(authToken: string): Promise<{ success: boolean; userId?: number; error?: string }> {
    try {
        if (!authToken || authToken.trim() === "") {
            return { success: false, error: "Invalid token" };
        }

        const decodedPayload = await verify(authToken, secret);
        if (!decodedPayload || !decodedPayload.sub) {
            return { success: false, error: "Invalid token" };
        }

        if (decodedPayload.exp && Date.now() / 1000 > decodedPayload.exp) {
            return { success: false, error: "Token expired" };
        }

        const tokenRecord = await db.query.authTokens.findFirst({
            where: and(
                eq(schema.authTokens.token, authToken),
                eq(schema.authTokens.userId, Number(decodedPayload.sub))
            ),
        });

        if (!tokenRecord) {
            return { success: false, error: "Invalid token" };
        }

        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        if (tokenRecord.lastUsedAt < sixMonthsAgo) {
            await db
                .delete(schema.authTokens)
                .where(eq(schema.authTokens.id, tokenRecord.id));
            return { success: false, error: "Token expired due to inactivity" };
        }

        await db
            .update(schema.authTokens)
            .set({ lastUsedAt: new Date() })
            .where(eq(schema.authTokens.id, tokenRecord.id));

        const user = await db.query.users.findFirst({
            where: eq(schema.users.id, Number(decodedPayload.sub)),
        });

        if (!user) {
            return { success: false, error: "User not found" };
        }

        return { success: true, userId: user.id };
    } catch (error: any) {
        const isExpectedJwtError = error.name === "JwtTokenExpired" || 
                                 error.name === "JwtTokenInvalid" || 
                                 error.name === "JwtAlgorithmNotImplemented" ||
                                 error.name === "JwtTokenNotBefore";
        
        if (!isExpectedJwtError && process.env.NODE_ENV !== "test") {
            console.log("Unexpected auth error:", error);
        }
        
        if (error.name === "JwtTokenExpired") {
            return { success: false, error: "Token expired" };
        }
        return { success: false, error: "Invalid token" };
    }
}

export async function runMigrations() {
    try {
        console.log("Running database migrations...");
        await migrate(db, {
            migrationsFolder: path.join(__dirname, "../../drizzle"),
        });
        console.log("Database migrations completed successfully.");
    } catch (error) {
        console.error("Error running database migrations:", error);
        throw error;
    }
}

export async function validateOrInitDatabase() {
    try {
        await db.select().from(schema.comments).limit(1);
        console.log("Comments table exists and is accessible");

        console.log("Database validation completed");
    } catch (error) {
        console.error(
            "Database validation failed, initializing database:",
            error
        );
        await runMigrations();
    }
}

type Comment = Omit<typeof schema.comments.$inferSelect, 'userId' | 'videoId'> & {
    user_id: number;
    video_id: number;
};


export async function getComments(
    platform: string,
    videoId: string,
    totalCommentLimit: number = 1000,
    bucketSize: number = 5,
    maxCommentsPerBucket: number = 25
): Promise<{ success: boolean; comments?: Comment[]; error?: string; code?: string; source?: string }> {
    try {
        const video = await db.query.videos.findFirst({
            where: and(
                eq(schema.videos.platform, platform),
                eq(schema.videos.videoId, videoId)
            ),
        });

        if (!video) {
            return { success: true, comments: [] };
        }
        
        // Pass 1: Get comment density distribution
        const densityQuery = sql`
            SELECT floor(time / ${bucketSize}) as bucket, COUNT(*) as "commentCount"
            FROM ${schema.comments}
            WHERE video_id = ${video.id}
            GROUP BY bucket;
        `;
        const densityResult: { bucket: number, commentCount: string }[] = await db.execute(densityQuery);
        const densityMap = densityResult.map(r => ({ bucket: r.bucket, count: parseInt(r.commentCount, 10) }));

        if (densityMap.length === 0) {
            return { success: true, comments: [] };
        }

        // Logic: Allocate limits proportionally based on density
        const totalCommentsInVideo = densityMap.reduce((sum, b) => sum + b.count, 0);

        const bucketLimits = densityMap.map(bucketInfo => {
            const proportionalLimit = (bucketInfo.count / totalCommentsInVideo) * totalCommentLimit;
            // Apply the cap, but also ensure we don't try to fetch more comments than exist in the bucket
            const finalLimit = Math.ceil(Math.min(proportionalLimit, maxCommentsPerBucket, bucketInfo.count));
            return {
                bucket: bucketInfo.bucket,
                limit: finalLimit
            };
        }).filter(b => b.limit > 0);

        if (bucketLimits.length === 0) {
            return { success: true, comments: [] };
        }

        // Pass 2: Build a single dynamic query to fetch the sampled comments
        const whereClauses = bucketLimits.map(bl => sql`(rc.bucket = ${bl.bucket} AND rc.rn <= ${bl.limit})`);
        
        const finalQuery = sql`
            WITH ranked_comments AS (
                SELECT
                    c.*,
                    floor(c.time / ${bucketSize}) as bucket,
                    ROW_NUMBER() OVER(
                        PARTITION BY floor(c.time / ${bucketSize}) 
                        ORDER BY c.created_at DESC
                    ) as rn
                FROM
                    ${schema.comments} as c
                WHERE
                    c.video_id = ${video.id}
            )
            SELECT
                rc.id, rc.content, rc.time, rc.user_id, rc.video_id, rc.scroll_mode, rc.color, rc.font_size, rc.created_at
            FROM
                ranked_comments rc
            WHERE
                ${sql.join(whereClauses, sql` OR `)}
            ORDER BY
                rc.time ASC;
        `;
        
        const result: any = await db.execute(finalQuery);
        const comments: Comment[] = Array.isArray(result) ? result : result.rows;


        return { success: true, comments, source: 'database' };
    } catch (error: any) {
        console.error("Error fetching comments:", error);
        if (
            error.code === "CONNECTION_ENDED" ||
            error.errno === "CONNECTION_ENDED"
        ) {
            return { success: false, error: "Database connection issue", code: 'db_connection_error' };
        }
        return { success: false, error: "Failed to fetch comments", code: 'fetch_failed' };
    }
}


export const addCommentSchema = z.object({
    platform: z.string().min(1).max(63),
    videoId: z.string().min(1).max(255),
    time: z.number().int().min(0),
    text: z.string().min(1).max(350),
    color: z.string().regex(/^#([0-9a-f]{3}){1,2}$/i, { message: "Invalid hex color format" }).max(15),
    authToken: z.string().min(1),
    scrollMode: z.enum(["slide", "top", "bottom"]),
    fontSize: z.enum(["small", "normal", "large"]),
});

export type AddCommentInput = z.infer<typeof addCommentSchema>;

export async function addComment(
    platform: string,
    videoId: string,
    time: number,
    text: string,
    color: string,
    authToken: string,
    scrollMode: "slide" | "top" | "bottom",
    fontSize: "small" | "normal" | "large"
): Promise<{ success: boolean; comment?: any; error?: string; code?: string }> {
    const parseResult = addCommentSchema.safeParse({
        platform,
        videoId,
        time,
        text,
        color,
        authToken,
        scrollMode,
        fontSize,
    });
    if (!parseResult.success) {
        const firstError = parseResult.error.errors[0];
        let code = "invalid_comment";
        if (firstError.path[0] === "platform") code = "invalid_platform";
        if (firstError.path[0] === "videoId") code = "invalid_videoId";
        if (firstError.path[0] === "text")
            code = firstError.message.includes("max")
                ? "comment_too_long"
                : "invalid_text";
        if (firstError.path[0] === "color") code = "invalid_color";
        if (firstError.path[0] === "time") code = "invalid_time";
        if (firstError.path[0] === "scrollMode") code = "invalid_scrollMode";
        if (firstError.path[0] === "fontSize") code = "invalid_fontSize";
        if (firstError.path[0] === "authToken") code = "invalid_auth_token";
        return {
            success: false,
            error: firstError.message,
            code,
        };
    }

    // Verify auth token and get user ID
    const authResult = await verifyAuthToken(authToken);
    if (!authResult.success) {
        return {
            success: false,
            error: authResult.error || "Authentication failed",
            code: "auth_failed",
        };
    }

    try {
        const video = await db
            .insert(schema.videos)
            .values({ platform, videoId })
            .onConflictDoUpdate({
                target: [schema.videos.platform, schema.videos.videoId],
                set: { videoId },
            })
            .returning()
            .then((res) => res[0]);

        const newComment = await db
            .insert(schema.comments)
            .values({
                content: text,
                time,
                userId: authResult.userId!,
                videoId: video.id,
                scrollMode,
                color,
                fontSize,
            })
            .returning();
        
        return { success: true, comment: newComment[0] };
    } catch (error: any) {
        console.error("Error adding comment:", error);
        if (
            error.code === "CONNECTION_ENDED" ||
            error.errno === "CONNECTION_ENDED"
        ) {
            return { success: false, error: "Database connection issue", code: 'db_connection_error' };
        }
        return { success: false, error: "Failed to add comment", code: 'add_failed' };
    }
}

export const reportCommentSchema = z.object({
    commentId: z.number().int().min(1),
    reason: z.string().min(1).max(255),
    additionalDetails: z.string().max(500).optional(),
    authToken: z.string().min(1),
});

export async function reportComment(
    commentId: number,
    authToken: string,
    reason: string,
    additionalDetails?: string
): Promise<{ success: boolean; error?: string; code?: string }> {
    const validation = reportCommentSchema.safeParse({
        commentId,
        authToken,
        reason,
        additionalDetails,
    });

    if (!validation.success) {
        return { success: false, error: validation.error.errors[0].message, code: 'validation_failed' };
    }

    // Verify auth token and get user ID
    const authResult = await verifyAuthToken(authToken);
    if (!authResult.success) {
        return {
            success: false,
            error: authResult.error || "Authentication failed",
            code: "auth_failed",
        };
    }

    try {
        const comment = await db.query.comments.findFirst({
            where: eq(schema.comments.id, commentId),
        });

        if (!comment) {
            return { success: false, error: "Comment not found", code: 'comment_not_found' };
        }

        await db.insert(schema.commentReports).values({
            commentId,
            reporterUserId: authResult.userId!,
            reason,
            additionalDetails: additionalDetails || null,
        });

        return { success: true };
    } catch (error) {
        console.error("Error reporting comment:", error);
        return { success: false, error: "Failed to report comment", code: 'report_failed' };
    }
}

export async function deleteComment(
    commentId: number,
    authToken: string
): Promise<{ success: boolean; error?: string }> {
    // Verify auth token and get user ID
    const authResult = await verifyAuthToken(authToken);
    if (!authResult.success) {
        return {
            success: false,
            error: authResult.error || "Authentication failed",
        };
    }

    try {
        // First check if the comment exists and is owned by the user
        const comment = await db.query.comments.findFirst({
            where: eq(schema.comments.id, commentId),
        });

        if (!comment) {
            return { success: false, error: "Comment not found" };
        }

        if (comment.userId !== authResult.userId) {
            return { success: false, error: "Not authorized to delete this comment" };
        }

        if (process.env.NODE_ENV === "test") {
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(
                    () => reject(new Error("Database operation timeout")),
                    1000
                );
            });

            try {
                const deleted = (await Promise.race([
                    db
                        .delete(schema.comments)
                        .where(and(
                            eq(schema.comments.id, commentId),
                            eq(schema.comments.userId, authResult.userId!)
                        ))
                        .returning(),
                    timeoutPromise,
                ])) as any[];

                if (deleted.length === 0) {
                    return { success: false, error: "Comment not found or not owned by user" };
                }

                return { success: true };
            } catch (error) {
                console.warn(
                    `Database operation timed out for comment ${commentId}, continuing...`
                );
                return { success: false, error: "Database operation timed out" };
            }
        } else {
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(
                    () => reject(new Error("Database operation timeout")),
                    10000
                );
            });

            const deleted = (await Promise.race([
                db
                    .delete(schema.comments)
                    .where(and(
                        eq(schema.comments.id, commentId),
                        eq(schema.comments.userId, authResult.userId!)
                    ))
                    .returning(),
                timeoutPromise,
            ])) as any[];

            if (deleted.length === 0) {
                return {
                    success: false,
                    error: "Comment not found or not owned by user",
                };
            }

            return { success: true };
        }
    } catch (error: any) {
        console.error("Error deleting comment:", error);
        if (error.message === "Database operation timeout") {
            return { success: false, error: "Database operation timed out" };
        }
        if (
            error.code === "CONNECTION_ENDED" ||
            error.errno === "CONNECTION_ENDED"
        ) {
            return { success: false, error: "Database connection issue" };
        }
        return { success: false, error: "Failed to delete comment" };
    }
}

export async function deleteUser(
    userId: number
): Promise<{ success: boolean; error?: string }> {
    try {
        if (process.env.NODE_ENV === "test") {
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(
                    () => reject(new Error("Database operation timeout")),
                    1000
                );
            });

            try {
                const deleted = (await Promise.race([
                    db
                        .delete(schema.users)
                        .where(eq(schema.users.id, userId))
                        .returning(),
                    timeoutPromise,
                ])) as any[];

                if (deleted.length === 0) {
                    return { success: false, error: "User not found" };
                }

                return { success: true };
            } catch (error) {
                console.warn(
                    `Database operation timed out for user ${userId}, continuing...`
                );
                return { success: false, error: "Database operation timed out" };
            }
        } else {
            const deleted = await db
                .delete(schema.users)
                .where(eq(schema.users.id, userId))
                .returning();

            if (deleted.length === 0) {
                return { success: false, error: "User not found" };
            }

            return { success: true };
        }
    } catch (error: any) {
        console.error("Error deleting user:", error);
        if (
            error.code === "CONNECTION_ENDED" ||
            error.errno === "CONNECTION_ENDED"
        ) {
            return { success: false, error: "Database connection issue" };
        }
        return { success: false, error: "Failed to delete user" };
    }
}

export async function deleteVideo(
    platform: string,
    videoId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        if (process.env.NODE_ENV === "test") {
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(
                    () => reject(new Error("Database operation timeout")),
                    1000
                );
            });

            try {
                const video = (await Promise.race([
                    db.query.videos.findFirst({
                        where: and(
                            eq(schema.videos.platform, platform),
                            eq(schema.videos.videoId, videoId)
                        ),
                    }),
                    timeoutPromise,
                ])) as any;

                if (!video) {
                    return { success: true };
                }

                await Promise.race([
                    db
                        .delete(schema.videos)
                        .where(eq(schema.videos.id, video.id)),
                    timeoutPromise,
                ]);

                return { success: true };
            } catch (error) {
                console.warn(
                    `Database operation timed out for video ${platform}:${videoId}, continuing...`
                );
                return { success: false, error: "Database operation timed out" };
            }
        } else {
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(
                    () => reject(new Error("Database operation timeout")),
                    10000
                );
            });

            const video = (await Promise.race([
                db.query.videos.findFirst({
                    where: and(
                        eq(schema.videos.platform, platform),
                        eq(schema.videos.videoId, videoId)
                    ),
                }),
                timeoutPromise,
            ])) as any;

            if (!video) {
                return { success: false, error: "Video not found" };
            }

            await Promise.race([
                db
                    .delete(schema.comments)
                    .where(eq(schema.comments.videoId, video.id)),
                timeoutPromise,
            ]);

            const deleted = (await Promise.race([
                db
                    .delete(schema.videos)
                    .where(eq(schema.videos.id, video.id))
                    .returning(),
                timeoutPromise,
            ])) as any[];

            if (deleted.length === 0) {
                return { success: false, error: "Failed to delete video" };
            }

            return { success: true };
        }
    } catch (error: any) {
        console.error("Error deleting video:", error);
        if (error.message === "Database operation timeout") {
            return { success: false, error: "Database operation timed out" };
        }
        if (
            error.code === "CONNECTION_ENDED" ||
            error.errno === "CONNECTION_ENDED"
        ) {
            return { success: false, error: "Database connection issue" };
        }
        return { success: false, error: "Failed to delete video" };
    }
}

export async function likeComment(
    commentId: number,
    authToken: string,
    isLike: boolean
): Promise<{ success: boolean; error?: string; code?: string }> {
    // Verify auth token and get user ID
    const authResult = await verifyAuthToken(authToken);
    if (!authResult.success) {
        return {
            success: false,
            error: authResult.error || "Authentication failed",
            code: "auth_failed",
        };
    }

    try {
        // Check if comment exists
        const comment = await db.query.comments.findFirst({
            where: eq(schema.comments.id, commentId),
        });

        if (!comment) {
            return { success: false, error: 'Comment not found', code: 'comment_not_found' };
        }

        // Check if user already liked the comment
        const existingLike = await db.query.commentLikes.findFirst({
            where: and(
                eq(schema.commentLikes.commentId, commentId),
                eq(schema.commentLikes.userId, authResult.userId!)
            ),
        });

        if (isLike) {
            if (existingLike) {
                return { success: false, error: 'User already liked this comment', code: 'already_liked' };
            }

            const result = await db
                .insert(schema.commentLikes)
                .values({
                    commentId,
                    userId: authResult.userId!,
                    liked: true,
                })
                .returning();

            if (result.length === 0) {
                return { success: false, error: 'Failed to insert like', code: 'insert_failed' };
            }

            return { success: true };
        } else {
            if (!existingLike) {
                return { success: false, error: "User hasn't liked this comment yet", code: 'not_liked_yet' };
            }

            const result = await db
                .delete(schema.commentLikes)
                .where(
                    and(
                        eq(schema.commentLikes.commentId, commentId),
                        eq(schema.commentLikes.userId, authResult.userId!)
                    )
                )
                .returning();

            if (result.length === 0) {
                return { success: false, error: 'Failed to remove like', code: 'delete_failed' };
            }

            return { success: true };
        }
    } catch (error) {
        console.error('Error processing like:', error);
        return { success: false, error: 'Failed to process like', code: 'operation_failed' };
    }
}

export async function removeLike(
    commentId: number,
    authToken: string
): Promise<{ success: boolean; error?: string; code?: string }> {
    // Verify auth token and get user ID
    const authResult = await verifyAuthToken(authToken);
    if (!authResult.success) {
        return {
            success: false,
            error: authResult.error || "Authentication failed",
            code: "auth_failed",
        };
    }

    try {
        // Check if comment exists
        const comment = await db.query.comments.findFirst({
            where: eq(schema.comments.id, commentId),
        });

        if (!comment) {
            return { success: false, error: "Comment not found", code: 'comment_not_found' };
        }

        // Remove the like/dislike
        await db
            .delete(schema.commentLikes)
            .where(
                and(
                    eq(schema.commentLikes.commentId, commentId),
                    eq(schema.commentLikes.userId, authResult.userId!)
                )
            );

        return { success: true };
    } catch (error) {
        console.error("Error removing like:", error);
        return { success: false, error: "Failed to remove like", code: 'remove_like_failed' };
    }
}

export async function getCommentLikes(
    commentId: number
): Promise<{ success: boolean; likes?: number; dislikes?: number; error?: string; code?: string }> {
    try {
        const likesResult = await db
            .select({
                likes: sql<number>`COUNT(CASE WHEN is_like = 1 THEN 1 END)`,
                dislikes: sql<number>`COUNT(CASE WHEN is_like = -1 THEN 1 END)`,
            })
            .from(schema.commentLikes)
            .where(eq(schema.commentLikes.commentId, commentId));

        const result = likesResult[0];
        return { 
            success: true, 
            likes: Number(result.likes) || 0, 
            dislikes: Number(result.dislikes) || 0 
        };
    } catch (error) {
        console.error("Error getting comment likes:", error);
        return { success: false, error: "Failed to get likes", code: 'get_likes_failed' };
    }
}

export async function closeDbConnection() {
    try {
        if (process.env.NODE_ENV === "test") {
            setTimeout(() => {
                client.end({ timeout: 10 }).catch(() => {});
            }, 200);
        } else {
            await client.end({ timeout: 10 });
        }
    } catch (error) {
        console.error("Error closing database connection:", error);
    }
}

export default db;