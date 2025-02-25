import { AsyncLocalStorage } from 'node:async_hooks';
import { initDecoratedAssociations } from './decorators/legacy/associations.js';
import { initDecoratedModel } from './decorators/shared/model.js';
import type { AbstractConnectionManager, Connection, GetConnectionOptions } from './dialects/abstract/connection-manager.js';
import { normalizeDataType, validateDataType } from './dialects/abstract/data-types-utils.js';
import type { AbstractDataType } from './dialects/abstract/data-types.js';
import type { AbstractDialect } from './dialects/abstract/index.js';
import type { EscapeOptions } from './dialects/abstract/query-generator-typescript.js';
import type { QiDropAllSchemasOptions } from './dialects/abstract/query-interface.types.js';
import type { AbstractQuery } from './dialects/abstract/query.js';
import {
  legacyBuildAddAnyHook,
  legacyBuildAddHook,
  legacyBuildHasHook,
  legacyBuildRemoveHook,
  legacyBuildRunHook,
} from './hooks-legacy.js';
import type { AsyncHookReturn, HookHandler } from './hooks.js';
import { HookHandlerBuilder } from './hooks.js';
import type { ModelHooks } from './model-hooks.js';
import { validModelHooks } from './model-hooks.js';
import { setTransactionFromCls } from './model-internals.js';
import type { ModelManager } from './model-manager.js';
import type { ConnectionOptions, NormalizedOptions, Options, QueryRawOptions, Sequelize } from './sequelize.js';
import type { ManagedTransactionOptions, TransactionOptions } from './transaction.js';
import {
  Transaction,
  TransactionNestMode,
  assertTransactionIsCompatibleWithOptions,
  normalizeTransactionOptions,
} from './transaction.js';
import { isNullish, isString } from './utils/check.js';
import { showAllToListSchemas } from './utils/deprecations.js';
import type { PartialBy } from './utils/types.js';
import type {
  CreateSchemaOptions,
  DataType,
  DataTypeClassOrInstance,
  DestroyOptions,
  ModelAttributes,
  ModelOptions,
  ModelStatic,
  QiListSchemasOptions,
  QueryOptions,
  SyncOptions,
  TruncateOptions,
} from '.';

export interface SequelizeHooks extends ModelHooks {
  /**
   * A hook that is run at the start of {@link Sequelize#define} and {@link Model.init}
   */
  beforeDefine(attributes: ModelAttributes<any>, options: ModelOptions): void;

  /**
   * A hook that is run at the end of {@link Sequelize#define} and {@link Model.init}
   */
  afterDefine(model: ModelStatic): void;

  /**
   * A hook that is run before a connection is created
   */
  beforeConnect(config: ConnectionOptions): AsyncHookReturn;

  /**
   * A hook that is run after a connection is created
   */
  afterConnect(connection: Connection, config: ConnectionOptions): AsyncHookReturn;

  /**
   * A hook that is run before a connection is disconnected
   */
  beforeDisconnect(connection: Connection): AsyncHookReturn;

  /**
   * A hook that is run after a connection is disconnected
   */
  afterDisconnect(connection: unknown): AsyncHookReturn;
  beforeQuery(options: QueryOptions, query: AbstractQuery): AsyncHookReturn;
  afterQuery(options: QueryOptions, query: AbstractQuery): AsyncHookReturn;

  /**
   * A hook that is run at the start of {@link Sequelize#sync}
   */
  beforeBulkSync(options: SyncOptions): AsyncHookReturn;

  /**
   * A hook that is run at the end of {@link Sequelize#sync}
   */
  afterBulkSync(options: SyncOptions): AsyncHookReturn;

  /**
   * A hook that is run before a connection to the pool
   */
  beforePoolAcquire(options?: GetConnectionOptions): AsyncHookReturn;

  /**
   * A hook that is run after a connection to the pool
   */
  afterPoolAcquire(connection: Connection, options?: GetConnectionOptions): AsyncHookReturn;
}

export interface StaticSequelizeHooks {
  /**
   * A hook that is run at the beginning of the creation of a Sequelize instance.
   */
  beforeInit(options: Options): void;

  /**
   * A hook that is run at the end of the creation of a Sequelize instance.
   */
  afterInit(sequelize: Sequelize): void;
}

