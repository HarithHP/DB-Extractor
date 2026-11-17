import { createRemoteAdapter } from "../remote";
export const redisAdapter = createRemoteAdapter({ engine: "redis", displayName: "Redis", defaultPort: 6379 });
