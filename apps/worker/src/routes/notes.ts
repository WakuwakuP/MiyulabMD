import { Elysia } from "elysia";

export const noteRoutes = new Elysia({ prefix: "/api/notes" })
  .get("/", () => ({ notes: [] }))
  .post("/", ({ set }) => {
    set.status = 501;
    return { error: "not implemented" };
  })
  .get("/:id", ({ params, set }) => {
    set.status = 501;
    return { error: "not implemented", id: params.id };
  })
  .patch("/:id", ({ set }) => {
    set.status = 501;
    return { error: "not implemented" };
  })
  .delete("/:id", ({ set }) => {
    set.status = 501;
    return { error: "not implemented" };
  });