export interface SequelizeTruncateOptions extends TruncateOptions {
  /**
   * Most dialects will not allow you to truncate a table while other tables have foreign key references to it (even if they are empty).
   * This option will disable those checks while truncating all tables, and re-enable them afterwards.
   *
   * This option is currently only supported for MySQL, SQLite, and MariaDB.
   *
   * Postgres can use {@link TruncateOptions.cascade} to achieve a similar goal.
   *
   * If you're experiencing this problem in other dialects, consider using {@link Sequelize.destroyAll} instead.
   */
  withoutForeignKeyChecks?: boolean;
}

export interface WithConnectionOptions extends PartialBy<GetConnectionOptions, 'type'> {
  /**
   * Close the connection when the callback finishes instead of returning it to the pool.
   * This is useful if you want to ensure that the connection is not reused,
   * for example if you ran queries that changed session options.
   */
  destroyConnection?: boolean;
}

const staticSequelizeHooks = new HookHandlerBuilder<StaticSequelizeHooks>([
  'beforeInit', 'afterInit',
]);

const instanceSequelizeHooks = new HookHandlerBuilder<SequelizeHooks>([
  'beforeQuery', 'afterQuery',
  'beforeBulkSync', 'afterBulkSync',
  'beforeConnect', 'afterConnect',
  'beforeDisconnect', 'afterDisconnect',
  'beforeDefine', 'afterDefine',
  'beforePoolAcquire', 'afterPoolAcquire',
  ...validModelHooks,
]);

type TransactionCallback<T> = (t: Transaction) => PromiseLike<T> | T;
type SessionCallback<T> = (connection: Connection) => PromiseLike<T> | T;

export const SUPPORTED_DIALECTS = Object.freeze(['mysql', 'postgres', 'sqlite', 'mariadb', 'mssql', 'mariadb', 'mssql', 'db2', 'snowflake', 'ibmi'] as const);

// DO NOT MAKE THIS CLASS PUBLIC!
/**
 * This is a temporary class used to progressively migrate the Sequelize class to TypeScript by slowly moving its functions here.
 * Always use {@link Sequelize} instead.
 */
export abstract class SequelizeTypeScript {
  // created by the Sequelize subclass. Will eventually be migrated here.
  abstract readonly modelManager: ModelManager;
  abstract readonly dialect: AbstractDialect;
  declare readonly connectionManager: AbstractConnectionManager;
  declare readonly options: NormalizedOptions;

  static get hooks(): HookHandler<StaticSequelizeHooks> {
    return staticSequelizeHooks.getFor(this);
  }

  static addHook = legacyBuildAddAnyHook(staticSequelizeHooks);
  static removeHook = legacyBuildRemoveHook(staticSequelizeHooks);
  static hasHook = legacyBuildHasHook(staticSequelizeHooks);
  static hasHooks = legacyBuildHasHook(staticSequelizeHooks);
  static runHooks = legacyBuildRunHook(staticSequelizeHooks);

  static beforeInit = legacyBuildAddHook(staticSequelizeHooks, 'beforeInit');
  static afterInit = legacyBuildAddHook(staticSequelizeHooks, 'afterInit');

  get hooks(): HookHandler<SequelizeHooks> {
    return instanceSequelizeHooks.getFor(this);
  }

  addHook = legacyBuildAddAnyHook(instanceSequelizeHooks);
  removeHook = legacyBuildRemoveHook(instanceSequelizeHooks);
  hasHook = legacyBuildHasHook(instanceSequelizeHooks);
  hasHooks = legacyBuildHasHook(instanceSequelizeHooks);
  runHooks = legacyBuildRunHook(instanceSequelizeHooks);

  beforeQuery = legacyBuildAddHook(instanceSequelizeHooks, 'beforeQuery');
  afterQuery = legacyBuildAddHook(instanceSequelizeHooks, 'afterQuery');

  beforeBulkSync = legacyBuildAddHook(instanceSequelizeHooks, 'beforeBulkSync');
  afterBulkSync = legacyBuildAddHook(instanceSequelizeHooks, 'afterBulkSync');

  beforeConnect = legacyBuildAddHook(instanceSequelizeHooks, 'beforeConnect');
  afterConnect = legacyBuildAddHook(instanceSequelizeHooks, 'afterConnect');

