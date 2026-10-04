import { z } from "zod";

/**
 * Keep Zod's validation/type inference, but convert static tool input schemas
 * once at module load. SDK v2 converts them at both registration and tools/list;
 * its per-server cache cannot help a stateless per-request server factory.
 */
export function toolInputSchema<Shape extends z.ZodRawShape>(
  shape: Shape,
): Pick<z.ZodObject<Shape>, "~standard"> {
  const standard = z.object(shape)["~standard"];
  const input = standard.jsonSchema.input({ target: "draft-2020-12" });
  freezeJson(input);

  return {
    "~standard": {
      ...standard,
      jsonSchema: {
        ...standard.jsonSchema,
        input(options) {
          if (
            options.target === "draft-2020-12" &&
            options.libraryOptions === undefined
          ) {
            return input;
          }
          return standard.jsonSchema.input(options);
        },
      },
    },
  };
}

function freezeJson(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return;
  }
  for (const child of Object.values(value)) {
    freezeJson(child);
  }
  Object.freeze(value);
}
