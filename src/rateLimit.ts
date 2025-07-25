interface RateLimitEntry {
    count: number;
    lastReset: number;
    lastComment: number;
    lastRetrieval?: number;
}

interface UserIPMapping {
    username: string;
    ips: Set<string>;
    totalDailyComments: number;
    lastReset: number;
}

class RateLimiter {
    private ipLimits: Map<string, RateLimitEntry> = new Map();
    private userLimits: Map<string, RateLimitEntry> = new Map();
    private userIPMappings: Map<string, UserIPMapping> = new Map();

    private readonly DAILY_LIMIT: number;
    private readonly COMMENT_INTERVAL: number;
    private readonly RETRIEVAL_INTERVAL: number;
    private readonly DAY_IN_MS = 24 * 60 * 60 * 1000;

    constructor() {
        this.DAILY_LIMIT =
            process.env.NODE_ENV === "test"
                ? 100
                : Number(process.env.DAILY_LIMIT) || 100;
        this.COMMENT_INTERVAL =
            process.env.NODE_ENV === "test"
                ? 1000
                : Number(process.env.COMMENT_INTERVAL) || 5000;
        this.RETRIEVAL_INTERVAL =
            process.env.NODE_ENV === "test"
                ? 500
                : Number(process.env.RETRIEVAL_INTERVAL) || 1000;

        if (process.env.NODE_ENV !== "test") {
            setInterval(() => this.cleanup(), 60 * 60 * 1000);
        }
    }

    /**
     * Check if a comment can be posted based on rate limits
     * @param ip - The IP address of the requester
     * @param username - The username posting the comment
     * @returns Object with success flag and error message if rate limited
     */
    async checkRateLimit(
        ip: string,
        username: string
    ): Promise<{ allowed: boolean; error?: string }> {
        const now = Date.now();

        this.updateUserIPMapping(username, ip, now);

        const ipCheck = this.checkIPLimit(ip, now);
        if (!ipCheck.allowed) {
            return ipCheck;
        }

        const userCheck = this.checkUserLimit(username, now);
        if (!userCheck.allowed) {
            return userCheck;
        }

        const aggregationCheck = this.checkAggregationLimit(username, ip, now);
        if (!aggregationCheck.allowed) {
            return aggregationCheck;
        }

        return { allowed: true };
    }

    /**
     * Record a successful comment post
     * @param ip - The IP address of the requester
     * @param username - The username posting the comment
     */
    async recordComment(ip: string, username: string): Promise<void> {
        const now = Date.now();

        this.incrementIPCount(ip, now);

        this.incrementUserCount(username, now);

        this.incrementUserIPMappingCount(username, now);
    }

    private updateUserIPMapping(
        username: string,
        ip: string,
        now: number
    ): void {
        let mapping = this.userIPMappings.get(username);

        if (!mapping) {
            mapping = {
                username,
                ips: new Set([ip]),
                totalDailyComments: 0,
                lastReset: now,
            };
            this.userIPMappings.set(username, mapping);
        } else {
            if (now - mapping.lastReset >= this.DAY_IN_MS) {
                mapping.totalDailyComments = 0;
                mapping.lastReset = now;
            }

            mapping.ips.add(ip);
        }
    }

    private checkIPLimit(
        ip: string,
        now: number
    ): { allowed: boolean; error?: string } {
        let ipLimit = this.ipLimits.get(ip);

        if (!ipLimit) {
            ipLimit = {
                count: 0,
                lastReset: now,
                lastComment: 0,
                lastRetrieval: 0,
            };
            this.ipLimits.set(ip, ipLimit);
        }

        if (now - ipLimit.lastReset >= this.DAY_IN_MS) {
            ipLimit.count = 0;
            ipLimit.lastReset = now;
        }

        if (ipLimit.count >= this.DAILY_LIMIT) {
            const timeUntilReset = this.DAY_IN_MS - (now - ipLimit.lastReset);
            const hoursUntilReset = Math.ceil(
                timeUntilReset / (60 * 60 * 1000)
            );
            return {
                allowed: false,
                error: `IP daily limit exceeded. Try again in ${hoursUntilReset} hours.`,
            };
        }

        if (now - ipLimit.lastComment < this.COMMENT_INTERVAL) {
            const remainingTime = Math.ceil(
                (this.COMMENT_INTERVAL - (now - ipLimit.lastComment)) / 1000
            );
            return {
                allowed: false,
                error: `Please wait ${remainingTime} seconds before posting another comment.`,
            };
        }

        return { allowed: true };
    }

