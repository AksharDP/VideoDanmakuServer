import {
    pgTable,
    serial,
    varchar,
    timestamp,
    integer,
    unique,
    index,
    pgEnum,
    text,
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

export const users = pgTable(
    "users",
    {
        id: serial("id").primaryKey(),
        username: varchar("username", { length: 32 }).notNull(),
        email: varchar("email", { length: 254 }).notNull(),
        password: varchar("password", { length: 64 }).notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [
        unique("username_idx").on(table.username),
        unique("email_idx").on(table.email),
    ]
);

export const authTokens = pgTable(
    "auth_tokens",
    {
        id: serial("id").primaryKey(),
        userId: integer("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        token: text("token").notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        expiresAt: timestamp("expires_at"),
        lastUsedAt: timestamp("last_used_at").defaultNow().notNull(),
    },
    (table) => [unique("user_token").on(table.userId, table.token)]
);

export const videos = pgTable(
    "videos",
    {
        id: serial("id").primaryKey(),
        platform: varchar("platform", { length: 63 }).notNull(),
        videoId: varchar("video_id", { length: 255 }).notNull(),
    },
    (table) => [unique("platform_videoId").on(table.platform, table.videoId)]
);

export const comments = pgTable(
    "comments",
    {
        id: serial("id").primaryKey(),
        content: varchar("content", { length: 350 }).notNull(),
        time: integer("time").notNull(),
        userId: integer("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        videoId: integer("video_id")
            .notNull()
            .references(() => videos.id, { onDelete: "cascade" }),
        scrollMode: scrollModeEnum("scroll_mode").default("slide").notNull(),
        color: varchar("color", { length: 15 }),
        fontSize: fontSizeEnum("font_size").default("normal").notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [
        index("user_comments_idx").on(table.userId),
        index("video_comments_idx").on(table.videoId),
    ]
);

export const commentReports = pgTable(
    "comment_reports",
    {
        id: serial("id").primaryKey(),
        commentId: integer("comment_id")
            .notNull()
            .references(() => comments.id, { onDelete: "cascade" }),
        reporterUserId: integer("reporter_user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        reason: varchar("reason", { length: 255 }).notNull(),
        additionalDetails: text("additional_details"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [
        index("report_comment_idx").on(table.commentId),
        index("reporter_user_idx").on(table.reporterUserId),
    ]
);

export const usersRelations = relations(users, ({ many }) => ({
    comments: many(comments),
    reports: many(commentReports),
}));

export const videosRelations = relations(videos, ({ many }) => ({
    comments: many(comments),
}));

export const commentsRelations = relations(comments, ({ one, many }) => ({
    author: one(users, {
        fields: [comments.userId],
        references: [users.id],
    }),
    video: one(videos, {
        fields: [comments.videoId],
        references: [videos.id],
    }),
    reports: many(commentReports),
}));

export const commentReportsRelations = relations(commentReports, ({ one }) => ({
    comment: one(comments, {
        fields: [commentReports.commentId],
        references: [comments.id],
    }),
    reporter: one(users, {
        fields: [commentReports.reporterUserId],
        references: [users.id],
    }),
}));
