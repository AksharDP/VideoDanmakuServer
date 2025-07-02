import {
    pgTable,
    serial,
    varchar,
    timestamp,
    integer,
    unique,
    index,
    pgEnum,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const scrollModeEnum = pgEnum("scroll_mode_enum", [
    "slide",
    "top",
    "bottom",
]);
export const fontSizeEnum = pgEnum("font_size_enum", [
    "small",
    "normal",
    "large",
]);

// --- TABLES ---
export const users = pgTable(
    "users",
    {
        id: serial("id").primaryKey(),
        platform: varchar("platform", { length: 63 }).notNull(),
        username: varchar("username", { length: 255 }).notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [unique("platform_username").on(table.platform, table.username)]
);

export const videos = pgTable(
    "videos",
    {
        id: serial("id").primaryKey(),
        platform: varchar("platform", { length: 63 }).notNull(), // e.g., "youtube", "crunchyroll", "vimeo"
        videoId: varchar("video_id", { length: 255 }).notNull(),
    },
    (table) => [unique("platform_videoId").on(table.platform, table.videoId)]
);

export const comments = pgTable(
    "comments",
    {
        id: serial("id").primaryKey(),
        content: varchar("content", { length: 350 }).notNull(),
        time: integer("time").notNull(), // Video timestamp in seconds
        userId: integer("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        videoId: integer("video_id")
            .notNull()
            .references(() => videos.id, { onDelete: "cascade" }),
        scrollMode: scrollModeEnum("scroll_mode").default("slide").notNull(),
        color: varchar("color", { length: 15 }), // e.g., "#ff0000" for red, iridescent, neon, pastel, default null is white
        fontSize: fontSizeEnum("font_size").default("normal").notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [index("user_comments_idx").on(table.userId)]
);

// --- RELATIONS ---

export const usersRelations = relations(users, ({ many }) => ({
    comments: many(comments),
}));

export const videosRelations = relations(videos, ({ many }) => ({
    comments: many(comments),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
    author: one(users, {
        fields: [comments.userId],
        references: [users.id],
    }),
    video: one(videos, {
        fields: [comments.videoId],
        references: [videos.id],
    }),
}));
