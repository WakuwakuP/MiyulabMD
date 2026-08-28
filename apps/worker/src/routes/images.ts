import { Elysia } from "elysia";

export const imageRoutes = new Elysia({ prefix: "/api/notes" })
  .post("/:id/images", ({ set }) => {
    set.status = 501;
    return { error: "not implemented" };
  })
  .get("/:id/images/:imageId", ({ set }) => {
    set.status = 501;
    return { error: "not implemented" };
  });
