import { createRemoteAdapter } from "../remote";
export const cassandraAdapter = createRemoteAdapter({ engine: "cassandra", displayName: "Cassandra", defaultPort: 9042 });
