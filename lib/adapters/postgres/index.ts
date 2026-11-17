import { createRemoteAdapter } from "../remote";
export const postgresAdapter = createRemoteAdapter({
  engine: "postgres",
  displayName: "PostgreSQL",
  defaultPort: 5432,
  available: true,
});
