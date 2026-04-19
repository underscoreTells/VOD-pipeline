import { z, ZodError, type ZodTypeAny } from "zod";
import type {
  CanonicalDiscriminatedUnionSchemaNode,
  CanonicalObjectSchemaNode,
  CanonicalSchemaNode,
} from "./schema.js";

export class ToolInputValidationError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ToolInputValidationError";
    this.cause = cause;
  }
}

export function isToolInputValidationError(error: unknown): boolean {
  return error instanceof ToolInputValidationError || error instanceof ZodError;
}

export function compileCanonicalSchema(schema: CanonicalSchemaNode): ZodTypeAny {
  return compileSchemaNode(schema);
}

export function validateCanonicalSchema<TParsed = unknown>(
  schema: CanonicalSchemaNode,
  value: unknown,
  parse?: (validated: unknown) => TParsed
): TParsed {
  let validated: unknown;

  try {
    validated = compileCanonicalSchema(schema).parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      throw error;
    }
    throw new ToolInputValidationError(
      error instanceof Error ? error.message : "Tool input validation failed",
      error
    );
  }

  if (!parse) {
    return validated as TParsed;
  }

  try {
    return parse(validated);
  } catch (error) {
    throw new ToolInputValidationError(
      error instanceof Error ? error.message : "Tool input parsing failed",
      error
    );
  }
}

function compileSchemaNode(schema: CanonicalSchemaNode): ZodTypeAny {
  switch (schema.kind) {
    case "string":
      return applyNullable(compileStringSchema(schema), schema.nullable);
    case "number":
      return applyNullable(compileNumberSchema(schema), schema.nullable);
    case "integer":
      return applyNullable(compileIntegerSchema(schema), schema.nullable);
    case "boolean":
      return applyNullable(z.boolean(), schema.nullable);
    case "null":
      return z.null();
    case "array":
      return applyNullable(compileArraySchema(schema), schema.nullable);
    case "object":
      return applyNullable(compileObjectSchema(schema), schema.nullable);
    case "discriminatedUnion":
      return applyNullable(compileDiscriminatedUnionSchema(schema), schema.nullable);
    default: {
      const exhaustive: never = schema;
      throw new Error(`Unsupported canonical schema node: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function compileStringSchema(schema: Extract<CanonicalSchemaNode, { kind: "string" }>): ZodTypeAny {
  let stringSchema: ZodTypeAny;

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    stringSchema = z.enum(schema.enum as [string, ...string[]]);
  } else {
    stringSchema = z.string();
  }

  if (typeof schema.minLength === "number") {
    stringSchema = stringSchema.min(schema.minLength);
  }

  if (typeof schema.maxLength === "number") {
    stringSchema = stringSchema.max(schema.maxLength);
  }

  if (typeof schema.pattern === "string" && schema.pattern.length > 0) {
    stringSchema = stringSchema.regex(new RegExp(schema.pattern));
  }

  return stringSchema;
}

function compileNumberSchema(schema: Extract<CanonicalSchemaNode, { kind: "number" }>): ZodTypeAny {
  let numberSchema = z.number().finite();

  if (typeof schema.minimum === "number") {
    numberSchema = numberSchema.min(schema.minimum);
  }

  if (typeof schema.maximum === "number") {
    numberSchema = numberSchema.max(schema.maximum);
  }

  if (typeof schema.exclusiveMinimum === "number") {
    numberSchema = numberSchema.gt(schema.exclusiveMinimum);
  }

  if (typeof schema.exclusiveMaximum === "number") {
    numberSchema = numberSchema.lt(schema.exclusiveMaximum);
  }

  return numberSchema;
}

function compileIntegerSchema(schema: Extract<CanonicalSchemaNode, { kind: "integer" }>): ZodTypeAny {
  let integerSchema = z.number().int();

  if (typeof schema.minimum === "number") {
    integerSchema = integerSchema.min(schema.minimum);
  }

  if (typeof schema.maximum === "number") {
    integerSchema = integerSchema.max(schema.maximum);
  }

  if (typeof schema.exclusiveMinimum === "number") {
    integerSchema = integerSchema.gt(schema.exclusiveMinimum);
  }

  if (typeof schema.exclusiveMaximum === "number") {
    integerSchema = integerSchema.lt(schema.exclusiveMaximum);
  }

  return integerSchema;
}

function compileArraySchema(schema: Extract<CanonicalSchemaNode, { kind: "array" }>): ZodTypeAny {
  let arraySchema = z.array(compileSchemaNode(schema.items));

  if (typeof schema.minItems === "number") {
    arraySchema = arraySchema.min(schema.minItems);
  }

  if (typeof schema.maxItems === "number") {
    arraySchema = arraySchema.max(schema.maxItems);
  }

  return arraySchema;
}

function compileObjectSchema(schema: CanonicalObjectSchemaNode): ZodTypeAny {
  const shape = Object.entries(schema.properties).reduce<Record<string, ZodTypeAny>>(
    (record, [key, field]) => {
      const fieldSchema = compileSchemaNode(field.schema);
      record[key] = field.required ? fieldSchema : fieldSchema.optional();
      return record;
    },
    {}
  );

  let objectSchema = z.object(shape);

  if (schema.additionalProperties === false) {
    objectSchema = objectSchema.strict();
  }

  if (typeof schema.minProperties === "number" || typeof schema.maxProperties === "number") {
    objectSchema = objectSchema.superRefine((value, ctx) => {
      const propertyCount = Object.keys(value).length;

      if (typeof schema.minProperties === "number" && propertyCount < schema.minProperties) {
        ctx.addIssue({
          code: "custom",
          message: `Expected at least ${schema.minProperties} properties`,
        });
      }

      if (typeof schema.maxProperties === "number" && propertyCount > schema.maxProperties) {
        ctx.addIssue({
          code: "custom",
          message: `Expected at most ${schema.maxProperties} properties`,
        });
      }
    });
  }

  return objectSchema;
}

function compileDiscriminatedUnionSchema(
  schema: CanonicalDiscriminatedUnionSchemaNode
): ZodTypeAny {
  const variants = schema.variants.map((variant) =>
    assertDiscriminatedVariant(schema.discriminator, variant)
  );
  return z.discriminatedUnion(schema.discriminator, variants);
}

function assertDiscriminatedVariant(
  discriminator: string,
  schema: CanonicalObjectSchemaNode
) {
  if (!(discriminator in schema.properties)) {
    throw new Error(
      `Discriminated union variant is missing discriminator field "${discriminator}"`
    );
  }
  return compileObjectSchema(schema) as unknown as z.ZodDiscriminatedUnionOption<string>;
}

function applyNullable(schema: ZodTypeAny, nullable: boolean | undefined): ZodTypeAny {
  return nullable ? schema.nullable() : schema;
}
