import { cassandraAdapter } from "./cassandra";
import { mongodbAdapter } from "./mongodb";
import { mssqlAdapter } from "./mssql";
import { mariadbAdapter, mysqlAdapter } from "./mysql";
import { oracleAdapter } from "./oracle";
import { postgresAdapter } from "./postgres";
import { redisAdapter } from "./redis";
import { sqliteAdapter } from "./sqlite";
import type { DbAdapter } from "./types";
import type { EngineId } from "@/lib/schemas";

export const registry: Record<EngineId, DbAdapter> = {
  sqlite: sqliteAdapter,
  postgres: postgresAdapter,
  mysql: mysqlAdapter,
  mariadb: mariadbAdapter,
  mssql: mssqlAdapter,
  oracle: oracleAdapter,
  mongodb: mongodbAdapter,
  redis: redisAdapter,
  cassandra: cassandraAdapter,
};

export const ADAPTER_LIST: DbAdapter[] = Object.values(registry);