    private checkUserLimit(
        username: string,
        now: number
    ): { allowed: boolean; error?: string } {
        let userLimit = this.userLimits.get(username);

        if (!userLimit) {
            userLimit = {
                count: 0,
                lastReset: now,
                lastComment: 0,
                lastRetrieval: 0,
            };
            this.userLimits.set(username, userLimit);
        }

        if (now - userLimit.lastReset >= this.DAY_IN_MS) {
            userLimit.count = 0;
            userLimit.lastReset = now;
        }

        if (userLimit.count >= this.DAILY_LIMIT) {
            const timeUntilReset = this.DAY_IN_MS - (now - userLimit.lastReset);
            const hoursUntilReset = Math.ceil(
                timeUntilReset / (60 * 60 * 1000)
            );
            return {
                allowed: false,
                error: `Username daily limit exceeded. Try again in ${hoursUntilReset} hours.`,
            };
        }

        if (now - userLimit.lastComment < this.COMMENT_INTERVAL) {
            const remainingTime = Math.ceil(
                (this.COMMENT_INTERVAL - (now - userLimit.lastComment)) / 1000
            );
            return {
                allowed: false,
                error: `Please wait ${remainingTime} seconds before posting another comment.`,
            };
        }

        return { allowed: true };
    }

    private checkAggregationLimit(
        username: string,
        ip: string,
        now: number
    ): { allowed: boolean; error?: string } {
        const mapping = this.userIPMappings.get(username);
        if (!mapping || mapping.ips.size <= 1) {
            return { allowed: true };
        }

        const aggregatedCount = mapping.totalDailyComments;

        for (const associatedIP of mapping.ips) {
            const ipLimit = this.ipLimits.get(associatedIP);
            if (ipLimit) {
                if (now - ipLimit.lastReset >= this.DAY_IN_MS) {
                    ipLimit.count = 0;
                    ipLimit.lastReset = now;
                }

                const effectiveCount = ipLimit.count + aggregatedCount;
                if (effectiveCount >= this.DAILY_LIMIT) {
                    const timeUntilReset =
                        this.DAY_IN_MS - (now - ipLimit.lastReset);
                    const hoursUntilReset = Math.ceil(
                        timeUntilReset / (60 * 60 * 1000)
                    );
                    return {
                        allowed: false,
                        error: `Cross-IP limit exceeded for username. This username has been used from multiple IPs. Try again in ${hoursUntilReset} hours.`,
                    };
                }
            }
        }

        return { allowed: true };
    }

    private incrementIPCount(ip: string, now: number): void {
        const ipLimit = this.ipLimits.get(ip)!;
        ipLimit.count++;
        ipLimit.lastComment = now;
    }

    private incrementUserCount(username: string, now: number): void {
        const userLimit = this.userLimits.get(username)!;
        userLimit.count++;
        userLimit.lastComment = now;
    }

    private incrementUserIPMappingCount(username: string, now: number): void {
        const mapping = this.userIPMappings.get(username)!;
        mapping.totalDailyComments++;
    }

    /**
     * Check if comments can be retrieved based on rate limits (1 request per second)
     * @param ip - The IP address of the requester
     * @param username - The username requesting comments (optional)
     * @returns Object with success flag and error message if rate limited
     */
    async checkRetrievalRateLimit(
        ip: string,
        username?: string
    ): Promise<{ allowed: boolean; error?: string }> {
        const now = Date.now();

        const ipCheck = this.checkIPRetrievalLimit(ip, now);
        if (!ipCheck.allowed) {
            return ipCheck;
        }

        if (username) {
            this.updateUserIPMapping(username, ip, now);

            const userCheck = this.checkUserRetrievalLimit(username, now);
            if (!userCheck.allowed) {
                return userCheck;
            }

            const aggregationCheck = this.checkRetrievalAggregationLimit(
                username,
                ip,
                now
            );
            if (!aggregationCheck.allowed) {
                return aggregationCheck;
            }
        }

        return { allowed: true };
    }

    /**
     * Record a successful comment retrieval
     * @param ip - The IP address of the requester
     * @param username - The username requesting comments (optional)
     */
    async recordRetrieval(ip: string, username?: string): Promise<void> {
        const now = Date.now();

        this.updateIPRetrievalTime(ip, now);

        if (username) {
            this.updateUserRetrievalTime(username, now);
        }
    }

    private checkIPRetrievalLimit(
        ip: string,
        now: number
    ): { allowed: boolean; error?: string } {
        let ipLimit = this.ipLimits.get(ip);

        if (!ipLimit) {
            ipLimit = {
                count: 0,
                lastReset: now,
                lastComment: 0,
                lastRetrieval: 0,
            };
            this.ipLimits.set(ip, ipLimit);
        }

        if (
            ipLimit.lastRetrieval &&
            now - ipLimit.lastRetrieval < this.RETRIEVAL_INTERVAL
        ) {
            const remainingTime = Math.ceil(
                (this.RETRIEVAL_INTERVAL - (now - ipLimit.lastRetrieval)) / 1000
            );
            return {
                allowed: false,
                error: `Please wait ${remainingTime} second(s) before requesting comments again.`,
            };
        }

        return { allowed: true };
    }

