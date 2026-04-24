import type { LLMProviderType } from "../../providers/index.js";
import type { AgentToolDefinition } from "../define-tool.js";
import type {
  CanonicalArraySchemaNode,
  CanonicalDiscriminatedUnionSchemaNode,
  CanonicalIntegerSchemaNode,
  CanonicalNumberSchemaNode,
  CanonicalObjectSchemaNode,
  CanonicalSchemaNode,
  CanonicalStringSchemaNode,
} from "../schema.js";

export interface OpenAIFunctionToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters?: Record<string, unknown>;
    strict?: boolean;
  };
}

export interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

export interface GeminiToolDefinition {
  functionDeclarations: GeminiFunctionDeclaration[];
}

export interface CompiledProviderTool<TDefinition = unknown> {
  provider: LLMProviderType;
  name: string;
  schema: Record<string, unknown>;
  definition: TDefinition;
}

export interface ProviderToolStrategy<TDefinition = unknown> {
  readonly provider: LLMProviderType;
  compileSchema(schema: CanonicalSchemaNode): Record<string, unknown>;
  compileTool(tool: AgentToolDefinition): CompiledProviderTool<TDefinition>;
  buildBindPayload(tools: CompiledProviderTool<TDefinition>[]): unknown[];
}

interface CompileSchemaOptions {
  nullableMode: "anyOf" | "nullable";
  includeAdditionalProperties: boolean;
  includePropertyOrdering: boolean;
}

const DEFAULT_JSON_SCHEMA_OPTIONS: CompileSchemaOptions = {
  nullableMode: "anyOf",
  includeAdditionalProperties: true,
  includePropertyOrdering: false,
};

const GEMINI_SCHEMA_OPTIONS: CompileSchemaOptions = {
  nullableMode: "nullable",
  includeAdditionalProperties: false,
  includePropertyOrdering: true,
};

export function compileJsonSchemaLike(schema: CanonicalSchemaNode): Record<string, unknown> {
  return compileSchemaNode(schema, DEFAULT_JSON_SCHEMA_OPTIONS);
}

export function compileGeminiSchema(schema: CanonicalSchemaNode): Record<string, unknown> {
  return compileSchemaNode(schema, GEMINI_SCHEMA_OPTIONS);
}