  beforeDisconnect = legacyBuildAddHook(instanceSequelizeHooks, 'beforeDisconnect');
  afterDisconnect = legacyBuildAddHook(instanceSequelizeHooks, 'afterDisconnect');

  beforeDefine = legacyBuildAddHook(instanceSequelizeHooks, 'beforeDefine');
  afterDefine = legacyBuildAddHook(instanceSequelizeHooks, 'afterDefine');

  beforePoolAcquire = legacyBuildAddHook(instanceSequelizeHooks, 'beforePoolAcquire');
  afterPoolAcquire = legacyBuildAddHook(instanceSequelizeHooks, 'afterPoolAcquire');

  beforeValidate = legacyBuildAddHook(instanceSequelizeHooks, 'beforeValidate');
  afterValidate = legacyBuildAddHook(instanceSequelizeHooks, 'afterValidate');
  validationFailed = legacyBuildAddHook(instanceSequelizeHooks, 'validationFailed');

  beforeCreate = legacyBuildAddHook(instanceSequelizeHooks, 'beforeCreate');
  afterCreate = legacyBuildAddHook(instanceSequelizeHooks, 'afterCreate');

  beforeDestroy = legacyBuildAddHook(instanceSequelizeHooks, 'beforeDestroy');
  afterDestroy = legacyBuildAddHook(instanceSequelizeHooks, 'afterDestroy');

  beforeRestore = legacyBuildAddHook(instanceSequelizeHooks, 'beforeRestore');
  afterRestore = legacyBuildAddHook(instanceSequelizeHooks, 'afterRestore');

  beforeUpdate = legacyBuildAddHook(instanceSequelizeHooks, 'beforeUpdate');
  afterUpdate = legacyBuildAddHook(instanceSequelizeHooks, 'afterUpdate');

  beforeUpsert = legacyBuildAddHook(instanceSequelizeHooks, 'beforeUpsert');
  afterUpsert = legacyBuildAddHook(instanceSequelizeHooks, 'afterUpsert');

  beforeSave = legacyBuildAddHook(instanceSequelizeHooks, 'beforeSave');
  afterSave = legacyBuildAddHook(instanceSequelizeHooks, 'afterSave');

  beforeBulkCreate = legacyBuildAddHook(instanceSequelizeHooks, 'beforeBulkCreate');
  afterBulkCreate = legacyBuildAddHook(instanceSequelizeHooks, 'afterBulkCreate');

  beforeBulkDestroy = legacyBuildAddHook(instanceSequelizeHooks, 'beforeBulkDestroy');
  afterBulkDestroy = legacyBuildAddHook(instanceSequelizeHooks, 'afterBulkDestroy');

  beforeBulkRestore = legacyBuildAddHook(instanceSequelizeHooks, 'beforeBulkRestore');
  afterBulkRestore = legacyBuildAddHook(instanceSequelizeHooks, 'afterBulkRestore');

  beforeBulkUpdate = legacyBuildAddHook(instanceSequelizeHooks, 'beforeBulkUpdate');
  afterBulkUpdate = legacyBuildAddHook(instanceSequelizeHooks, 'afterBulkUpdate');

  beforeCount = legacyBuildAddHook(instanceSequelizeHooks, 'beforeCount');

  beforeFind = legacyBuildAddHook(instanceSequelizeHooks, 'beforeFind');
  beforeFindAfterExpandIncludeAll = legacyBuildAddHook(instanceSequelizeHooks, 'beforeFindAfterExpandIncludeAll');
  beforeFindAfterOptions = legacyBuildAddHook(instanceSequelizeHooks, 'beforeFindAfterOptions');
  afterFind = legacyBuildAddHook(instanceSequelizeHooks, 'afterFind');

  beforeSync = legacyBuildAddHook(instanceSequelizeHooks, 'beforeSync');
  afterSync = legacyBuildAddHook(instanceSequelizeHooks, 'afterSync');

  beforeAssociate = legacyBuildAddHook(instanceSequelizeHooks, 'beforeAssociate');
  afterAssociate = legacyBuildAddHook(instanceSequelizeHooks, 'afterAssociate');

  #transactionCls: AsyncLocalStorage<Transaction> | undefined;

  /**
   * The QueryInterface instance, dialect dependant.
   */
  get queryInterface() {
    return this.dialect.queryInterface;
  }

