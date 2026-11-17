import { createRemoteAdapter } from "../remote";
export const mysqlAdapter = createRemoteAdapter({ engine: "mysql", displayName: "MySQL", defaultPort: 3306, available: true });
export const mariadbAdapter = createRemoteAdapter({ engine: "mariadb", displayName: "MariaDB", defaultPort: 3306, available: true });
