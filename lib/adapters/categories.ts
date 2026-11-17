import type { ExtractionOptions, ObjectCategory } from "@/lib/schemas";

export interface CategoryMeta {
  category: ObjectCategory;
  /** Numbered bulk file at the root of each snapshot folder (PROJECT.md §3). */
  bulkFilename: string;
  /** Subfolder under `objects/` when `splitPerObject` is enabled. */
  objectFolder: string;
  label: string;
  optionKey: keyof ExtractionOptions;
}

export const CATEGORY_MAP: Record<ObjectCategory, CategoryMeta> = {
  tables: {
    category: "tables",
    bulkFilename: "01_tables.sql",
    objectFolder: "tables",
    label: "Tables",
    optionKey: "includeTables",
  },
  columns: {
    category: "columns",
    bulkFilename: "02_table_columns.sql",
    objectFolder: "columns",
    label: "Table columns",
    optionKey: "includeColumns",
  },
  primary_keys: {
    category: "primary_keys",
    bulkFilename: "03_primary_keys.sql",
    objectFolder: "primary_keys",
    label: "Primary keys",
    optionKey: "includeKeys",
  },
  foreign_keys: {
    category: "foreign_keys",
    bulkFilename: "04_foreign_keys.sql",
    objectFolder: "foreign_keys",
    label: "Foreign keys",
    optionKey: "includeKeys",
  },
  indexes: {
    category: "indexes",
    bulkFilename: "05_indexes.sql",
    objectFolder: "indexes",
    label: "Indexes",
    optionKey: "includeIndexes",
  },
  constraints: {
    category: "constraints",
    bulkFilename: "06_constraints.sql",
    objectFolder: "constraints",
    label: "Constraints",
    optionKey: "includeConstraints",
  },
  views: {
    category: "views",
    bulkFilename: "07_views.sql",
    objectFolder: "views",
    label: "Views",
    optionKey: "includeViews",
  },
  functions: {
    category: "functions",
    bulkFilename: "08_functions.sql",
    objectFolder: "functions",
    label: "Functions",
    optionKey: "includeFunctions",
  },
  procedures: {
    category: "procedures",
    bulkFilename: "09_stored_procedures.sql",
    objectFolder: "procedures",
    label: "Stored procedures",
    optionKey: "includeProcedures",
  },
  triggers: {
    category: "triggers",
    bulkFilename: "10_triggers.sql",
    objectFolder: "triggers",
    label: "Triggers",
    optionKey: "includeTriggers",
  },
  sequences: {
    category: "sequences",
    bulkFilename: "11_sequences.sql",
    objectFolder: "sequences",
    label: "Sequences",
    optionKey: "includeSequences",
  },
  synonyms: {
    category: "synonyms",
    bulkFilename: "12_synonyms.sql",
    objectFolder: "synonyms",
    label: "Synonyms",
    optionKey: "includeSynonyms",
  },
  schemas: {
    category: "schemas",
    bulkFilename: "13_schemas.sql",
    objectFolder: "schemas",
    label: "Schemas",
    optionKey: "includeSchemas",
  },
  roles: {
    category: "roles",
    bulkFilename: "14_users_roles.sql",
    objectFolder: "roles",
    label: "Users & roles",
    optionKey: "includeRoles",
  },
  extensions: {
    category: "extensions",
    bulkFilename: "15_extensions.sql",
    objectFolder: "extensions",
    label: "Extensions",
    optionKey: "includeSchemas",
  },
  collections: {
    category: "collections",
    bulkFilename: "16_collections.json",
    objectFolder: "collections",
    label: "Collections",
    optionKey: "includeTables",
  },
  table_data: {
    category: "table_data",
    bulkFilename: "20_data.sql",
    objectFolder: "data",
    label: "Table data",
    optionKey: "includeTableData",
  },
};
