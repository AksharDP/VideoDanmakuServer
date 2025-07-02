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

const client = postgres(connectionString);
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

export async function createTestSchema() {
    try {
        await db.execute(
            sql`CREATE TYPE scroll_mode_enum AS ENUM('slide', 'top', 'bottom');`
        );
        await db.execute(
            sql`CREATE TYPE font_size_enum AS ENUM('small', 'normal', 'large');`
        );

        await db.execute(sql`
            CREATE TABLE users (
                id serial PRIMARY KEY NOT NULL,
                platform varchar(63) NOT NULL,
                username varchar(255) NOT NULL,
                created_at timestamp DEFAULT now() NOT NULL,
                CONSTRAINT platform_username UNIQUE(platform, username)
            );
        `);

        await db.execute(sql`
            CREATE TABLE videos (
                id serial PRIMARY KEY NOT NULL,
                platform varchar(63) NOT NULL,
                video_id varchar(255) NOT NULL,
                CONSTRAINT platform_videoId UNIQUE(platform, video_id)
            );
        `);

        await db.execute(sql`
            CREATE TABLE comments (
                id serial PRIMARY KEY NOT NULL,
                content varchar(350) NOT NULL,
                time integer NOT NULL,
                user_id integer NOT NULL,
                video_id integer NOT NULL,
                scroll_mode scroll_mode_enum DEFAULT 'slide' NOT NULL,
                color varchar(15),
                font_size font_size_enum DEFAULT 'normal' NOT NULL,
                created_at timestamp DEFAULT now() NOT NULL
            );
        `);

        await db.execute(sql`
            ALTER TABLE comments 
            ADD CONSTRAINT comments_user_id_users_id_fk 
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE cascade;
        `);

        await db.execute(sql`
            ALTER TABLE comments 
            ADD CONSTRAINT comments_video_id_videos_id_fk 
            FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE cascade;
        `);

        await db.execute(
            sql`CREATE INDEX user_comments_idx ON comments USING btree (user_id);`
        );
    } catch (error) {
        console.error("Error creating test schema:", error);
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
    } catch (error) {
        console.error("Error fetching comments:", error);
        throw new Error("Failed to fetch comments");
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
    } catch (error) {
        console.error("Error adding comment:", error);
        throw new Error("Failed to add comment");
    }
}

export async function clearDatabase() {
    try {
        await db.execute(
            sql`TRUNCATE TABLE comments, users, videos RESTART IDENTITY CASCADE;`
        );
    } catch (error) {
    }
}

export async function dropAndRecreateSchema() {
    try {
        await db.execute(sql`DROP TABLE IF EXISTS comments CASCADE;`);
        await db.execute(sql`DROP TABLE IF EXISTS videos CASCADE;`);
        await db.execute(sql`DROP TABLE IF EXISTS users CASCADE;`);
        await db.execute(sql`DROP TYPE IF EXISTS scroll_mode_enum CASCADE;`);
        await db.execute(sql`DROP TYPE IF EXISTS font_size_enum CASCADE;`);

        await createTestSchema();
    } catch (error) {
        console.error("Error dropping and recreating schema:", error);
        throw error;
    }
}

export async function closeDbConnection() {
    try {
        await client.end();
    } catch (error) {
        console.error("Error closing database connection:", error);
    }
}

export default db;
