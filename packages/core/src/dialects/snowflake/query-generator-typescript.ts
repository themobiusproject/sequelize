import { Op } from '../../operators.js';
import { rejectInvalidOptions } from '../../utils/check';
import { joinSQLFragments } from '../../utils/join-sql-fragments';
import { AbstractQueryGenerator } from '../abstract/query-generator';
import type { TableNameOrModel } from '../abstract/query-generator-typescript';
import {
  CREATE_DATABASE_QUERY_SUPPORTABLE_OPTIONS,
  LIST_DATABASES_QUERY_SUPPORTABLE_OPTIONS,
  SHOW_CONSTRAINTS_QUERY_SUPPORTABLE_OPTIONS,
  TRUNCATE_TABLE_QUERY_SUPPORTABLE_OPTIONS,
} from '../abstract/query-generator-typescript';
import type {
  CreateDatabaseQueryOptions,
  ListDatabasesQueryOptions,
  ListSchemasQueryOptions,
  ListTablesQueryOptions,
  ShowConstraintsQueryOptions,
  TruncateTableQueryOptions,
} from '../abstract/query-generator.types';
import { SnowflakeQueryGeneratorInternal } from './query-generator-internal.js';
import type { SnowflakeDialect } from './index.js';

const CREATE_DATABASE_QUERY_SUPPORTED_OPTIONS = new Set<keyof CreateDatabaseQueryOptions>([]);
const LIST_DATABASES_QUERY_SUPPORTED_OPTIONS = new Set<keyof ListDatabasesQueryOptions>([]);
const SHOW_CONSTRAINTS_QUERY_SUPPORTED_OPTIONS = new Set<keyof ShowConstraintsQueryOptions>(['constraintName', 'constraintType']);
const TRUNCATE_TABLE_QUERY_SUPPORTED_OPTIONS = new Set<keyof TruncateTableQueryOptions>();

/**
 * Temporary class to ease the TypeScript migration
 */
export class SnowflakeQueryGeneratorTypeScript extends AbstractQueryGenerator {
  readonly #internals: SnowflakeQueryGeneratorInternal;

  constructor(
    dialect: SnowflakeDialect,
    internals: SnowflakeQueryGeneratorInternal = new SnowflakeQueryGeneratorInternal(dialect),
  ) {
    super(dialect, internals);

    internals.whereSqlBuilder.setOperatorKeyword(Op.regexp, 'REGEXP');
    internals.whereSqlBuilder.setOperatorKeyword(Op.notRegexp, 'NOT REGEXP');

    this.#internals = internals;
  }

  createDatabaseQuery(database: string, options?: CreateDatabaseQueryOptions) {
    if (options) {
      rejectInvalidOptions(
        'createDatabaseQuery',
        this.dialect.name,
        CREATE_DATABASE_QUERY_SUPPORTABLE_OPTIONS,
        CREATE_DATABASE_QUERY_SUPPORTED_OPTIONS,
        options,
      );
    }

    return joinSQLFragments([
      `CREATE DATABASE IF NOT EXISTS ${this.quoteIdentifier(database)}`,
    ]);
  }

  listDatabasesQuery(options?: ListDatabasesQueryOptions) {
    if (options) {
      rejectInvalidOptions(
        'listDatabasesQuery',
        this.dialect.name,
        LIST_DATABASES_QUERY_SUPPORTABLE_OPTIONS,
        LIST_DATABASES_QUERY_SUPPORTED_OPTIONS,
        options,
      );
    }

    return `SHOW DATABASES`;
  }

  listSchemasQuery(options?: ListSchemasQueryOptions) {
    let schemasToSkip = this.#internals.getTechnicalSchemaNames();
    if (options && Array.isArray(options?.skip)) {
      schemasToSkip = [...schemasToSkip, ...options.skip];
    }

    return joinSQLFragments([
      'SELECT SCHEMA_NAME AS "schema"',
      'FROM INFORMATION_SCHEMA.SCHEMATA',
      `WHERE SCHEMA_NAME NOT IN (${schemasToSkip.map(schema => this.escape(schema)).join(', ')})`,
    ]);
  }

