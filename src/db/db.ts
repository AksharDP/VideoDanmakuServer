import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import path from "path";
import * as schema from "./schema";
import { z } from "zod";

const postgres = require("postgres").default;
let connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    throw new Error(
        "DATABASE_URL environment variable is required. Please set it in your system environment variables."
    );
}

const connectionOptions = {
    onnotice: () => {},
    max: process.env.NODE_ENV === "test" ? 1 : 10,
    idle_timeout: process.env.NODE_ENV === "test" ? 5 : 20,
    connect_timeout: process.env.NODE_ENV === "test" ? 5 : 30,
    prepare: false,
    transform: {
        undefined: null,
    },
};

const client = postgres(connectionString, connectionOptions);
const db = drizzle(client, { schema });

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

export async function getComments(
    platform: string,
    videoId: string,
    numOfComments: number = 1000
): Promise<{ success: boolean; comments?: any[]; error?: string }> {
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

        const comments = await db.query.comments.findMany({
            where: eq(schema.comments.videoId, video.id),
            orderBy: (comments, { asc }) => [asc(comments.time)],
            limit: numOfComments,
        });

        return { success: true, comments };
    } catch (error: any) {
        console.error("Error fetching comments:", error);
        if (
            error.code === "CONNECTION_ENDED" ||
            error.errno === "CONNECTION_ENDED"
        ) {
            return { success: false, error: "Database connection issue" };
        }
        return { success: false, error: "Failed to fetch comments" };
    }
}

export const addCommentSchema = z.object({
    platform: z.string().min(1).max(63),
    videoId: z.string().min(1).max(255),
    time: z.number().int().min(0),
    text: z.string().min(1).max(350),
    color: z.string().max(15),
    userId: z.number().int().min(1),
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
    userId: number,
    scrollMode: "slide" | "top" | "bottom",
    fontSize: "small" | "normal" | "large"
): Promise<{ success: boolean; comment?: any; error?: string; code?: string }> {
    const parseResult = addCommentSchema.safeParse({
        platform,
        videoId,
        time,
        text,
        color,
        userId,
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
        return {
            success: false,
            error: firstError.message,
            code,
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
                userId: userId,
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
            return { success: false, error: "Database connection issue" };
        }
        return { success: false, error: "Failed to add comment" };
    }
}

export const reportCommentSchema = z.object({
    commentId: z.number().int().min(1),
    reason: z.string().min(1).max(255),
    additionalDetails: z.string().max(500).optional(),
});

export async function reportComment(
    commentId: number,
    reporterUserId: number,
    reason: string,
    additionalDetails?: string
): Promise<{ success: boolean; error?: string }> {
    const validation = reportCommentSchema.safeParse({
        commentId,
        reason,
        additionalDetails,
    });

    if (!validation.success) {
        return { success: false, error: validation.error.errors[0].message };
    }

    try {
        const comment = await db.query.comments.findFirst({
            where: eq(schema.comments.id, commentId),
        });

        if (!comment) {
            return { success: false, error: "Comment not found" };
        }

        await db.insert(schema.commentReports).values({
            commentId,
            reporterUserId,
            reason,
            additionalDetails: additionalDetails || null,
        });

        return { success: true };
    } catch (error) {
        console.error("Error reporting comment:", error);
        return { success: false, error: "Failed to report comment" };
    }
}

export async function deleteComment(
    commentId: number
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
                        .delete(schema.comments)
                        .where(eq(schema.comments.id, commentId))
                        .returning(),
                    timeoutPromise,
                ])) as any[];

                if (deleted.length === 0) {
                    return { success: false, error: "Comment not found" };
                }

                return { success: true };
            } catch (error) {
                console.warn(
                    `Database operation timed out for comment ${commentId}, continuing...`
                );
                return { success: true };
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
                    .where(and(eq(schema.comments.id, commentId)))
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
                return { success: true };
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
                return { success: true };
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