  /**
   * The QueryGenerator instance, dialect dependant.
   */
  get queryGenerator() {
    return this.dialect.queryGenerator;
  }

  private _setupTransactionCls() {
    this.#transactionCls = new AsyncLocalStorage<Transaction>();
  }

  addModels(models: ModelStatic[]) {
    const registeredModels = models.filter(model => initDecoratedModel(
      model,
      // @ts-expect-error -- remove once this class has been merged back with the Sequelize class
      this,
    ));

    for (const model of registeredModels) {
      initDecoratedAssociations(
        model,
        // @ts-expect-error -- remove once this class has been merged back with the Sequelize class
        this,
      );
    }
  }

  /**
   * Escape value to be used in raw SQL.
   *
   * If you are using this to use the value in a {@link literal}, consider using {@link sql} instead, which automatically
   * escapes interpolated values.
   *
   * @param value The value to escape
   * @param options
   */
  escape(value: unknown, options?: EscapeOptions) {
    return this.dialect.queryGenerator.escape(value, options);
  }

  /**
   * Returns the transaction that is associated to the current asynchronous operation.
   * This method returns undefined if no transaction is active in the current asynchronous operation,
   * or if {@link Options.disableClsTransactions} is true.
   */
  getCurrentClsTransaction(): Transaction | undefined {
    return this.#transactionCls?.getStore();
  }

  /**
   * Start a managed transaction: Sequelize will create a transaction, pass it to your callback, and commit
   * it once the promise returned by your callback resolved, or execute a rollback if the promise rejects.
   *
   * ```ts
   * try {
   *   await sequelize.transaction(() => {
   *     const user = await User.findOne(...);
   *     await user.update(...);
   *   });
   *
   *   // By now, the transaction has been committed
   * } catch {
   *   // If the transaction callback threw an error, the transaction has been rolled back
   * }
   * ```
   *
   * By default, Sequelize uses AsyncLocalStorage to automatically pass the transaction to all queries executed inside the callback (unless you already pass one or set the `transaction` option to null).
   * This can be disabled by setting {@link Options.disableClsTransactions} to true. You will then need to pass transactions to your queries manually.
   *
   * ```ts
   * const sequelize = new Sequelize({
   *   // ...
   *   disableClsTransactions: true,
   * })
   *
   * await sequelize.transaction(transaction => {
   *   // transactions are not automatically passed around anymore, you need to do it yourself:
   *   const user = await User.findOne(..., { transaction });
   *   await user.update(..., { transaction });
   * });
   * ```
   *
   * If you want to manage your transaction yourself, use {@link startUnmanagedTransaction}.
   *
   * @param callback Async callback during which the transaction will be active
   */
  transaction<T>(callback: TransactionCallback<T>): Promise<T>;
  /**
   * @param options Transaction Options
   * @param callback Async callback during which the transaction will be active
   */
  transaction<T>(options: ManagedTransactionOptions, callback: TransactionCallback<T>): Promise<T>;
  async transaction<T>(
    optionsOrCallback: ManagedTransactionOptions | TransactionCallback<T>,
    maybeCallback?: TransactionCallback<T>,
  ): Promise<T> {
    let options: ManagedTransactionOptions;
    let callback: TransactionCallback<T>;
    if (typeof optionsOrCallback === 'function') {
      callback = optionsOrCallback;
      options = {};
    } else {
      callback = maybeCallback!;
      options = optionsOrCallback;
    }

    if (!callback) {
      throw new Error('sequelize.transaction requires a callback. If you wish to start an unmanaged transaction, please use sequelize.startUnmanagedTransaction instead');
    }

    const nestMode: TransactionNestMode = options.nestMode ?? this.options.defaultTransactionNestMode;

    // @ts-expect-error -- will be fixed once this class has been merged back with the Sequelize class
    const normalizedOptions = normalizeTransactionOptions(this, options);

    if (nestMode === TransactionNestMode.separate) {
      delete normalizedOptions.transaction;
    } else {
      // @ts-expect-error -- will be fixed once this class has been merged back with the Sequelize class
      setTransactionFromCls(normalizedOptions, this);

      // in reuse & savepoint mode,
      // we use the same transaction, so we need to make sure it's compatible with the requested options
      if (normalizedOptions.transaction) {
        assertTransactionIsCompatibleWithOptions(normalizedOptions.transaction, normalizedOptions);
      }
    }

    const transaction = nestMode === TransactionNestMode.reuse && normalizedOptions.transaction
      ? normalizedOptions.transaction
      : new Transaction(
        // @ts-expect-error -- will be fixed once this class has been merged back with the Sequelize class
        this,
        normalizedOptions,
      );

    const isReusedTransaction = transaction === normalizedOptions.transaction;

    const wrappedCallback = async () => {
      // We did not create this transaction, so we're not responsible for managing it.
      if (isReusedTransaction) {
        return callback(transaction);
      }

      await transaction.prepareEnvironment();

      let result;
      try {
        result = await callback(transaction);
      } catch (error) {
        try {
          await transaction.rollback();
        } catch {
          // ignore, because 'rollback' will already print the error before killing the connection
        }

        throw error;
      }

      await transaction.commit();

      return result;
    };

    const cls = this.#transactionCls;
    if (!cls) {
      return wrappedCallback();
    }

    return cls.run(transaction, wrappedCallback);
  }

