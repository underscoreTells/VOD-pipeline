export type CanonicalSchemaNode =
  | CanonicalStringSchemaNode
  | CanonicalNumberSchemaNode
  | CanonicalIntegerSchemaNode
  | CanonicalBooleanSchemaNode
  | CanonicalNullSchemaNode
  | CanonicalArraySchemaNode
  | CanonicalObjectSchemaNode
  | CanonicalDiscriminatedUnionSchemaNode;

export interface CanonicalSchemaBase {
  description?: string;
  nullable?: boolean;
  title?: string;
}

export interface CanonicalStringSchemaNode extends CanonicalSchemaBase {
  kind: "string";
  enum?: string[];
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

export interface CanonicalNumberSchemaNode extends CanonicalSchemaBase {
  kind: "number";
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
}

export interface CanonicalIntegerSchemaNode extends CanonicalSchemaBase {
  kind: "integer";
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
}

export interface CanonicalBooleanSchemaNode extends CanonicalSchemaBase {
  kind: "boolean";
}

export interface CanonicalNullSchemaNode extends CanonicalSchemaBase {
  kind: "null";
}

export interface CanonicalArraySchemaNode extends CanonicalSchemaBase {
  kind: "array";
  items: CanonicalSchemaNode;
  minItems?: number;
  maxItems?: number;
}

export interface CanonicalObjectField {
  schema: CanonicalSchemaNode;
  required: boolean;
}

export interface CanonicalObjectSchemaNode extends CanonicalSchemaBase {
  kind: "object";
  properties: Record<string, CanonicalObjectField>;
  additionalProperties?: boolean;
  propertyOrdering?: string[];
  minProperties?: number;
  maxProperties?: number;
}

export interface CanonicalDiscriminatedUnionSchemaNode extends CanonicalSchemaBase {
  kind: "discriminatedUnion";
  discriminator: string;
  variants: CanonicalObjectSchemaNode[];
}

export function required(schema: CanonicalSchemaNode): CanonicalObjectField {
  return { schema, required: true };
}

export function optional(schema: CanonicalSchemaNode): CanonicalObjectField {
  return { schema, required: false };
}

export function nullable<T extends CanonicalSchemaNode>(schema: T): T {
  return {
    ...schema,
    nullable: true,
  };
}

export const canonicalSchema = {
  string(options: Omit<CanonicalStringSchemaNode, "kind"> = {}): CanonicalStringSchemaNode {
    return {
      kind: "string",
      ...options,
    };
  },

  stringEnum(values: readonly [string, ...string[]], options: Omit<CanonicalStringSchemaNode, "kind" | "enum"> = {}): CanonicalStringSchemaNode {
    return {
      kind: "string",
      enum: [...values],
      ...options,
    };
  },

  literalString(value: string, options: Omit<CanonicalStringSchemaNode, "kind" | "enum"> = {}): CanonicalStringSchemaNode {
    return {
      kind: "string",
      enum: [value],
      ...options,
    };
  },

  number(options: Omit<CanonicalNumberSchemaNode, "kind"> = {}): CanonicalNumberSchemaNode {
    return {
      kind: "number",
      ...options,
    };
  },

  integer(options: Omit<CanonicalIntegerSchemaNode, "kind"> = {}): CanonicalIntegerSchemaNode {
    return {
      kind: "integer",
      ...options,
    };
  },

  boolean(options: Omit<CanonicalBooleanSchemaNode, "kind"> = {}): CanonicalBooleanSchemaNode {
    return {
      kind: "boolean",
      ...options,
    };
  },

  null(options: Omit<CanonicalNullSchemaNode, "kind"> = {}): CanonicalNullSchemaNode {
    return {
      kind: "null",
      ...options,
    };
  },

  array(items: CanonicalSchemaNode, options: Omit<CanonicalArraySchemaNode, "kind" | "items"> = {}): CanonicalArraySchemaNode {
    return {
      kind: "array",
      items,
      ...options,
    };
  },

  object(
    properties: Record<string, CanonicalObjectField>,
    options: Omit<CanonicalObjectSchemaNode, "kind" | "properties"> = {}
  ): CanonicalObjectSchemaNode {
    return {
      kind: "object",
      properties,
      additionalProperties: false,
      propertyOrdering: Object.keys(properties),
      ...options,
    };
  },

  discriminatedUnion(
    discriminator: string,
    variants: [CanonicalObjectSchemaNode, ...CanonicalObjectSchemaNode[]],
    options: Omit<CanonicalDiscriminatedUnionSchemaNode, "kind" | "discriminator" | "variants"> = {}
  ): CanonicalDiscriminatedUnionSchemaNode {
    return {
      kind: "discriminatedUnion",
      discriminator,
      variants: [...variants],
      ...options,
    };
  },

  required,
  optional,
  nullable,
};
