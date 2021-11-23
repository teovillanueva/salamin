import {
  Filter,
  Db as Database,
  ObjectId,
  OptionalId,
  MongoClient,
  Collection,
  WithId,
  MongoClientOptions,
} from "mongodb";

import _ from "lodash";

const Type = {
  String: "STRING",
  Int: "INT",
} as const;

type FieldType = typeof Type[keyof typeof Type];

type Field<T extends Model<any> | FieldType> = {
  type: T;
  embedeable?: boolean;
};

type ExtractPropertyNamesOfType<T, S> = {
  [K in keyof T]-?: T[K] extends S ? K : never;
}[keyof T];

type UnpackFieldType<F extends Field<any>> = F["type"] extends FieldType
  ? F["type"] extends typeof Type["Int"]
    ? number
    : F["type"] extends typeof Type["String"]
    ? string
    : unknown
  : F["type"] extends Model<infer Fields>
  ? Omit<
      Doc<
        Model<
          Omit<
            Fields,
            ExtractPropertyNamesOfType<
              {
                [K in keyof Fields]: Fields[K] extends { embedeable: true }
                  ? Fields[K]
                  : undefined;
              },
              undefined
            >
          >
        >
      >,
      "_id"
    >
  : unknown;

type ModelName<T> = T extends `${infer R}Model` ? R : never;
type DelegateName<T> = `${Lowercase<ModelName<T>>}s`;

type DelegateMap<MS extends { [K in string]: Model<any> }> = {
  [K in DelegateName<keyof MS>]: K extends `${infer MN}s`
    ? Delegate<MS[`${Capitalize<MN>}Model`], Doc<MS[`${Capitalize<MN>}Model`]>>
    : K;
};

type Doc<M extends Model<any>> = M extends Model<infer Fields>
  ? Fields extends { [K in keyof Fields]: Field<any> }
    ? {
        [K in keyof Fields]: UnpackFieldType<Fields[K]>;
      }
    : unknown
  : unknown;

class Model<Fields extends { [K in keyof Fields]: Field<any> }> {
  constructor(public readonly fields: Fields) {}
}

type DatabaseClientConifg<MS extends { [K in string]: Model<any> }> = {
  connection: {
    url: string;
    options?: MongoClientOptions;
  };
  models: MS;
};

class _DatabaseClient<MS extends { [K in string]: Model<any> }> {
  private client: MongoClient;

  constructor(private readonly config: DatabaseClientConifg<MS>) {
    this.client = new MongoClient(this.config.connection.url, {});

    const modelsNames: (keyof MS)[] = Object.keys(config.models);

    const delegates: DelegateMap<MS> = modelsNames.reduce((acc, modelName) => {
      const delegateName =
        String(modelName).replace("Model", "").toLowerCase() + "s";

      return {
        ...acc,
        [delegateName]: new Delegate(
          this.client.db(),
          String(modelName),
          delegateName,
          config.models[modelName]
        ),
      };
    }, {} as DelegateMap<MS>);

    const proto = { ..._DatabaseClient.prototype };
    Object.assign(proto, Object.getPrototypeOf(delegates));
    Object.setPrototypeOf(this, proto);
    Object.assign(this, delegates);
  }

  get models() {
    return Object.keys(this.config.models).reduce(
      (acc, modelName) => ({
        ...acc,
        [String(modelName).replace("Model", "")]: this.config.models[modelName],
      }),
      {}
    ) as {
      [K in ModelName<keyof MS>]: MS[`${Capitalize<K>}Model`];
    };
  }

  public async connect() {
    return this.client.connect();
  }
}

type QueryProjection<D extends Doc<any>> = Partial<{
  [K in keyof D]: D[K] extends object ? QueryProjection<D> | true : boolean;
}>;

type ProjectedDocument<D extends Doc<any>, P extends QueryProjection<D>> = {
  [K in keyof P]: K extends keyof D ? D[K] : undefined;
};

type Where<D extends Doc<any>> = Filter<WithId<D>>;

type FindOneArgs<D extends Doc<any>> = {
  where: Where<D>;
  select?: QueryProjection<D>;
};

type FindOneResult<
  D extends Doc<any>,
  A extends FindOneArgs<D>
> = A["select"] extends QueryProjection<D>
  ? ProjectedDocument<D, A["select"]>
  : D;

class Delegate<M extends Model<any>, D extends Doc<M>> {
  private collection: Collection<WithId<D>>;

  constructor(
    private readonly database: Database,
    private readonly modelName: string,
    private readonly name: string,
    private readonly model: Model<any>,
    collectionName?: string
  ) {
    this.collection = this.database.collection<WithId<D>>(
      collectionName || this.name
    );
  }

  async findOne<A extends FindOneArgs<D>>(
    args: A
  ): Promise<FindOneResult<D, A> | null> {
    return null;
    // return this.collection.findOne(args.where, { projection: {} });
  }

  async create(data: OptionalId<WithId<D>>) {
    const { insertedId } = await this.collection.insertOne(data);
    return { ...data, _id: insertedId };
  }
}

const DatabaseClient = _DatabaseClient as new <
  MS extends Record<string, Model<any>>
>(
  config: DatabaseClientConifg<MS>
) => _DatabaseClient<MS> & DelegateMap<MS>;

const UserModel = new Model({
  name: {
    embedeable: true,
    type: Type.String,
  },
  age: {
    type: Type.Int,
  },
});

const PostModel = new Model({
  title: {
    type: Type.String,
  },
  user: {
    type: UserModel,
  },
});

const db = new DatabaseClient({
  connection: {
    url: "mongodb://localhost:27017/odm",
  },
  models: {
    UserModel,
    PostModel,
  },
});

const main = async () => {
  await db.connect();

  // Create a user
  const user = await db.users.create({
    name: "John",
    age: 30,
  });

  // Create a post
  const post = await db.posts.create({
    title: "Hello world",
    user: {
      name: user.name,
    },
  });
};

main();