  /**
   * We highly recommend using {@link Sequelize#transaction} instead.
   * If you really want to use the manual solution, don't forget to commit or rollback your transaction once you are done with it.
   *
   * Transactions started by this method are not automatically passed to queries. You must pass the transaction object manually,
   * even if {@link Options.disableClsTransactions} is false.
   *
   * @example
   * ```ts
   * try {
   *   const transaction = await sequelize.startUnmanagedTransaction();
   *   const user = await User.findOne(..., { transaction });
   *   await user.update(..., { transaction });
   *   await transaction.commit();
   * } catch(err) {
   *   await transaction.rollback();
   * }
   * ```
   *
   * @param options
   */
  async startUnmanagedTransaction(options?: TransactionOptions): Promise<Transaction> {
    const transaction = new Transaction(
      // @ts-expect-error -- remove once this class has been merged back with the Sequelize class
      this,
      options,
    );

    await transaction.prepareEnvironment();

    return transaction;
  }

  /**
   * A slower alternative to {@link truncate} that uses DELETE FROM instead of TRUNCATE,
   * but which works with foreign key constraints in dialects that don't support TRUNCATE CASCADE (postgres),
   * or temporarily disabling foreign key constraints (mysql, mariadb, sqlite).
   *
   * @param options
   */
  async destroyAll(options?: Omit<DestroyOptions, 'where' | 'limit' | 'truncate'>) {
    const sortedModels = this.modelManager.getModelsTopoSortedByForeignKey();
    const models = sortedModels || this.modelManager.models;

    // It does not make sense to apply a limit to something that will run on all models
    if (options && 'limit' in options) {
      throw new Error('sequelize.destroyAll does not support the limit option.');
    }

    if (options && 'truncate' in options) {
      throw new Error('sequelize.destroyAll does not support the truncate option. Use sequelize.truncate instead.');
    }

    for (const model of models) {
      // eslint-disable-next-line no-await-in-loop
      await model.destroy({ ...options, where: {} });
    }
  }

  /**
   * Truncate all models registered in this instance.
   * This is done by calling {@link Model.truncate} on each model.
   *
   * @param options The options passed to {@link Model.truncate}, plus "withoutForeignKeyChecks".
   */
  async truncate(options?: SequelizeTruncateOptions): Promise<void> {
    const sortedModels = this.modelManager.getModelsTopoSortedByForeignKey();
    const models = sortedModels || this.modelManager.models;
    const hasCyclicDependencies = sortedModels == null;

    if (hasCyclicDependencies && !options?.cascade && !options?.withoutForeignKeyChecks) {
      throw new Error('Sequelize#truncate: Some of your models have cyclic references (foreign keys). You need to use the "cascade" or "withoutForeignKeyChecks" options to be able to delete rows from models that have cyclic references.');
    }

    if (options?.withoutForeignKeyChecks) {
      if (!this.dialect.supports.constraints.foreignKeyChecksDisableable) {
        throw new Error(`Sequelize#truncate: ${this.dialect.name} does not support disabling foreign key checks. The "withoutForeignKeyChecks" option cannot be used.`);
      }

      // Dialects that don't support cascade will throw if a foreign key references a table that is truncated,
      // even if there are no actual rows in the referencing table. To work around this, we disable foreign key.
      return this.queryInterface.withoutForeignKeyChecks(options, async connection => {
        const truncateOptions = { ...options, connection };

        await Promise.all(models.map(async model => model.truncate(truncateOptions)));
      });
    }

    if (options?.cascade) {
      for (const model of models) {
        // If cascade is enabled, we can assume there are foreign keys between the models, so we must truncate them sequentially.
        // eslint-disable-next-line no-await-in-loop
        await model.truncate(options);
      }

      return;
    }

    await Promise.all(models.map(async model => model.truncate(options)));
  }