    private checkUserRetrievalLimit(
        username: string,
        now: number
    ): { allowed: boolean; error?: string } {
        let userLimit = this.userLimits.get(username);

        if (!userLimit) {
            userLimit = {
                count: 0,
                lastReset: now,
                lastComment: 0,
                lastRetrieval: 0,
            };
            this.userLimits.set(username, userLimit);
        }

        if (
            userLimit.lastRetrieval &&
            now - userLimit.lastRetrieval < this.RETRIEVAL_INTERVAL
        ) {
            const remainingTime = Math.ceil(
                (this.RETRIEVAL_INTERVAL - (now - userLimit.lastRetrieval)) /
                    1000
            );
            return {
                allowed: false,
                error: `Please wait ${remainingTime} second(s) before requesting comments again.`,
            };
        }

        return { allowed: true };
    }

    private checkRetrievalAggregationLimit(
        username: string,
        ip: string,
        now: number
    ): { allowed: boolean; error?: string } {
        const mapping = this.userIPMappings.get(username);
        if (!mapping || mapping.ips.size <= 1) {
            return { allowed: true };
        }

        for (const associatedIP of mapping.ips) {
            const ipLimit = this.ipLimits.get(associatedIP);
            if (
                ipLimit &&
                ipLimit.lastRetrieval &&
                now - ipLimit.lastRetrieval < this.RETRIEVAL_INTERVAL
            ) {
                const remainingTime = Math.ceil(
                    (this.RETRIEVAL_INTERVAL - (now - ipLimit.lastRetrieval)) /
                        1000
                );
                return {
                    allowed: false,
                    error: `Cross-IP retrieval limit: This username was recently used from another IP. Please wait ${remainingTime} second(s).`,
                };
            }
        }

        return { allowed: true };
    }

    private updateIPRetrievalTime(ip: string, now: number): void {
        let ipLimit = this.ipLimits.get(ip);
        if (!ipLimit) {
            ipLimit = {
                count: 0,
                lastReset: now,
                lastComment: 0,
                lastRetrieval: now,
            };
            this.ipLimits.set(ip, ipLimit);
        } else {
            ipLimit.lastRetrieval = now;
        }
    }

    private updateUserRetrievalTime(username: string, now: number): void {
        let userLimit = this.userLimits.get(username);
        if (!userLimit) {
            userLimit = {
                count: 0,
                lastReset: now,
                lastComment: 0,
                lastRetrieval: now,
            };
            this.userLimits.set(username, userLimit);
        } else {
            userLimit.lastRetrieval = now;
        }
    }

    /**
     * Clean up old entries to prevent memory leaks
     */
    private cleanup(): void {
        const now = Date.now();
        const dayAgo = now - this.DAY_IN_MS;

        for (const [ip, limit] of this.ipLimits.entries()) {
            if (limit.lastReset < dayAgo && limit.lastComment < dayAgo) {
                this.ipLimits.delete(ip);
            }
        }

        for (const [username, limit] of this.userLimits.entries()) {
            if (limit.lastReset < dayAgo && limit.lastComment < dayAgo) {
                this.userLimits.delete(username);
            }
        }

        for (const [username, mapping] of this.userIPMappings.entries()) {
            if (mapping.lastReset < dayAgo) {
                this.userIPMappings.delete(username);
            }
        }

        console.log(
            `Rate limiter cleanup completed. Active entries: IP=${this.ipLimits.size}, User=${this.userLimits.size}, Mappings=${this.userIPMappings.size}`
        );
    }

    /**
     * Get current rate limit status for debugging
     */
    getStatus(ip?: string, username?: string) {
        const status: any = {
            totalIPs: this.ipLimits.size,
            totalUsers: this.userLimits.size,
            totalMappings: this.userIPMappings.size,
        };

        if (ip && this.ipLimits.has(ip)) {
            status.ipStatus = this.ipLimits.get(ip);
        }

        if (username && this.userLimits.has(username)) {
            status.userStatus = this.userLimits.get(username);
        }

        if (username && this.userIPMappings.has(username)) {
            const mapping = this.userIPMappings.get(username)!;
            status.userMapping = {
                ...mapping,
                ips: Array.from(mapping.ips),
            };
        }

        return status;
    }

    /**
     * Reset all rate limiting data - for test use only
     */
    resetForTests() {
        if (process.env.NODE_ENV !== "test") {
            throw new Error("resetForTests() can only be called in test environment");
        }
        
        this.ipLimits.clear();
        this.userLimits.clear();
        this.userIPMappings.clear();
    }
}

const rateLimiter = new RateLimiter();

export { rateLimiter };
export type { RateLimitEntry, UserIPMapping };
