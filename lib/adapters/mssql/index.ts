import { createRemoteAdapter } from "../remote";
export const mssqlAdapter = createRemoteAdapter({ engine: "mssql", displayName: "SQL Server", defaultPort: 1433, available: true });