  async withConnection<T>(options: WithConnectionOptions, callback: SessionCallback<T>): Promise<T>;
  async withConnection<T>(callback: SessionCallback<T>): Promise<T>;
  async withConnection<T>(
    optionsOrCallback: SessionCallback<T> | WithConnectionOptions,
    maybeCallback?: SessionCallback<T>,
  ): Promise<T> {
    let options: WithConnectionOptions;
    let callback: SessionCallback<T>;
    if (typeof optionsOrCallback === 'function') {
      callback = optionsOrCallback;
      options = { type: 'write' };
    } else {
      callback = maybeCallback!;
      options = { type: 'write', ...optionsOrCallback };
    }

    const connection = await this.connectionManager.getConnection(options as GetConnectionOptions);

    try {
      return await callback(connection);
    } finally {
      if (options.destroyConnection) {
        await this.connectionManager.destroyConnection(connection);
      } else {
        this.connectionManager.releaseConnection(connection);
      }
    }
  }

  /**
   * Alias of {@link AbstractQueryInterface#createSchema}
   *
   * @param schema Name of the schema
   * @param options
   */
  async createSchema(schema: string, options?: CreateSchemaOptions): Promise<void> {
    return this.queryInterface.createSchema(schema, options);
  }

  /**
   * Alias of {@link AbstractQueryInterface#showAllSchemas}
   *
   * @deprecated Use {@link AbstractQueryInterface#listSchemas} instead
   * @param options
   */
  async showAllSchemas(options?: QiListSchemasOptions) {
    showAllToListSchemas();

    return this.queryInterface.listSchemas(options);
  }

  /**
   * Alias of {@link AbstractQueryInterface#dropSchema}
   *
   * @param schema
   * @param options
   */
  async dropSchema(schema: string, options?: QueryRawOptions) {
    return this.queryInterface.dropSchema(schema, options);
  }

  /**
   * Alias of {@link AbstractQueryInterface#dropAllSchemas}
   *
   * @param options
   */
  async dropAllSchemas(options?: QiDropAllSchemasOptions) {
    return this.queryInterface.dropAllSchemas(options);
  }

  /**
   * Throws if the database version hasn't been loaded yet.
   * It is automatically loaded the first time Sequelize connects to your database.
   *
   * You can use {@link Sequelize#authenticate} to cause a first connection.
   *
   * @returns current version of the dialect that is internally loaded
   */
  getDatabaseVersion(): string {
    if (this.options.databaseVersion == null) {
      throw new Error('The current database version is unknown. Please call `sequelize.authenticate()` first to fetch it, or manually configure it through options.');
    }

    return this.options.databaseVersion;
  }

  /**
   * Alias of {@link AbstractQueryInterface#fetchDatabaseVersion}
   *
   * @param options
   */
  async fetchDatabaseVersion(options?: QueryRawOptions) {
    return this.queryInterface.fetchDatabaseVersion(options);
  }

  /**
   * Validate a value against a field specification
   *
   * @param value The value to validate
   * @param type The DataType to validate against
   */
  validateValue(value: unknown, type: DataType) {
    if (this.options.noTypeValidation || isNullish(value)) {
      return;
    }

    if (isString(type)) {
      return;
    }

    type = this.normalizeDataType(type);

    const error = validateDataType(value, type);
    if (error) {
      throw error;
    }
  }

  normalizeDataType(Type: string): string;
  normalizeDataType(Type: DataTypeClassOrInstance): AbstractDataType<any>;
  normalizeDataType(Type: string | DataTypeClassOrInstance): string | AbstractDataType<any>;
  normalizeDataType(Type: string | DataTypeClassOrInstance): string | AbstractDataType<any> {
    return normalizeDataType(Type, this.dialect);
  }
}