function compileSchemaNode(
  schema: CanonicalSchemaNode,
  options: CompileSchemaOptions
): Record<string, unknown> {
  switch (schema.kind) {
    case "string":
      return applyNullable(compileStringSchema(schema), schema.nullable, options);
    case "number":
      return applyNullable(compileNumberSchema("number", schema), schema.nullable, options);
    case "integer":
      return applyNullable(compileNumberSchema("integer", schema), schema.nullable, options);
    case "boolean":
      return applyNullable(withCommonFields({ type: "boolean" }, schema), schema.nullable, options);
    case "null":
      return { type: "null", ...getCommonFields(schema) };
    case "array":
      return applyNullable(compileArraySchema(schema, options), schema.nullable, options);
    case "object":
      return applyNullable(compileObjectSchema(schema, options), schema.nullable, options);
    case "discriminatedUnion":
      return applyNullable(compileDiscriminatedUnionSchema(schema, options), schema.nullable, options);
    default: {
      const exhaustive: never = schema;
      throw new Error(`Unsupported schema node: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function compileStringSchema(schema: CanonicalStringSchemaNode): Record<string, unknown> {
  return withCommonFields(
    {
      type: "string",
      ...(Array.isArray(schema.enum) && schema.enum.length > 0
        ? { enum: [...schema.enum] }
        : {}),
      ...(typeof schema.minLength === "number" ? { minLength: schema.minLength } : {}),
      ...(typeof schema.maxLength === "number" ? { maxLength: schema.maxLength } : {}),
      ...(typeof schema.pattern === "string" ? { pattern: schema.pattern } : {}),
    },
    schema
  );
}

function compileNumberSchema(
  type: "number" | "integer",
  schema: CanonicalNumberSchemaNode | CanonicalIntegerSchemaNode
): Record<string, unknown> {
  const { minimum, maximum, descriptionSuffix } = lowerNumericBounds(type, schema);
  return withCommonFields(
    {
      type,
      ...(typeof minimum === "number" ? { minimum } : {}),
      ...(typeof maximum === "number" ? { maximum } : {}),
    },
    schema,
    descriptionSuffix
  );
}

function compileArraySchema(
  schema: CanonicalArraySchemaNode,
  options: CompileSchemaOptions
): Record<string, unknown> {
  return withCommonFields(
    {
      type: "array",
      items: compileSchemaNode(schema.items, options),
      ...(typeof schema.minItems === "number" ? { minItems: schema.minItems } : {}),
      ...(typeof schema.maxItems === "number" ? { maxItems: schema.maxItems } : {}),
    },
    schema
  );
}

function compileObjectSchema(
  schema: CanonicalObjectSchemaNode,
  options: CompileSchemaOptions
): Record<string, unknown> {
  const properties = Object.entries(schema.properties).reduce<Record<string, unknown>>(
    (record, [key, field]) => {
      record[key] = compileSchemaNode(field.schema, options);
      return record;
    },
    {}
  );

  const required = Object.entries(schema.properties)
    .filter(([, field]) => field.required)
    .map(([key]) => key);

  return withCommonFields(
    {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
      ...(options.includeAdditionalProperties
        ? { additionalProperties: schema.additionalProperties ?? false }
        : {}),
      ...(options.includePropertyOrdering && Array.isArray(schema.propertyOrdering)
        ? { propertyOrdering: [...schema.propertyOrdering] }
        : {}),
      ...(typeof schema.minProperties === "number" ? { minProperties: schema.minProperties } : {}),
      ...(typeof schema.maxProperties === "number" ? { maxProperties: schema.maxProperties } : {}),
    },
    schema
  );
}

function compileDiscriminatedUnionSchema(
  schema: CanonicalDiscriminatedUnionSchemaNode,
  options: CompileSchemaOptions
): Record<string, unknown> {
  return withCommonFields(
    {
      anyOf: schema.variants.map((variant) => compileObjectSchema(variant, options)),
    },
    schema
  );
}

function withCommonFields<T extends Record<string, unknown>>(
  base: T,
  schema: CanonicalSchemaNode,
  descriptionSuffix?: string
): T & Record<string, unknown> {
  return {
    ...base,
    ...getCommonFields(schema, descriptionSuffix),
  };
}

function getCommonFields(
  schema: CanonicalSchemaNode,
  descriptionSuffix?: string
): Record<string, unknown> {
  const description = appendDescription(schema.description, descriptionSuffix);
  return {
    ...(typeof schema.title === "string" ? { title: schema.title } : {}),
    ...(typeof description === "string" && description.length > 0 ? { description } : {}),
  };
}

function applyNullable(
  schema: Record<string, unknown>,
  nullable: boolean | undefined,
  options: CompileSchemaOptions
): Record<string, unknown> {
  if (!nullable) {
    return schema;
  }

  if (options.nullableMode === "nullable") {
    return {
      ...schema,
      nullable: true,
    };
  }

  return {
    anyOf: [schema, { type: "null" }],
  };
}

function appendDescription(
  description: string | undefined,
  suffix: string | undefined
): string | undefined {
  if (!suffix) {
    return description;
  }

  if (!description) {
    return suffix;
  }

  return `${description} ${suffix}`;
}

function lowerNumericBounds(
  type: "number" | "integer",
  schema: CanonicalNumberSchemaNode | CanonicalIntegerSchemaNode
): {
  minimum?: number;
  maximum?: number;
  descriptionSuffix?: string;
} {
  let minimum = schema.minimum;
  let maximum = schema.maximum;
  const suffixes: string[] = [];

  if (typeof schema.exclusiveMinimum === "number") {
    const lowered = lowerExclusiveMinimum(type, schema.exclusiveMinimum);
    if (typeof lowered === "number") {
      minimum = typeof minimum === "number" ? Math.max(minimum, lowered) : lowered;
    } else {
      suffixes.push(`Value must be greater than ${schema.exclusiveMinimum}.`);
    }
  }

  if (typeof schema.exclusiveMaximum === "number") {
    const lowered = lowerExclusiveMaximum(type, schema.exclusiveMaximum);
    if (typeof lowered === "number") {
      maximum = typeof maximum === "number" ? Math.min(maximum, lowered) : lowered;
    } else {
      suffixes.push(`Value must be less than ${schema.exclusiveMaximum}.`);
    }
  }

  return {
    ...(typeof minimum === "number" ? { minimum } : {}),
    ...(typeof maximum === "number" ? { maximum } : {}),
    ...(suffixes.length > 0 ? { descriptionSuffix: suffixes.join(" ") } : {}),
  };
}

function lowerExclusiveMinimum(
  type: "number" | "integer",
  value: number
): number | undefined {
  if (type === "integer") {
    return Math.floor(value) + 1;
  }

  return undefined;
}

function lowerExclusiveMaximum(
  type: "number" | "integer",
  value: number
): number | undefined {
  if (type === "integer") {
    return Math.ceil(value) - 1;
  }

  return undefined;
}