  describeTableQuery(tableName: TableNameOrModel) {
    return `SHOW FULL COLUMNS FROM ${this.quoteTable(tableName)};`;
  }

  listTablesQuery(options?: ListTablesQueryOptions) {
    return joinSQLFragments([
      'SELECT TABLE_NAME AS "tableName",',
      'TABLE_SCHEMA AS "schema"',
      `FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'`,
      options?.schema
        ? `AND TABLE_SCHEMA = ${this.escape(options.schema)}`
        : `AND TABLE_SCHEMA NOT IN (${this.#internals.getTechnicalSchemaNames().map(schema => this.escape(schema)).join(', ')})`,
      'ORDER BY TABLE_SCHEMA, TABLE_NAME',
    ]);
  }

  truncateTableQuery(tableName: TableNameOrModel, options?: TruncateTableQueryOptions) {
    if (options) {
      rejectInvalidOptions(
        'truncateTableQuery',
        this.dialect.name,
        TRUNCATE_TABLE_QUERY_SUPPORTABLE_OPTIONS,
        TRUNCATE_TABLE_QUERY_SUPPORTED_OPTIONS,
        options,
      );
    }

    return `TRUNCATE ${this.quoteTable(tableName)}`;
  }

  showConstraintsQuery(tableName: TableNameOrModel, options?: ShowConstraintsQueryOptions) {
    if (options) {
      rejectInvalidOptions(
        'showConstraintsQuery',
        this.dialect.name,
        SHOW_CONSTRAINTS_QUERY_SUPPORTABLE_OPTIONS,
        SHOW_CONSTRAINTS_QUERY_SUPPORTED_OPTIONS,
        options,
      );
    }

    const table = this.extractTableDetails(tableName);

    return joinSQLFragments([
      'SELECT c.CONSTRAINT_CATALOG AS constraintCatalog,',
      'c.CONSTRAINT_SCHEMA AS constraintSchema,',
      'c.CONSTRAINT_NAME AS constraintName,',
      'c.CONSTRAINT_TYPE AS constraintType,',
      'c.TABLE_CATALOG AS tableCatalog,',
      'c.TABLE_SCHEMA AS tableSchema,',
      'c.TABLE_NAME AS tableName,',
      'fk.TABLE_SCHEMA AS referencedTableSchema,',
      'fk.TABLE_NAME AS referencedTableName,',
      'r.DELETE_RULE AS deleteAction,',
      'r.UPDATE_RULE AS updateAction,',
      'c.IS_DEFERRABLE AS isDeferrable,',
      'c.INITIALLY_DEFERRED AS initiallyDeferred',
      'FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS c',
      'LEFT JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS r ON c.CONSTRAINT_CATALOG = r.CONSTRAINT_CATALOG AND c.CONSTRAINT_SCHEMA = r.CONSTRAINT_SCHEMA AND c.CONSTRAINT_NAME = r.CONSTRAINT_NAME',
      'LEFT JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS fk ON r.UNIQUE_CONSTRAINT_CATALOG = fk.CONSTRAINT_CATALOG AND r.UNIQUE_CONSTRAINT_SCHEMA = fk.CONSTRAINT_SCHEMA AND r.UNIQUE_CONSTRAINT_NAME = fk.CONSTRAINT_NAME',
      `WHERE c.TABLE_NAME = ${this.escape(table.tableName)}`,
      `AND c.TABLE_SCHEMA = ${this.escape(table.schema)}`,
      options?.constraintName ? `AND c.CONSTRAINT_NAME = ${this.escape(options.constraintName)}` : '',
      options?.constraintType ? `AND c.CONSTRAINT_TYPE = ${this.escape(options.constraintType)}` : '',
      'ORDER BY c.CONSTRAINT_NAME',
    ]);
  }

  showIndexesQuery() {
    // TODO [+snowflake-sdk]: check if this is the correct implementation
    return `SELECT '' FROM DUAL`;
  }

  versionQuery() {
    return 'SELECT CURRENT_VERSION() AS "version"';
  }
}
