import "hono";
import { users } from "../db/schema";

type User = typeof users.$inferSelect;

declare module "hono" {
    interface ContextVariableMap {
        user: User;
    }
}
