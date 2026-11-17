import { createRemoteAdapter } from "../remote";
export const oracleAdapter = createRemoteAdapter({ engine: "oracle", displayName: "Oracle", defaultPort: 1521 });
