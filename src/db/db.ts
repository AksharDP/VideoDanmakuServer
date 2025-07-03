import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import path from "path";
import * as schema from "./schema";

const postgres = require("postgres").default;
let connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    throw new Error(
        "DATABASE_URL environment variable is required. Please set it in your system environment variables."
    );
}

// Configure connection with better error handling for tests
const connectionOptions = {
    onnotice: () => {}, // Suppress notices in tests
    max: process.env.NODE_ENV === "test" ? 2 : 10, // Use fewer connections in test
    idle_timeout: process.env.NODE_ENV === "test" ? 10 : 20, // Minimum 10 seconds to avoid negative timeouts
    connect_timeout: process.env.NODE_ENV === "test" ? 10 : 30, // Increased for more reliable connections
    transform: {
        undefined: null, // Transform undefined to null for better compatibility
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
    videoId: string
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
        });

        return { success: true, comments };
    } catch (error: any) {
        console.error("Error fetching comments:", error);
        if (error.code === "CONNECTION_ENDED" || error.errno === "CONNECTION_ENDED") {
            return { success: false, error: "Database connection issue" };
        }
        return { success: false, error: "Failed to fetch comments" };
    }
}

export async function addComment(
    platform: string,
    videoId: string,
    time: number,
    text: string,
    color: string,
    userId: number,
    scrollMode: "slide" | "top" | "bottom",
    fontSize: "small" | "normal" | "large"
): Promise<{ success: boolean; comment?: any; error?: string }> {
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
        if (error.code === "CONNECTION_ENDED" || error.errno === "CONNECTION_ENDED") {
            return { success: false, error: "Database connection issue" };
        }
        return { success: false, error: "Failed to add comment" };
    }
}



export async function closeDbConnection() {
    try {
        if (process.env.NODE_ENV === "test") {
            // In test environment, close connection gracefully with longer timeout
            setTimeout(() => {
                client.end({ timeout: 10 }).catch(() => {
                    // Ignore errors during test cleanup
                });
            }, 200);
        } else {
            await client.end({ timeout: 10 });
        }
    } catch (error) {
        console.error("Error closing database connection:", error);
    }
}

export default db;
