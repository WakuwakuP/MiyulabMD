import { Elysia } from "elysia";

/** 読み取り専用共有。SPA の `/s/:id` に寄せ、API 側で canView を見る。 */
export const shareRoutes = new Elysia({ prefix: "/share" }).get("/:id", ({ params, redirect }) => {
  return redirect(`/s/${params.id}`);
});
